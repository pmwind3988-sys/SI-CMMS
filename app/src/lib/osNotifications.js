"use client";

/**
 * SI — Service Inside · OS-level notification delivery
 *
 * `lib/notifications.js` reads the `notifications` table. This file is the other
 * half: putting one of those rows in front of someone who is not currently
 * looking at the app — the Android status bar, or the desktop/browser notification
 * centre — with the sound that goes with it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CAN AND CANNOT DELIVER — read before extending it
 * ---------------------------------------------------------------------------
 * Delivery here is driven by the app's own Realtime subscription, so it reaches
 * exactly as far as that websocket does:
 *
 *   Android APK, app in foreground        -> chime only (they are already looking)
 *   Android APK, app backgrounded         -> status-bar notification + sound
 *   Browser tab open, tab focused         -> chime only
 *   Browser tab open, tab hidden/minimised-> OS notification + sound
 *   iOS home-screen app, backgrounded     -> notification centre, via the worker
 *   iOS Safari tab (not installed)        -> nothing; WebKit has no Notification
 *   App swiped away / browser closed      -> NOTHING, and nothing here can fix it
 *
 * That last row is a platform boundary, not an oversight. A notification that
 * arrives with no process running has to be pushed *to* the device by a server:
 * FCM for Android, Web Push for the browser. Both need a sender holding secrets,
 * which this app deliberately does not have — `output: "export"` in
 * next.config.js means there is no server of ours anywhere (see CLAUDE.md,
 * "Static export constraints"). Closing that gap is a Supabase Edge Function
 * plus a device-token table plus a Firebase project, and is written up in
 * DATA_AND_STORAGE.md rather than half-built here.
 *
 * Nothing in this file is an authorization boundary. Every notification it shows
 * came out of `listenNotifications`, which is RLS-scoped to the recipient — this
 * layer only re-presents rows the database already agreed to hand over.
 */

/** Android channel id. Its importance is fixed at creation time: changing
    `importance` here does nothing to a channel that already exists on the
    device, so a change of mind needs a new id, not an edit. */
const CHANNEL_ID = "si-work-orders";

export function isNativeApp() {
  return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true;
}

function webNotificationsSupported() {
  return typeof window !== "undefined" && typeof window.Notification === "function";
}

/* -------------------------------------------------------------------------- */
/* iOS                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * True in an installed home-screen / desktop web app, false in a browser tab.
 *
 * Two checks because they disagree by platform: `display-mode: standalone` is
 * the standard and is what Android and desktop answer, while iOS shipped
 * `navigator.standalone` years earlier and still sets it. An installed iPhone
 * app satisfies both on current iOS and only the second on older versions.
 */
export function isInstalledWebApp() {
  if (typeof window === "undefined") return false;
  return (
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches === true
  );
}

/**
 * iOS/iPadOS detection, needed only to explain a missing feature rather than to
 * gate one — every capability check in this file is a real feature test.
 *
 * iPadOS reports itself as "MacIntel" with a desktop user agent, so the second
 * clause is the standard trick: a Mac with a touchscreen is an iPad.
 */
export function isIos() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * True when the only thing standing between this user and OS notifications is
 * that they are in Safari rather than in the installed app.
 *
 * WebKit exposes no Notification API at all to an ordinary iOS tab — not a
 * denied permission but an absent constructor — and it appears the moment the
 * site is added to the Home Screen. That is a fixable "unsupported", unlike an
 * old desktop browser, so the bell offers instructions instead of staying
 * silent.
 */
export function iosNeedsInstallForAlerts() {
  return isIos() && !isNativeApp() && !isInstalledWebApp() && !webNotificationsSupported();
}

/* -------------------------------------------------------------------------- */
/* The service worker                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Registered lazily, and only on the web.
 *
 * iOS implements `ServiceWorkerRegistration.showNotification()` and *not* the
 * `new Notification()` constructor, so on an iPhone this registration is the
 * difference between notifications working and throwing. Elsewhere it is simply
 * the better of two paths. public/sw.js caches nothing — see the comment there
 * for why a fetch handler is deliberately absent.
 *
 * Lazy rather than on mount because registration is only ever needed by
 * someone who has notifications on: a signed-in user who never opts in should
 * not acquire a background worker for the privilege of not using it.
 */
let swPromise = null;
function notificationWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (isNativeApp()) return Promise.resolve(null);

  if (!swPromise) {
    swPromise = navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() =>
        // `ready` resolves on the *active* worker, which is what showNotification
        // needs — a registration whose worker is still installing rejects. It
        // also never rejects, so a worker that fails to activate would hang this
        // promise and every notification behind it; the race is the timeout that
        // registration itself does not provide.
        Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
        ])
      )
      .catch(() => null);
  }
  return swPromise;
}

