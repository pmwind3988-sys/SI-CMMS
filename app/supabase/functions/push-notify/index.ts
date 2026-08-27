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
 * It stamps notifications.pushed_at on success. That stamp is what stops the
 * retry sweep re-sending forever, and it only works because 0042 amended
 * si_guard_notification_update() to let a null-uid (service role) write through.
 * (0042 also added notifications.push_gave_up_at for the 24-hour give-up stamp —
 * this function never touches that column, only pushed_at.)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encryptPayload, vapidHeader } from "./webpush.ts";

const SECRET = Deno.env.get("PUSH_TRIGGER_SECRET") ?? "";
const JWK = Deno.env.get("VAPID_PRIVATE_JWK") ?? "";
const SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@pmw-group.com";

// The deep link the service worker follows on tap. Work orders are the only
// entity that has ever been notified about; anything else lands on the list.
function pathFor(entityType: string, entityId: string) {
  return entityType === "work_order" ? `/work-orders/?id=${entityId}` : "/notifications/";
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

  const { data: n } = await db.from("notifications")
    .select("id, recipient_id, title, body, type, entity_type, entity_id, pushed_at")
    .eq("id", notification_id).maybeSingle();

  if (!n) return new Response(JSON.stringify({ skipped: "gone" }), { status: 200 });
  // The trigger and the sweep can both reach the same row. Whichever arrives
  // second finds it stamped and does nothing, rather than sending it twice.
  if (n.pushed_at) return new Response(JSON.stringify({ skipped: "already" }), { status: 200 });

  const { data: subs } = await db.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").eq("user_id", n.recipient_id);

  if (!subs?.length) {
    // Nobody has registered a device. Stamp it anyway — there is nothing to
    // retry, and leaving it unstamped means the sweep carries it for 24 hours.
    await db.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", n.id);
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

  // Stamped when at least one device took it, or when every remaining device
  // turned out to be gone. Only a real failure leaves it for the sweep.
  if (sent > 0 || (failed === 0 && gone > 0)) {
    await db.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", n.id);
  }

  return new Response(JSON.stringify({ sent, failed, gone }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
