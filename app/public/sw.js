/**
 * SI — Service Inside · notification service worker
 *
 * This exists for one reason: iOS. A home-screen web app on iOS 16.4+ can show
 * OS notifications, but only through `registration.showNotification()` — the
 * `new Notification()` constructor that lib/osNotifications.js uses on desktop
 * is not implemented in WebKit and throws. No service worker, no notifications
 * on an iPhone. Android and desktop get it too, which is why the tap handling
 * below is the same code for all three.
 *
 * ---------------------------------------------------------------------------
 * THERE IS DELIBERATELY NO `fetch` HANDLER
 * ---------------------------------------------------------------------------
 * A caching service worker in front of a Next.js static export is a way to
 * serve last week's JS chunks against this week's HTML, which fails as a blank
 * screen with no error. This worker caches nothing and intercepts nothing: the
 * network stays exactly as it was, and the only thing registration buys is the
 * notification surface. Offline support, if it is ever wanted, is a separate
 * decision with its own invalidation story — not something to bolt on here.
 *
 * THERE IS NOW A `push` HANDLER, and it is why this file matters more than it
 * used to. Everything above still holds for the in-app path — a notification
 * shown while the tab is open comes from the app's own Realtime subscription.
 * The push handler below is the other case: the browser is closed, no page is
 * running, and this worker is the only code the device will execute. It is fed
 * by supabase/functions/push-notify (migration 0042).
 *
 * Scope is "/" because the file is served from the root of `out/`. Moving it
 * anywhere else silently narrows the scope to that directory.
 */

// Take over immediately rather than waiting for every tab to close. The worker
// carries no cache, so there is no old-version state that a slow handover would
// be protecting — and a user who just tapped "enable alerts" expects the next
// notification to work, not the one after they quit the app.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * A push arrived. The browser may be closed; this handler is all that runs.
 *
 * `event.waitUntil` is load-bearing: without it the worker can be terminated
 * before showNotification resolves and the alert silently never appears. There
 * is no error and nothing to see — it simply does not happen.
 *
 * A push must ALWAYS result in a visible notification. Chrome revokes the push
 * permission of an origin that receives pushes and shows nothing, so the catch
 * below shows a generic notification rather than returning quietly.
 */
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        /* not our payload, or not JSON — fall through to the generic below */
      }

      const title = data.title || "SI — Service Inside";
      await self.registration.showNotification(title, {
        body: data.body || "You have a new notification.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        // The notification's own id, so a second alert about a DIFFERENT event
        // does not silently replace the first. renotify makes a repeat of the
        // SAME id alert again rather than updating in place.
        tag: data.id || "si-notification",
        renotify: true,
        // Android only; desktop ignores it and iOS has no vibration API at all.
        vibrate: [200, 100, 200, 100, 400],
        // Desktop only: stays on screen until dismissed instead of auto-hiding
        // after a few seconds. Mobile ignores it.
        requireInteraction: true,
        data: { path: data.path || "/notifications/" },
      });
    })()
  );
});

/**
 * Tapping a notification opens the work order it is about.
 *
 * Prefer an existing window over a new one: on iOS a home-screen web app is a
 * single window, and `openWindow` there would either be ignored or bounce the
 * user out to Safari. `navigate()` only works on a client this worker controls,
 * which `clients.claim()` above is what guarantees — but it can still reject
 * (a cross-origin redirect, a client mid-unload), and a focused app on the
 * wrong screen beats no app at all, so the failure is swallowed after focus.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const path = event.notification.data?.path || "/";
  const url = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clients.find((c) => new URL(c.url).origin === self.location.origin);

      if (existing) {
        await existing.focus();
        try {
          await existing.navigate(url);
        } catch {
          /* uncontrolled or unloading client — it is at least in the foreground */
        }
        return;
      }

      await self.clients.openWindow(url);
    })()
  );
});
