"use client";

/**
 * SI — Service Inside · push subscription lifecycle
 *
 * The browser half of migration 0042. A PushSubscription identifies a BROWSER,
 * not an account — which is the whole reason registration goes through an RPC
 * (see the migration's comment on the shared workshop terminal).
 *
 * Nothing here ever throws. A failure to register for alerts must never be the
 * reason somebody cannot sign in, and every caller is on a path where the user
 * is trying to do something else.
 */
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

/** The browser wants applicationServerKey as raw bytes, not base64url. */
function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

function keyOf(sub, name) {
  const raw = sub.getKey(name);
  if (!raw) return null;
  let s = "";
  for (const b of new Uint8Array(raw)) s += String.fromCharCode(b);
  return window.btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

/**
 * Called after the gate is passed and on every subsequent sign-in.
 *
 * Re-registering every time rather than only on first grant is what recovers a
 * subscription the browser silently rotated, or one the Edge Function deleted
 * after a push service reported it gone. It also refreshes last_seen_at.
 */
export async function ensurePushSubscription() {
  if (!pushSupported()) return false;
  if (window.Notification?.permission !== "granted") return false;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    let sub = await registration.pushManager.getSubscription();
    if (!sub) {
      sub = await registration.pushManager.subscribe({
        // Required to be true by every browser that implements this. A silent
        // push is not permitted on the open web at all.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const p256dh = keyOf(sub, "p256dh");
    const auth = keyOf(sub, "auth");
    if (!p256dh || !auth) return false;

    const { error } = await supabase.rpc("si_register_push_subscription", {
      p_endpoint: sub.endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent.slice(0, 300),
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Called from a DELIBERATE sign-out only, and before the session is cleared —
 * the RPC needs a token.
 *
 * Deliberately NOT called when a session is lost. An expired token is not a
 * person leaving the device, and tearing down their subscription over a refresh
 * would silently stop their alerts for reasons they could never discover. Same
 * judgement isRetryableFailure() makes in lib/sessionRecovery.js: being offline
 * is not being signed out.
 */
export async function dropPushSubscription() {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const sub = await registration?.pushManager.getSubscription();
    if (!sub) return;
    await supabase.rpc("si_unregister_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch {
    /* Signing out must succeed regardless. A row left behind is collected the
       next time somebody registers this same endpoint, because the RPC deletes
       by endpoint before it inserts. */
  }
}
