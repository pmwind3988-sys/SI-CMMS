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
 * There is no `push` handler either, for the reason in lib/osNotifications.js:
 * a push arrives from a server, and `output: "export"` means this app has none.
 * Every notification shown here originates in the app's own Realtime
 * subscription, so the page is running whenever one is displayed.
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
