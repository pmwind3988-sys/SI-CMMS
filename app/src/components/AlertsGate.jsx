"use client";

/**
 * SI — Service Inside · the alerts gate
 *
 * The app refuses to open until the browser's notification permission has been
 * ASKED FOR. It cannot refuse until permission is granted, and the difference
 * matters: Chrome and Safari both remember a refusal and ignore every later
 * requestPermission() call, so a gate with no exit at "denied" is a person who
 * cannot work and has no route out from inside the app. They meet this screen
 * again on every sign-in; that is the pressure that remains available.
 *
 * The one state with no escape is an iPhone in a Safari tab, because it is the
 * only unsupported state the user can actually fix — installing to the Home
 * Screen is a thirty-second action, and WebKit gives an uninstalled site no
 * Notification API whatsoever.
 *
 * ─── Why "escaped" is sessionStorage, keyed by uid, and not component state ──
 *
 * RequireAuth (and this gate with it) is mounted in every page.jsx, not in the
 * root layout — it unmounts and remounts on every navigation. Component state
 * does not survive that: a plain `useState` "Continue without alerts" would
 * hold for exactly one page view and then reappear on the next click, which is
 * "every navigation, forever" rather than the "every sign-in" the copy above
 * promises. The same remount is why session recovery can no longer wipe an
 * already-escaped choice — persisted state is read straight back on the next
 * mount instead of starting over at `false`.
 *
 * Keyed by uid for the same reason lib/draftRecovery.js keys its drafts: a
 * shared plant terminal means the next person to sign in must not inherit the
 * previous person's "continue without alerts". Every access is wrapped in
 * try/catch, the same guard toastHandoff.js and draftRecovery.js use — a
 * private window or storage disabled must degrade to "ask every time", not
 * throw.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Share, ShieldAlert } from "lucide-react";
import Button from "./ui/Button";
import {
  iosNeedsInstallForAlerts,
  isInstalledWebApp,
  isNativeApp,
  osNotificationPermission,
  requestOsNotificationPermission,
} from "../lib/osNotifications";
import { ensurePushSubscription } from "../lib/pushSubscription";

const ESCAPE_PREFIX = "si:alertsGateEscaped:";
const PUSH_ATTEMPTED_PREFIX = "si:alertsGatePushAttempted:";

function storage() {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readFlag(prefix, uid) {
  const store = storage();
  if (!store || !uid) return false;
  try {
    return store.getItem(`${prefix}${uid}`) === "1";
  } catch {
    return false;
  }
}

function writeFlag(prefix, uid) {
  const store = storage();
  if (!store || !uid) return;
  try {
    store.setItem(`${prefix}${uid}`, "1");
  } catch {
    /* Quota, or storage disabled. The gate falls back to asking every
       navigation, which is degraded, not broken. */
  }
}