/**
 * The plugin is imported lazily and only on native.
 *
 * Two reasons it is not a top-level import. `next build` renders every page
 * once in Node to emit the static HTML, and a plugin module that touches the
 * Capacitor bridge at import time takes the build down with it. And on the web
 * build it is dead weight — nothing in it can run there.
 */
let pluginPromise = null;
function localNotifications() {
  if (!isNativeApp()) return Promise.resolve(null);
  if (!pluginPromise) {
    pluginPromise = import("@capacitor/local-notifications")
      .then((m) => m.LocalNotifications ?? null)
      .catch(() => null);
  }
  return pluginPromise;
}

/* -------------------------------------------------------------------------- */
/* Permission                                                                 */
/* -------------------------------------------------------------------------- */

/** One vocabulary for both platforms:
 *    "unsupported" — nowhere to show it (an old browser, or the plugin missing)
 *    "prompt"      — never asked; a user gesture may ask
 *    "granted"     — will be shown
 *    "denied"      — refused; only the OS settings screen can undo it */
export async function osNotificationPermission() {
  if (isNativeApp()) {
    const plugin = await localNotifications();
    if (!plugin) return "unsupported";
    try {
      const { display } = await plugin.checkPermissions();
      // Capacitor reports "prompt-with-rationale" on a second Android ask.
      if (display === "granted") return "granted";
      if (display === "denied") return "denied";
      return "prompt";
    } catch {
      return "unsupported";
    }
  }
  if (!webNotificationsSupported()) return "unsupported";
  const p = window.Notification.permission;
  return p === "default" ? "prompt" : p;
}

/**
 * Must be called from a user gesture. Both platforms require it: Chrome refuses
 * `Notification.requestPermission()` outside one, and Android 13+ shows the
 * POST_NOTIFICATIONS dialog once and remembers a dismissal.
 */
export async function requestOsNotificationPermission() {
  primeNotificationSound();

  if (isNativeApp()) {
    const plugin = await localNotifications();
    if (!plugin) return "unsupported";
    try {
      const { display } = await plugin.requestPermissions();
      if (display === "granted") {
        await ensureChannel(plugin);
        return "granted";
      }
      return display === "denied" ? "denied" : "prompt";
    } catch {
      return "unsupported";
    }
  }

  if (!webNotificationsSupported()) return "unsupported";

  // Started, pointedly not awaited. The permission prompt is only granted
  // during transient activation from the gesture that led here, and registering
  // a worker is a network fetch plus an install — long enough to run that
  // activation out and have Safari reject the request. It is awaited below,
  // once there is an answer worth preparing for.
  notificationWorker();

  try {
    const result = await window.Notification.requestPermission();
    if (result === "granted") await notificationWorker();
    return result === "default" ? "prompt" : result;
  } catch {
    return "unsupported";
  }
}

let channelReady = false;
async function ensureChannel(plugin) {
  if (channelReady) return;
  try {
    await plugin.createChannel({
      id: CHANNEL_ID,
      name: "Work order alerts",
      description: "Assignments, status changes and SLA warnings",
      // 5 = IMPORTANCE_HIGH: heads-up banner over whatever is on screen, with
      // the channel's sound. 4 (DEFAULT) makes a sound but does not pop, and a
      // technician holding a spanner does not pull the shade down to check.
      importance: 5,
      visibility: 1,
      vibration: true,
    });
    channelReady = true;
  } catch {
    // Pre-Oreo, or a channel the user has since edited. Scheduling still works;
    // it just lands on the OS default channel.
    channelReady = true;
  }
}

/* -------------------------------------------------------------------------- */
/* Sound                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Web sound is synthesised rather than shipped as an audio file.
 *
 * `new Notification()` is silent on most desktop configurations, and a bundled
 * mp3 would be one more binary in `out/` for both Vercel and the APK. Two short
 * sine tones are ~30 lines and cannot 404.
 *
 * Native needs none of this — the Android channel plays the system notification
 * sound itself.
 */
let audioCtx = null;

/** Unlock the AudioContext from a user gesture. Browsers start it `suspended`,
    and a context that was never resumed while the page had a gesture plays
    nothing later, silently. Cheap and idempotent — call it freely. */
export function primeNotificationSound() {
  if (typeof window === "undefined") return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  } catch {
    audioCtx = null;
  }
}

export function playNotificationChime() {
  primeNotificationSound();
  if (!audioCtx || audioCtx.state !== "running") return;
  try {
    const now = audioCtx.currentTime;
    // Rising two-note figure — reads as "something arrived" rather than as an
    // error beep, which the SLA notifications would otherwise imply constantly.
    [
      { freq: 880, at: 0 },
      { freq: 1174.7, at: 0.13 },
    ].forEach(({ freq, at }) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Ramped, not switched: a gain that jumps to 0 clicks audibly.
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.18, now + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.24);
    });
  } catch {
    // Audio is a courtesy; never let it break the notification itself.
  }
}

