/**
 * SI — Service Inside · push-notify Edge Function
 *
 * Turns one `notifications` row into a push to every device its recipient has
 * registered. Called by si_enqueue_push() (0042) on insert, and again by
 * si_push_retry_sweep() for anything still unstamped after two minutes.
 *
 * verify_jwt is OFF for this function — the caller is Postgres, which holds no
 * user token — so the shared secret below is the ONLY authentication. It is
 * deployed with `--no-verify-jwt` as a CLI flag rather than a config.toml block,
 * because config.toml is what `supabase config push` sends and CLAUDE.md forbids
 * running that against production.
 *
 * `pushed_at` means DELIVERED, not merely "handled" — that is 0042's own
 * definition of the column. The RIGHT alarm for "push has broken" is not the
 * bare count of unstamped rows — the sweep deliberately excludes recipients
 * with no registered device, so that bare count also grows in ordinary
 * healthy operation and cannot tell a broken send path apart from people who
 * declined push. See the query in app/DATA_AND_STORAGE.md §5, which restates
 * the sweep's own predicate instead. Everything below is written to hold the
 * pushed_at/push_gave_up_at distinction even when a database read blips, even
 * under a concurrent invocation of the same row, and even when only some of a
 * recipient's devices succeed.
 *
 * Concurrency is fenced by `push_claimed_at`, a SEPARATE, EXPIRING lease — not
 * by `pushed_at` itself. Round 1 of this function claimed by stamping
 * pushed_at up front and unstamping it on every non-delivery exit, and that
 * shape has a hole no amount of try/finally closes: a killed invocation
 * (isolate recycled mid-loop, a deploy landing mid-request, an uncaught throw
 * escaping the per-subscription catch block) skips the release entirely and
 * leaves the row permanently marked delivered — invisible to the sweep,
 * invisible to the alarm above, notification simply never arriving and
 * nothing reporting it. A lease has to expire on its own, because no care
 * inside this function can guarantee its own cleanup runs; see push_claimed_at
 * and si_push_retry_sweep's predicate in 0042 for the other half of this.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptPayload, vapidHeader } from "./webpush.ts";

const SECRET = Deno.env.get("PUSH_TRIGGER_SECRET") ?? "";
const JWK = Deno.env.get("VAPID_PRIVATE_JWK") ?? "";
const SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@pmw-group.com";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";

// Validated once at cold start rather than left to fail per subscription, and
// the RESULT is remembered (JWK_OK) rather than swallowed. A malformed key
// must fail the whole invocation before the send loop starts: the previous
// version let the module load anyway and let JSON.parse throw for the first
// time inside the per-subscription try/catch below, where `webpush.ts`'s own
// JSON.parse of the same string (that file is deliberately NOT modified here —
// its RFC 8291/8292 crypto was verified line by line and is correct) would
// throw a V8 SyntaxError that quotes a slice of the offending input, and
// `String(e).slice(0,500)` writes that straight into
// push_subscriptions.last_error — a column the row's own owner can read. Worse,
// it would repeat: every device fails the same way, the row stays unstamped,
// the sweep retries it once a minute, rewriting the leaking value up to 1,440
// times a day. Failing closed before the loop starts closes this entirely,
// because JSON.parse is the only call in that try block that quotes its input
// — importKey, atob and a missing jwk.x all raise generic errors instead.
let JWK_OK = true;
try {
  JSON.parse(JWK);
} catch (e) {
  JWK_OK = false;
  console.error("VAPID_PRIVATE_JWK does not parse as JSON at cold start:", e);
}

// VAPID_PUBLIC_KEY is otherwise unused — webpush.ts's vapidHeader() rebuilds
// the `k=` parameter from the JWK's own x and y, so this function never reads
// this secret for anything else, and the pre-flight scan for this feature
// noted exactly that ("Cost if wrong: one unused secret... makes the keypair
// harder to rotate correctly later"). This is the job that scan anticipated:
// the browser subscribed against a SEPARATE string,
// NEXT_PUBLIC_VAPID_PUBLIC_KEY, baked into the client bundle at build time.
// Nothing before this compared the two, so a half-completed key rotation —
// one updated, one not — would make every push fail with 401 and no
// indication why, silently converted into a permanent give-up by the 401/403
// handling above rather than a loud, diagnosable failure. Checked once at
// cold start rather than per request, the same reasoning JWK_OK uses.
function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

let KEYS_MATCH = true;
if (JWK_OK) {
  try {
    const jwk = JSON.parse(JWK);
    const x = b64urlDecode(jwk.x);
    const y = b64urlDecode(jwk.y);
    const rebuilt = new Uint8Array(1 + x.length + y.length);
    rebuilt[0] = 4;
    rebuilt.set(x, 1);
    rebuilt.set(y, 1 + x.length);
    const declared = b64urlDecode(VAPID_PUBLIC_KEY);
    KEYS_MATCH =
      declared.length === rebuilt.length && declared.every((b, i) => b === rebuilt[i]);
    if (!KEYS_MATCH) {
      console.error(
        "VAPID_PUBLIC_KEY does not match the public point rebuilt from VAPID_PRIVATE_JWK " +
        "at cold start — check for a half-completed key rotation."
      );
    }
  } catch (e) {
    KEYS_MATCH = false;
    console.error("Could not compare VAPID_PUBLIC_KEY against VAPID_PRIVATE_JWK at cold start:", e);
  }
}

// The lease window. Generous relative to the per-device 10s fetch timeout
// below (up to a few dozen devices before this could plausibly still be
// running), short relative to the 24-hour give-up: an abandoned claim should
// surface again in minutes, not become part of the noise floor.
const CLAIM_LEASE_MINUTES = 5;

// The deep link the service worker follows on tap. Work orders are the only
// entity that has ever been notified about; anything else lands on the list.
//
// MUST stay in step with pathForNotification() in lib/notifications.js — that
// is the in-app equivalent of this same rule (entity_type/entity_id -> where
// it opens) and the two are two implementations of one decision, the exact
// hazard CLAUDE.md documents for suggestPriority() vs si_derive_priority().
// They diverged once already: this used to emit `/work-orders/?id=...`, the
// LIST page, which reads no query string at all — every notification tap
// opened the list with the id silently discarded, no error, nothing to see.
// The trailing slash before `?` is not decorative: next.config.js sets
// trailingSlash: true, so `/work-orders/view?id=...` (no slash) 308-redirects
// and drops the query string on a raw browser navigation. sw.js's
// notificationclick handler uses `data.path` exactly as received — unlike
// lib/osNotifications.js's in-app path, there is no exportedPath() call
// between here and the URL the worker navigates to — so this function is the
// only place that slash can be added for a push notification.
function pathFor(entityType: string, entityId: string) {
  return entityType === "work_order" ? `/work-orders/view/?id=${entityId}` : "/notifications/";
}

// Releases this invocation's own claim, and only this invocation's: the
// `.eq("push_claimed_at", claimedAt)` guard means that if the lease has since
// expired and someone else re-claimed the row, that claim is left alone. Logs
// on failure rather than discarding it — a failed release here is merely LATE
// now, not permanent, because the lease expires on its own regardless.
async function releaseClaim(db: any, id: string, claimedAt: string) {
  const { error } = await db
    .from("notifications")
    .update({ push_claimed_at: null })
    .eq("id", id)
    .eq("push_claimed_at", claimedAt);
  if (error) console.error(`releaseClaim failed for ${id}:`, error.message);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Not a timing-safe comparison, and deliberately not pretending to be: the
  // secret is 256 bits of random and the attacker has no oracle to iterate
  // against. The padded-exit reasoning in 0027 does not apply here.
  if (!SECRET || req.headers.get("x-push-secret") !== SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!JWK_OK) {
    return new Response(JSON.stringify({ error: "VAPID_PRIVATE_JWK is misconfigured" }), { status: 500 });
  }

  if (!KEYS_MATCH) {
    return new Response(
      JSON.stringify({ error: "VAPID_PUBLIC_KEY does not match VAPID_PRIVATE_JWK" }),
      { status: 500 },
    );
  }

  const { notification_id } = await req.json().catch(() => ({}));
  if (!notification_id) return new Response("notification_id required", { status: 400 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Read and claim in one statement, fenced by push_claimed_at rather than
  // pushed_at (see the module header). The row qualifies only if it has never
  // been delivered AND (nobody holds the lease, or the lease has expired) —
  // the same shape si_push_retry_sweep checks in 0042, so a row this call
  // cannot claim is one the sweep will also correctly leave alone until the
  // lease goes stale.
  const claimedAt = new Date().toISOString();
  const leaseFloor = new Date(Date.now() - CLAIM_LEASE_MINUTES * 60_000).toISOString();
  const { data: claimed, error: claimErr } = await db
    .from("notifications")
    .update({ push_claimed_at: claimedAt })
    .eq("id", notification_id)
    .is("pushed_at", null)
    .or(`push_claimed_at.is.null,push_claimed_at.lt.${leaseFloor}`)
    .select("id, recipient_id, title, body, type, entity_type, entity_id")
    .maybeSingle();

  if (claimErr) {
    // A transient failure here is not the same claim as "no such
    // notification" — conflating the two used to stamp rows that were merely
    // unreadable for a moment, which permanently removed them from the retry
    // sweep's predicate over one blip. The UPDATE never committed, so the row
    // is exactly as unclaimed as before this call and the sweep will retry it.
    console.error("claim failed", claimErr);
    return new Response(JSON.stringify({ error: "database error", detail: claimErr.message }), { status: 500 });
  }

  if (!claimed) {
    // Zero rows back means the id does not exist, it was already delivered,
    // or another invocation currently holds an unexpired lease. Told apart
    // only for the response body — the outcome, do nothing further, is
    // identical either way, and its own error is logged rather than
    // discarded even though it changes nothing about what this call does.
    const { data: existing, error: existErr } = await db
      .from("notifications").select("id").eq("id", notification_id).maybeSingle();
    if (existErr) console.error(`existence check failed for ${notification_id}:`, existErr.message);
    return new Response(JSON.stringify({ skipped: existing ? "already" : "gone" }), { status: 200 });
  }

  const n = claimed;

  // Second of two enforcement points for "a deactivated account stops
  // receiving pushes" — the other is si_push_retry_sweep's own predicate in
  // 0042. Neither push_subscriptions nor the trigger path that enqueues this
  // call has ever read users.status: deactivation only withholds role claims
  // from the NEXT MINTED JWT (0026), and this function runs on the service
  // role, which never carries a JWT at all. Without this check a deactivated
  // technician still named on an open work order keeps receiving
  // status_change pushes on their own phone indefinitely — not the ~hour of
  // latency every other role/status change has, because nothing here ever
  // expires on its own to close the gap. Same "loosest path wins" reasoning
  // CLAUDE.md applies to every other users-row rule with more than one
  // enforcement point.
  const { data: recipient, error: recipErr } = await db
    .from("users")
    .select("status")
    .eq("id", n.recipient_id)
    .maybeSingle();

  if (recipErr) {
    console.error("recipient status read failed", recipErr);
    await releaseClaim(db, n.id, claimedAt);
    return new Response(JSON.stringify({ error: "database error", detail: recipErr.message }), { status: 500 });
  }

  if (!recipient || recipient.status !== "active") {
    // Deactivated (or the account no longer exists) since this notification
    // was queued. Same shape as the empty-subscriptions branch below:
    // nothing here should stamp pushed_at for a delivery that must not
    // happen, and release rather than retry — the sweep's own predicate now
    // excludes this recipient too, so it will not come back through there.
    await releaseClaim(db, n.id, claimedAt);
    return new Response(JSON.stringify({ sent: 0, failed: 0, gone: 0 }), { status: 200 });
  }

  const { data: subs, error: subsErr } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", n.recipient_id);

  if (subsErr) {
    // Same reasoning as the claim's own error branch above: a blip reading
    // push_subscriptions must not leave the notification looking delivered,
    // nor stuck holding the lease past the point of usefulness — release it
    // now rather than waiting out the full 5-minute expiry.
    console.error("subscription read failed", subsErr);
    await releaseClaim(db, n.id, claimedAt);
    return new Response(JSON.stringify({ error: "database error", detail: subsErr.message }), { status: 500 });
  }

  if (!subs?.length) {
    // No devices registered. 0042 amended the retry sweep to exclude
    // recipients with zero push_subscriptions rows entirely, so there is
    // nothing left to gain by stamping this — and stamping it would claim
    // "delivered" for a notification no device ever received, which is
    // exactly what 0042 defines pushed_at to mean. Release the claim so the
    // row is left exactly as it was found: unstamped, unclaimed, and now
    // correctly excluded from the sweep by its own predicate rather than by
    // a false stamp.
    await releaseClaim(db, n.id, claimedAt);
    return new Response(JSON.stringify({ sent: 0, failed: 0, gone: 0 }), { status: 200 });
  }

  const payload = JSON.stringify({
    id: n.id,
    title: n.title,
    body: n.body ?? "",
    type: n.type,
    path: pathFor(n.entity_type, n.entity_id),
  });

  let sent = 0, failed = 0, gone = 0, authFailed = 0;

  for (const s of subs) {
    try {
      const [body, auth] = await Promise.all([
        encryptPayload(payload, s.p256dh, s.auth),
        vapidHeader(s.endpoint, JWK, SUBJECT),
      ]);

      const res = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          "TTL": "86400",
          "Authorization": auth,
        },
        body,
        // Deno's fetch has no default timeout. One hung push endpoint would
        // otherwise stall this whole invocation indefinitely — exactly the
        // slow-invocation scenario the claim lease above exists to survive,
        // rather than merely detect after the fact.
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) { sent++; continue; }

      // 404/410 means the BROWSER threw the subscription away — uninstalled,
      // storage cleared, expired. It can never succeed again, so it is deleted
      // rather than retried. Anything else (429, 503, a network blip) is
      // transient, and deleting on those would silently unsubscribe somebody
      // during an outage.
      if (res.status === 404 || res.status === 410) {
        const { error } = await db.from("push_subscriptions").delete().eq("id", s.id);
        if (error) console.error(`push_subscriptions delete failed for ${s.id}:`, error.message);
        gone++;
      } else if (res.status === 401 || res.status === 403) {
        // A wrong or half-rotated VAPID keypair presents as exactly this —
        // the push service is rejecting OUR signature, not disowning the
        // subscription, so this must not fall into the branch below that
        // deletes/retries: the same broken key signs identically on every
        // future attempt, so retrying it as transient (as this used to)
        // meant up to 1,440 retries a day per notification, silently
        // rewriting last_error every time until the 24-hour give-up finally
        // masked it. Logged loudly and given up on for THIS notification
        // immediately instead — see the authFailed handling below, which
        // stamps push_gave_up_at rather than releasing the claim for retry.
        console.error(
          `push auth rejected for subscription ${s.id} on notification ${n.id} ` +
          `(check VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK for a keypair mismatch): ` +
          `${res.status} ${await res.text()}`
        );
        authFailed++;
      } else {
        const { error } = await db.from("push_subscriptions")
          .update({ failed_at: new Date().toISOString(), last_error: `${res.status} ${await res.text()}`.slice(0, 500) })
          .eq("id", s.id);
        if (error) console.error(`push_subscriptions update failed for ${s.id}:`, error.message);
        failed++;
      }
    } catch (e) {
      const { error } = await db.from("push_subscriptions")
        .update({ failed_at: new Date().toISOString(), last_error: String(e).slice(0, 500) })
        .eq("id", s.id);
      if (error) console.error(`push_subscriptions update failed for ${s.id}:`, error.message);
      failed++;
    }
  }

  if (sent > 0) {
    // At least one device took it. This is the one write in this function
    // that stamps pushed_at, and it is not fenced by the same "unless
    // something else beat us to it" guard the claim/release pair uses —
    // holding the lease is what already guaranteed nobody else is touching
    // this row. push_claimed_at is cleared in the SAME write rather than left
    // set: pushed_at now non-null already removes the row from every
    // predicate that matters (the sweep's own WHERE starts with
    // `pushed_at is null`), so a lingering claim value would be inert, not
    // dangerous — but leaving it around anyway would misreport "still being
    // worked on" to anyone reading the column directly, e.g. from a future
    // admin screen or an ad-hoc query, for no benefit.
    //
    // Kept even when a SECOND device on the same account failed or is gone:
    // per-notification retry would re-deliver to the device that already
    // succeeded, and there is no way from here to retry just the one that did
    // not without one row meaning two different things for two different
    // devices. A person with a phone and a laptop, where only the laptop's
    // push succeeds, is the one case where this trade-off costs a real alert
    // on the phone. Accepted rather than re-architected — recorded here so
    // the next reader knows it was a choice, not an oversight.
    const { error } = await db
      .from("notifications")
      .update({ pushed_at: new Date().toISOString(), push_claimed_at: null })
      .eq("id", n.id);
    if (error) {
      // Late rather than permanent: pushed_at genuinely was not written, so
      // the row stays in the retry set and the sweep will re-send it once the
      // lease above expires — a duplicate push to the device that already
      // succeeded, not a lost one. Logged so a spike in this is visible.
      console.error(`pushed_at stamp failed for ${n.id}:`, error.message);
    }
  } else if (authFailed > 0) {
    // Nothing was delivered (sent === 0), and at least one device was
    // refused for a reason retrying cannot fix — the VAPID key itself is
    // wrong, and every subscription in this loop signs under the same key.
    // Not stamped pushed_at (nothing was delivered) and not released for the
    // sweep to retry either: releasing here reproduces the exact 1,440-a-day
    // retry storm the branch above exists to stop, since the same key
    // rejects the same way every time. push_gave_up_at is 0042's existing
    // "stop retrying without claiming delivered" column — reused rather than
    // inventing a second one, and it is what the alarm query in
    // DATA_AND_STORAGE.md §5 already treats as "stopped, not delivered."
    const { error } = await db
      .from("notifications")
      .update({ push_gave_up_at: new Date().toISOString(), push_claimed_at: null })
      .eq("id", n.id);
    if (error) console.error(`push_gave_up_at stamp failed for ${n.id}:`, error.message);
  } else if (failed === 0 && gone > 0) {
    // Every device that existed turned out to be gone (404/410, deleted
    // above) and none merely failed. All were genuinely undeliverable, which
    // is a different claim from "delivered" — 0042 defines pushed_at as the
    // latter, so this is released rather than stamped. It will not loop
    // forever: every device that was gone has just been deleted from
    // push_subscriptions, so by the time the next sweep pass reaches this
    // row the recipient has zero rows there and 0042's own sweep predicate
    // excludes them — the same door the empty-subs branch above walks
    // through.
    await releaseClaim(db, n.id, claimedAt);
  } else {
    // At least one real, possibly-transient failure (429/503/network) and
    // nothing succeeded. Release so the sweep retries it once the 2-minute
    // floor passes, rather than waiting out the full lease expiry.
    await releaseClaim(db, n.id, claimedAt);
  }

  return new Response(JSON.stringify({ sent, failed, gone }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