export default function AlertsGate({ uid, onPassed }) {
  const [permission, setPermission] = useState(null);   // null = still checking
  const [needsIosInstall, setNeedsIosInstall] = useState(false);
  // Lazy initializer: read the persisted choice at the moment THIS mount is
  // created, not once ever. That is what makes a remount after recovery, or
  // after a navigation, come back already-escaped instead of resetting.
  const [escaped, setEscaped] = useState(() => readFlag(ESCAPE_PREFIX, uid));
  const [asking, setAsking] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    osNotificationPermission().then((p) => {
      if (!alive) return;
      setPermission(p);
      setNeedsIosInstall(iosNeedsInstallForAlerts());
      // Registering here (permission already granted, gate about to render
      // null) is the "on every subsequent sign-in" case pushSubscription.js
      // documents. Without the flag this fires on every remount — every
      // navigation, since RequireAuth mounts this gate per page.jsx — turning
      // one intended registration into a database write per page view.
      //
      // The flag is written only on SUCCESS, not before the call. Bounding a
      // successful registration to one attempt per tab session is the whole
      // point; latching on a FAILURE is a different bug — ensurePushSubscription()
      // returns false (never throws) on a missing VAPID key, a worker that
      // never reached `ready` inside its own 4s race, an RPC error, or being
      // offline, and every one of those is worth retrying on the next
      // navigation. Retrying an already-succeeded registration is the only
      // waste this guards against, and it is a no-op once a row exists.
      if (p === "granted" && !readFlag(PUSH_ATTEMPTED_PREFIX, uid)) {
        // Not returned from the .then() callback — the effect's cleanup must
        // stay a synchronous function, not a Promise, so this runs detached
        // rather than being awaited here.
        (async () => {
          if (await ensurePushSubscription()) writeFlag(PUSH_ATTEMPTED_PREFIX, uid);
        })();
      }
    });
    return () => { alive = false; };
  }, [uid]);

  const enable = useCallback(async () => {
    setAsking(true);
    // Must be inside the click. Both platforms only accept a permission request
    // during the transient activation the gesture grants, and awaiting anything
    // before this line can run that activation out.
    const next = await requestOsNotificationPermission();
    setPermission(next);
    if (next === "granted") {
      // Flag written only on success — see the matching comment in the mount
      // effect above. A failed registration here must not latch: it should
      // still be retried on the next navigation, not remembered as "done".
      if (await ensurePushSubscription()) writeFlag(PUSH_ATTEMPTED_PREFIX, uid);
    }
    setAsking(false);
  }, [uid]);

  const escapeGate = useCallback(() => {
    writeFlag(ESCAPE_PREFIX, uid);
    setEscaped(true);
  }, [uid]);

  const passed =
    permission === null ||           // still checking; do not flash the gate
    permission === "granted" ||
    isNativeApp() ||                 // native has its own high-importance channel
    escaped;

  useEffect(() => {
    if (passed && permission !== null) onPassed?.();
  }, [passed, permission, onPassed]);

  const iosBlocked = permission === "unsupported" && needsIosInstall;

  /**
   * Focus and keyboard containment.
   *
   * The tree behind this overlay is still mounted (see the file header on
   * RequireAuth for why unmounting it is the wrong fix) and every field and
   * link in it is still focusable, so without this Tab walks straight past
   * the gate into the app underneath — a real bypass of a screen whose entire
   * point is that it cannot be bypassed. Escape is deliberately not wired to
   * anything: this gate is not dismissible that way, only through its own
   * buttons.
   */
  useEffect(() => {
    if (passed) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const focusables = () =>
      Array.from(
        container.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.disabled && el.offsetParent !== null);

    const first = focusables()[0] || container;
    first.focus();

    function onKeyDown(e) {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const firstEl = els[0];
      const lastEl = els[els.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [passed, permission, asking, iosBlocked]);

  // Body scroll lock while the gate is up — otherwise the page behind it, which
  // is still fully mounted, keeps scrolling underneath a screen that claims to
  // be blocking everything.
  useEffect(() => {
    if (passed) return undefined;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [passed]);

  if (passed) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="alerts-gate-heading"
      tabIndex={-1}
      // z-[60]: one above Toast's z-50 in Surfaces.jsx. RequireAuth renders the
      // "Signed back in" toast after this gate in document order, so without a
      // higher layer that toast paints over a screen that is supposed to block
      // everything beneath it.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas px-5"
    >
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
          {iosBlocked ? <Share size={22} className="text-accent" />
            : permission === "denied" ? <ShieldAlert size={22} className="text-danger" />
            : <BellRing size={22} className="text-accent" />}
        </div>

        {iosBlocked && (
          <>
            <h1 id="alerts-gate-heading" className="text-[16px] font-bold text-navy">
              Add SI to your Home Screen
            </h1>
            <p className="mt-2 text-[13px] text-ink-soft">
              This app dispatches breakdown repairs, so alerts are not optional — and an iPhone
              only delivers them to an installed app.
            </p>
            <p className="mt-3 text-[13px] text-ink">
              In Safari, tap <span className="font-semibold">Share</span>, then{" "}
              <span className="font-semibold">Add to Home Screen</span>. Open SI from the new icon
              and sign in again.
            </p>
          </>
        )}

        {!iosBlocked && permission === "prompt" && (
          <>
            <h1 id="alerts-gate-heading" className="text-[16px] font-bold text-navy">
              Turn on alerts
            </h1>
            <p className="mt-2 text-[13px] text-ink-soft">
              SI needs to alert you when work is assigned to you. This app dispatches breakdown
              repairs — alerts are not optional.
            </p>
            <Button className="mt-5 w-full justify-center" onClick={enable} disabled={asking}>
              {asking ? "Waiting for your browser…" : "Enable alerts"}
            </Button>
          </>
        )}

        {!iosBlocked && permission === "denied" && (
          <>
            <h1 id="alerts-gate-heading" className="text-[16px] font-bold text-navy">
              Alerts are blocked
            </h1>
            <p className="mt-2 text-[13px] text-ink-soft">
              Your browser's site settings are refusing notifications for SI, and only you can
              undo that — this app cannot ask again once it has been refused.
            </p>
            {/* Native never reaches this component at all — it is excluded from
                `passed` above — so the only real split left is an installed
                home-screen app, which has no address bar, against an ordinary
                browser tab, which has no OS Settings entry of its own. */}
            {isInstalledWebApp() ? (
              <p className="mt-3 text-[13px] text-ink">
                Open your phone's Settings app, find SI (or your browser) under Notifications,
                and turn it on. Then reopen SI.
              </p>
            ) : (
              <p className="mt-3 text-[13px] text-ink">
                Open the padlock or settings icon beside the address bar, find Notifications, and
                set it to Allow. Then reload.
              </p>
            )}
            <button
              onClick={escapeGate}
              className="mt-5 text-[12.5px] text-ink-soft underline hover:text-navy"
            >
              Continue without alerts
            </button>
          </>
        )}

        {!iosBlocked && permission === "unsupported" && (
          <>
            <h1 id="alerts-gate-heading" className="text-[16px] font-bold text-navy">
              This browser cannot show alerts
            </h1>
            <p className="mt-2 text-[13px] text-ink-soft">
              SI cannot notify you here. Use Chrome on Android, or Safari on an iPhone with SI
              added to the Home Screen.
            </p>
            <button
              onClick={escapeGate}
              className="mt-5 text-[12.5px] text-ink-soft underline hover:text-navy"
            >
              Continue without alerts
            </button>
          </>
        )}
      </div>
    </div>
  );
}
