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
 */
import { useCallback, useEffect, useState } from "react";
import { BellRing, Share, ShieldAlert } from "lucide-react";
import Button from "./ui/Button";
import {
  iosNeedsInstallForAlerts,
  isNativeApp,
  osNotificationPermission,
  requestOsNotificationPermission,
} from "../lib/osNotifications";
import { ensurePushSubscription } from "../lib/pushSubscription";

export default function AlertsGate({ onPassed }) {
  const [permission, setPermission] = useState(null);   // null = still checking
  const [needsIosInstall, setNeedsIosInstall] = useState(false);
  const [escaped, setEscaped] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    osNotificationPermission().then((p) => {
      if (!alive) return;
      setPermission(p);
      setNeedsIosInstall(iosNeedsInstallForAlerts());
      if (p === "granted") ensurePushSubscription();
    });
    return () => { alive = false; };
  }, []);

  const enable = useCallback(async () => {
    setAsking(true);
    // Must be inside the click. Both platforms only accept a permission request
    // during the transient activation the gesture grants, and awaiting anything
    // before this line can run that activation out.
    const next = await requestOsNotificationPermission();
    setPermission(next);
    if (next === "granted") await ensurePushSubscription();
    setAsking(false);
  }, []);

  const passed =
    permission === null ||           // still checking; do not flash the gate
    permission === "granted" ||
    isNativeApp() ||                 // native has its own high-importance channel
    escaped;

  useEffect(() => {
    if (passed && permission !== null) onPassed?.();
  }, [passed, permission, onPassed]);

  if (passed) return null;

  const iosBlocked = permission === "unsupported" && needsIosInstall;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
          {iosBlocked ? <Share size={22} className="text-accent" />
            : permission === "denied" ? <ShieldAlert size={22} className="text-danger" />
            : <BellRing size={22} className="text-accent" />}
        </div>

        {iosBlocked && (
          <>
            <h1 className="text-[16px] font-bold text-navy">Add SI to your Home Screen</h1>
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
            <h1 className="text-[16px] font-bold text-navy">Turn on alerts</h1>
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
            <h1 className="text-[16px] font-bold text-navy">Alerts are blocked</h1>
            <p className="mt-2 text-[13px] text-ink-soft">
              Your {isNativeApp() ? "phone's app settings" : "browser's site settings"} are
              refusing notifications for SI, and only you can undo that — this app cannot ask
              again once it has been refused.
            </p>
            <p className="mt-3 text-[13px] text-ink">
              Open the padlock or settings icon beside the address bar, find Notifications, and
              set it to Allow. Then reload.
            </p>
            <button
              onClick={() => setEscaped(true)}
              className="mt-5 text-[12.5px] text-ink-soft underline hover:text-navy"
            >
              Continue without alerts
            </button>
          </>
        )}

        {!iosBlocked && permission === "unsupported" && (
          <>
            <h1 className="text-[16px] font-bold text-navy">This browser cannot show alerts</h1>
            <p className="mt-2 text-[13px] text-ink-soft">
              SI cannot notify you here. Use Chrome on Android, or Safari on an iPhone with SI
              added to the Home Screen.
            </p>
            <button
              onClick={() => setEscaped(true)}
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
