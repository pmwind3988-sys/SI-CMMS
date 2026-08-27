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
 * definition of the column, and the count of unstamped rows is the alarm that
 * push has broken. Everything below is written to hold that line even when a
 * database read blips, even under a concurrent invocation of the same row, and
 * even when only some of a recipient's devices succeed. (0042 also added
 * notifications.push_gave_up_at for the 24-hour give-up stamp — this function
 * never touches that column, only pushed_at.)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptPayload, vapidHeader } from "./webpush.ts";

const SECRET = Deno.env.get("PUSH_TRIGGER_SECRET") ?? "";
const JWK = Deno.env.get("VAPID_PRIVATE_JWK") ?? "";
const SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@pmw-group.com";

// Validated once at cold start rather than left to fail per subscription. A
// malformed key should be loud at deploy time, not discovered mid-loop — and
// this also closes off the one path by which VAPID key material could reach a
// readable surface: without this, a bad JWK's JSON.parse (inside webpush.ts,
// which is deliberately NOT modified here — its RFC 8291/8292 crypto was
// verified line by line and is correct) would throw for the first time inside
// the per-subscription try/catch below, and V8 quotes a slice of the offending
// input into that SyntaxError message — which `String(e).slice(0,500)` then
// writes to push_subscriptions.last_error, a column the row's own owner can
// read. Once this line has succeeded, that same JSON.parse inside webpush.ts
// is deterministic on the same string and can never fail there again. The
// further step of caching the imported CryptoKey itself (so it is not
// re-imported once per device) would need webpush.ts to accept a pre-imported
// key instead of a JWK string — a signature change to that file, which was
// explicitly put off-limits, so it is not done here.
try {
  JSON.parse(JWK);
} catch (e) {
  console.error("VAPID_PRIVATE_JWK does not parse as JSON at cold start:", e);
}

// The deep link the service worker follows on tap. Work orders are the only
// entity that has ever been notified about; anything else lands on the list.
function pathFor(entityType: string, entityId: string) {
  return entityType === "work_order" ? `/work-orders/?id=${entityId}` : "/notifications/";
}

// Undoes this invocation's own claim (below), and only this invocation's: the
// second `.eq("pushed_at", claimedAt)` means that if anything else has since
// written a different value, that write is left alone.
async function releaseClaim(db: any, id: string, claimedAt: string) {
  await db.from("notifications").update({ pushed_at: null }).eq("id", id).eq("pushed_at", claimedAt);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Not a timing-safe comparison, and deliberately not pretending to be: the
  // secret is 256 bits of random and the attacker has no oracle to iterate
  // against. The padded-exit reasoning in 0027 does not apply here.
  if (!SECRET || req.headers.get("x-push-secret") !== SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const { notification_id } = await req.json().catch(() => ({}));
  if (!notification_id) return new Response("notification_id required", { status: 400 });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Read and claim in one statement. The trigger and the sweep can both reach
  // the same row, and the sweep runs every minute with only a 2-minute floor —
  // an invocation still mid-loop when the sweep re-fires would, on a plain
  // read-then-write, see pushed_at still null and send every device a second
  // time. `pushed_at is null` in the WHERE clause is the fence: only one
  // concurrent UPDATE can ever match and return this row, so the loser gets
  // zero rows back and does nothing, rather than a second full send.
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await db
    .from("notifications")
    .update({ pushed_at: claimedAt })
    .eq("id", notification_id)
    .is("pushed_at", null)
    .select("id, recipient_id, title, body, type, entity_type, entity_id")
    .maybeSingle();

  if (claimErr) {
    // A transient failure here is not the same thing as "no such
    // notification" — conflating the two used to stamp rows that were merely
    // unreadable for a moment, which permanently removed them from the retry
    // sweep's predicate over one blip. The UPDATE never committed, so the row
    // is exactly as unstamped as before this call and the sweep will retry it.
    console.error("claim failed", claimErr);
    return new Response(JSON.stringify({ error: "database error", detail: claimErr.message }), { status: 500 });
  }

  if (!claimed) {
    // Zero rows back means either the id does not exist, or something else
    // (a concurrent invocation, or the sweep) already claimed it in the
    // instant before this call. The two are told apart only for the response
    // body — the outcome, do nothing further, is identical either way.
    const { data: existing } = await db.from("notifications").select("id").eq("id", notification_id).maybeSingle();
    return new Response(JSON.stringify({ skipped: existing ? "already" : "gone" }), { status: 200 });
  }

  const n = claimed;

  const { data: subs, error: subsErr } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", n.recipient_id);

  if (subsErr) {
    // Same reasoning as the claim's own error branch above: a blip reading
    // push_subscriptions must not leave the notification looking delivered.
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
    // row is left exactly as it was found: unstamped, and now correctly
    // excluded from the sweep by its own predicate rather than by a false
    // stamp.
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

  let sent = 0, failed = 0, gone = 0;

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
        // slow-invocation scenario the atomic claim above exists to survive,
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
        await db.from("push_subscriptions").delete().eq("id", s.id);
        gone++;
      } else {
        await db.from("push_subscriptions")
          .update({ failed_at: new Date().toISOString(), last_error: `${res.status} ${await res.text()}`.slice(0, 500) })
          .eq("id", s.id);
        failed++;
      }
    } catch (e) {
      await db.from("push_subscriptions")
        .update({ failed_at: new Date().toISOString(), last_error: String(e).slice(0, 500) })
        .eq("id", s.id);
      failed++;
    }
  }

  if (sent > 0) {
    // At least one device took it. The claim above already stamped
    // pushed_at, so there is nothing further to write here — and this is
    // kept deliberately even when a second device on the same account failed
    // or is gone. Per-notification retry would re-deliver to the device that
    // already succeeded, and there is no way from here to retry just the one
    // that did not without one row meaning two different things for two
    // different devices. A person with a phone and a laptop, where only the
    // laptop's push succeeds, is the one case where this trade-off costs a
    // real alert on the phone. Accepted rather than re-architected — recorded
    // here so the next reader knows it was a choice, not an oversight.
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
    // nothing succeeded. Release so the sweep retries it — this is finding
    // 1's fix carried through to the send loop itself, not just the two
    // reads above it.
    await releaseClaim(db, n.id, claimedAt);
  }

  return new Response(JSON.stringify({ sent, failed, gone }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