/* -------------------------------------------------------------------------- */
/* Presenting                                                                 */
/* -------------------------------------------------------------------------- */

/** Android notification ids are Java ints. Fold the row's uuid into 31 bits so
    the same row re-presented replaces its own entry instead of stacking. */
function nativeId(uuid) {
  let h = 0;
  for (let i = 0; i < uuid.length; i += 1) h = (h * 31 + uuid.charCodeAt(i)) | 0;
  return Math.abs(h) % 2147483647;
}

/**
 * A web notification click is a hard navigation, not a `router.push` — whether
 * it is handled by the page or by the service worker — so the URL has to be one
 * the static export actually serves. `trailingSlash: true` means
 * `/work-orders/view` is a 308 to `/work-orders/view/`, and the redirect would
 * carry a work order id through an extra round trip for no reason. Native taps
 * go through the router and need none of this.
 */
function exportedPath(path) {
  const [route, query] = path.split("?");
  const withSlash = route.endsWith("/") ? route : `${route}/`;
  return query ? `${withSlash}?${query}` : withSlash;
}

/**
 * Show one notification.
 *
 * `path` travels with it so a tap can open the work order rather than just the
 * app — on native via `extra`, on web via the click handler.
 *
 * Returns true if the OS was asked to show something, false if it was suppressed
 * (no permission, or the caller decided a chime was enough).
 */
export async function presentOsNotification({ id, title, body, path }) {
  if (isNativeApp()) {
    const plugin = await localNotifications();
    if (!plugin) return false;
    if ((await osNotificationPermission()) !== "granted") return false;
    await ensureChannel(plugin);
    try {
      await plugin.schedule({
        notifications: [
          {
            id: nativeId(id),
            title,
            body: body || "",
            channelId: CHANNEL_ID,
            // No `schedule` key at all — that is what makes it fire now. A
            // schedule of `{ at: new Date() }` is already in the past by the
            // time the bridge crosses and Android may drop it.
            extra: { path, notificationId: id },
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  if (!webNotificationsSupported()) return false;
  if (window.Notification.permission !== "granted") return false;

  const options = {
    body: body || "",
    // The row id as tag: a re-delivered row replaces its own notification
    // rather than adding a second copy of itself.
    tag: `si-${id}`,
    // PNG rather than the icon.svg favicon: neither WebKit nor Android's
    // notification shade renders an SVG here, and both fail by showing the
    // generic globe rather than by complaining.
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Normalised here rather than at either click site, because both of them
    // navigate by URL: sw.js resolves this against the origin and calls
    // navigate()/openWindow(), and the constructor's onclick below assigns it.
    data: { path: path ? exportedPath(path) : "/" },
  };

  // The worker first. On iOS it is the only path that exists — `new
  // Notification()` is not implemented in WebKit and throws — and everywhere
  // else it is still the better one, because its click handler lives in
  // sw.js and outlives the page that scheduled it.
  const registration = await notificationWorker();
  if (registration) {
    try {
      await registration.showNotification(title, options);
      return true;
    } catch {
      // An unexpected refusal from the worker. The constructor below is a real
      // fallback on desktop, and simply throws again on iOS.
    }
  }

  try {
    const n = new window.Notification(title, options);
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* pop-up blockers */
      }
      if (options.data.path) window.location.assign(options.data.path);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** Collapsed form for a burst — six SLA warnings at once should be one line in
    the shade, not six. */
export async function presentOsNotificationSummary(count, path = "/notifications/") {
  return presentOsNotification({
    id: `summary-${count}`,
    title: `${count} new notifications`,
    body: "Open SI to review them.",
    path,
  });
}

/**
 * True when the app is not what the user is currently looking at, and an OS
 * notification is therefore worth showing. When it is false the caller should
 * chime and stop: the bell badge is already on screen, and duplicating it in the
 * notification centre is how people turn notifications off.
 */
export function appIsInBackground() {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "hidden" || !document.hasFocus?.();
}

/**
 * Native tap handling. Registers once and returns an unsubscribe.
 *
 * Web needs no equivalent here: a tap is handled by sw.js, which focuses the
 * existing window and navigates it, or by the Notification object's own onclick
 * when the constructor path was used. Both are a real navigation rather than a
 * router push, which is why the URL is normalised before it is attached.
 */
export async function onOsNotificationTapped(handler) {
  const plugin = await localNotifications();
  if (!plugin) return () => {};
  try {
    const sub = await plugin.addListener("localNotificationActionPerformed", (event) => {
      const path = event?.notification?.extra?.path;
      if (path) handler(path);
    });
    return () => sub.remove().catch(() => {});
  } catch {
    return () => {};
  }
}
