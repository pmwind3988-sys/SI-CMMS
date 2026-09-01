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

      // A payload that parses but isn't a plain object (null, a bare string, a
      // number, an array) would make every `data.x` access below throw outside
      // this try/catch, which is a rejected `waitUntil` promise and therefore a
      // push that shows nothing at all — the one outcome this handler must
      // never produce. Coerce anything that isn't a non-null object back to {}.
      if (typeof data !== "object" || data === null) data = {};

      // A focused, same-origin tab already showed this via the in-app
      // Realtime path (lib/osNotifications.js chimes rather than banners
      // while foregrounded, per CLAUDE.md's "app in the foreground -> chime
      // only, because the badge on the bell is already the notification").
      // Without checking this, the push handler below duplicates it: two
      // alerts and two vibrations for one event on a phone that is simply
      // unlocked with the app open. `userVisibleOnly` means a push that shows
      // NOTHING gets the origin's push permission revoked by Chrome, so the
      // answer here is a quieter notification, never a suppressed one.
      const windows = await self.clients.matchAll({ type: "window" });
      const focused = windows.some((c) => c.focused && new URL(c.url).origin === self.location.origin);

      const title = data.title || "SI — Service Inside";
      await self.registration.showNotification(title, {
        body: data.body || "You have a new notification.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        // Tagged by the notification's own row id — data.id is
        // notifications.id, the same value lib/osNotifications.js tags its
        // `si-${id}` in-app notification with (see that file for why: a
        // second alert about a DIFFERENT event must not replace the first).
        // The `si-` prefix is repeated here on purpose: this and the in-app
        // path are two deliveries of the SAME event and must collapse onto
        // the same OS notification, not stack as two. A bare `data.id` here
        // used to leave them on different tags, which is exactly the
        // duplicate this comment is about. Falling back to a random value
        // when there is no id (malformed payload, parse failure above) keeps
        // unrelated pushes from colliding with each other on a shared tag.
        tag: data.id ? `si-${data.id}` : crypto.randomUUID(),
        renotify: true,
        // Android only; desktop ignores it and iOS has no vibration API at
        // all. Skipped when a focused tab already alerted — the chime from
        // that path is the alert; this is a quiet confirmation, not a second
        // interruption.
        vibrate: focused ? undefined : [200, 100, 200, 100, 400],
        // Desktop only: stays on screen until dismissed instead of auto-hiding
        // after a few seconds. Mobile ignores it. Off while focused for the
        // same reason as vibrate above — a banner that insists on being
        // dismissed competes with the bell for attention instead of backing
        // it up.
        requireInteraction: !focused,
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
