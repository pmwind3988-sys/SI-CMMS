"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellRing,
  FileCheck2,
  UserPlus,
  UserCheck,
  Ban,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertOctagon,
  CheckCheck,
  Share,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useOutsideTap } from "../lib/useOutsideTap";
import { listenNotifications, markNotificationRead, markAllNotificationsRead, pathForNotification, NOTIFICATION_META } from "../lib/notifications";
import {
  appIsInBackground,
  iosNeedsInstallForAlerts,
  isNativeApp,
  onOsNotificationTapped,
  osNotificationPermission,
  playNotificationChime,
  presentOsNotification,
  presentOsNotificationSummary,
  primeNotificationSound,
  requestOsNotificationPermission,
} from "../lib/osNotifications";

const ICONS = { FileCheck2, UserPlus, UserCheck, Ban, RefreshCw, RotateCcw, CheckCircle2, Clock, AlertOctagon };

// Postgres timestamptz arrives as an ISO 8601 string over PostgREST, not as a
// Firebase Timestamp object — so test parseability, not for a .toDate method.
function fmtRelative(ts) {
  if (!ts || Number.isNaN(Date.parse(ts))) return "";
  const diffMs = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [osPermission, setOsPermission] = useState("unsupported");
  // Whether "unsupported" is the fixable kind — an iPhone in Safari rather than
  // in the installed app. Held in state, not read during render, because it
  // depends on `navigator` and the server has no opinion about the device.
  const [needsIosInstall, setNeedsIosInstall] = useState(false);
  const rootRef = useRef(null);
  // { watermark: epoch ms, ids: Set } — what has already been announced to the
  // OS this session. A ref, not state: announcing must not re-render, and the
  // value is read inside the subscription callback where a stale closure over
  // state would re-announce everything on every event.
  const announcedRef = useRef(null);

  useEffect(() => {
    let active = true;
    setNeedsIosInstall(iosNeedsInstallForAlerts());
    osNotificationPermission().then((p) => {
      if (active) setOsPermission(p);
    });
    return () => {
      active = false;
    };
  }, [user]);

  // The chime is Web Audio, and a context that never saw a gesture stays
  // suspended and plays nothing — silently, with no error. Any first interaction
  // on the page unlocks it; signing in is itself a click, so by the time a
  // notification can arrive this has almost always already run.
  useEffect(() => {
    const prime = () => primeNotificationSound();
    window.addEventListener("pointerdown", prime, { once: true, passive: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  /**
   * Decide what in a fresh batch deserves the OS, and show it.
   *
   * `liveQuery` re-runs the whole query on every relevant event rather than
   * patching a cache (see lib/supabase.js), so this callback sees the full list
   * again each time — including on an unrelated mark-as-read. Everything below
   * exists to tell a genuinely new row from the same row arriving again.
   */
  const announce = useCallback((rows) => {
    const newest = rows.reduce((max, r) => {
      const t = Date.parse(r.created_at);
      return Number.isNaN(t) ? max : Math.max(max, t);
    }, 0);

    // The first batch is the baseline, never an announcement. It is whatever was
    // already waiting when the app opened, and firing a day of backlog into the
    // status bar at sign-in is how a notification permission gets revoked.
    if (!announcedRef.current) {
      announcedRef.current = { watermark: newest, ids: new Set(rows.map((r) => r.id)) };
      return;
    }

    const state = announcedRef.current;
    const fresh = rows
      .filter((r) => r.status !== "read" && !state.ids.has(r.id))
      // >= rather than >: si_notify() fans a single event out to several
      // recipients in one transaction, so those rows share an identical
      // created_at. Realtime still delivers them one at a time, so a strict
      // compare would announce whichever arrived first and swallow the rest.
      .filter((r) => {
        const t = Date.parse(r.created_at);
        return !Number.isNaN(t) && t >= state.watermark;
      })
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    state.watermark = Math.max(state.watermark, newest);
    rows.forEach((r) => state.ids.add(r.id));
    // The set only has to stop a re-announce, so it can be collapsed back to the
    // current window whenever it grows past the point of being useful.
    if (state.ids.size > 400) state.ids = new Set(rows.map((r) => r.id));

    if (fresh.length === 0) return;

    playNotificationChime();

    // In the foreground the badge on this very bell is already the notification;
    // duplicating it in the shade is noise, and noise is what gets alerts muted.
    if (!appIsInBackground()) return;

    if (fresh.length > 3) {
      presentOsNotificationSummary(fresh.length);
      return;
    }
    fresh.forEach((n) =>
      presentOsNotification({
        id: n.id,
        title: n.title,
        body: n.body,
        path: pathForNotification(n),
      })
    );
  }, []);

  useEffect(() => {
    if (!user) return;
    // Per user: a different account signing in on the same device starts its own
    // baseline rather than inheriting the last one's watermark.
    announcedRef.current = null;
    const unsub = listenNotifications(
      user,
      (rows) => {
        setItems(rows);
        announce(rows);
      },
      (err) => console.error("notifications", err)
    );
    return unsub;
  }, [user, announce]);

  // Tapping the Android notification has to land on the work order, not just on
  // whatever screen the app was last showing. Web has no equivalent listener —
  // the click handler lives on the Notification object itself.
  useEffect(() => {
    if (!isNativeApp()) return;
    let active = true;
    let dispose = () => {};
    onOsNotificationTapped((path) => router.push(path)).then((d) => {
      if (active) dispose = d;
      else d();
    });
    return () => {
      active = false;
      dispose();
    };
  }, [router]);

  async function enableAlerts() {
    const next = await requestOsNotificationPermission();
    setOsPermission(next);
    if (next === "granted") {
      // Deliberately shown while the app is in the foreground, against the rule
      // above: it is the only proof the user gets that the permission took and
      // that the sound is audible at their current volume.
      presentOsNotification({
        id: "si-alerts-enabled",
        title: "Alerts are on",
        body: "SI will notify you here when a work order needs you.",
        path: "/notifications/",
      });
      playNotificationChime();
    }
  }

  // Tapping anywhere else closes it. On a phone the panel covers most of the
  // screen, so without this the only way out was the bell itself — which is
  // underneath it once the header stops being the top thing on the page.
  //
  // A *drag* outside is not that tap. The shield below is `sm:hidden`, so from
  // `sm` up — every tablet — there is live page behind this panel, and closing
  // on pointerdown killed it on the first frame of a scroll. Measured at 768px:
  // dragging the page shut the panel every time. useOutsideTap carries the
  // reasoning. Below `sm` this changes nothing: the shield is inside rootRef,
  // so those touches were never "outside" to begin with, and a tap on it still
  // dismisses through its own onClick.
  useOutsideTap(rootRef, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const unread = items.filter((n) => n.status !== "read");

  function openNotification(n) {
    if (n.status !== "read") markNotificationRead(n.id).catch(() => {});
    setOpen(false);
    router.push(pathForNotification(n));
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead(unread.map((n) => n.id)).catch(() => {});
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative"
        aria-label="Notifications"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bell size={19} className="text-ink-soft" />
        {unread.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-danger" />}
      </button>
      {open && (
        <>
          {/* A tap shield rather than a visual scrim: the panel is anchored to
              the viewport below, so on a phone there is a lot of page behind it
              whose buttons would otherwise still be live. */}
          <div className="fixed inset-0 z-40 sm:hidden" aria-hidden="true" onClick={() => setOpen(false)} />
          {/*
            Positioning, and why it is two different things.

            The panel is 20rem wide and was anchored `absolute right-0` to the
            bell. The bell is not at the right edge of the header — the role
            badge sits beside it, and "Administrator" is wide — so on a phone
            those 20rem were measured leftwards from roughly the middle of the
            screen and ran off the left edge entirely. Capping the width at the
            viewport did not help: the overflow was in where it started, not in
            how wide it was.

            Below `sm` it is therefore pinned to the viewport instead, with equal
            gutters, which cannot depend on what else the header happens to be
            carrying. From `sm` up the anchored dropdown is correct and is what
            it goes back to. `fixed` resolves against the viewport here because
            nothing in the header chain sets a transform or a filter.
          */}
          <div
            role="menu"
            className="rise fixed inset-x-3 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 overflow-hidden rounded border border-border bg-white shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-8 sm:w-80"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-bold text-[13px] text-ink">Notifications</span>
              {unread.length > 0 && (
                <button onClick={handleMarkAllRead} className="flex items-center gap-1 text-[11.5px] text-ink-soft hover:text-navy">
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
            </div>
            {/*
              The opt-in lives here rather than as a banner on the dashboard for
              one hard reason and one soft one. Hard: both platforms only accept
              a permission request that came from a user gesture, so it needs a
              button someone chose to press. Soft: this panel is where someone is
              already thinking about notifications, so it is where an offer to
              deliver them outside the app makes sense.

              "denied" gets copy instead of a button because it is final —
              neither platform will re-prompt after a refusal, and only the OS
              settings screen can undo it.
            */}
            {osPermission === "prompt" && (
              <button
                onClick={enableAlerts}
                className="flex w-full items-start gap-2 border-b border-border bg-accent-soft/50 px-4 py-2.5 text-left"
              >
                <BellRing size={13} className="mt-0.5 flex-shrink-0 text-accent" />
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-semibold text-navy">Turn on alerts with sound</span>
                  <span className="block text-[10.5px] text-ink-soft">
                    Shows in your {isNativeApp() ? "phone's status bar" : "notification centre"} while SI is in the
                    background.
                  </span>
                </span>
              </button>
            )}
            {/*
              iOS gives an uninstalled site no Notification API at all, so there
              is no permission to ask for and the button above cannot appear —
              the opt-in is installing the app, and it happens in Safari's share
              sheet where nothing here can reach. Instructions are the only
              honest option. Once it is on the Home Screen this collapses back
              into the ordinary "prompt" case.
            */}
            {osPermission === "unsupported" && needsIosInstall && (
              <div className="flex items-start gap-2 border-b border-border bg-accent-soft/50 px-4 py-2.5">
                <Share size={13} className="mt-0.5 flex-shrink-0 text-accent" />
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-semibold text-navy">Add SI to your Home Screen</span>
                  <span className="block text-[10.5px] text-ink-soft">
                    In Safari, tap Share then &ldquo;Add to Home Screen&rdquo;. iPhone only delivers alerts to an
                    installed app.
                  </span>
                </span>
              </div>
            )}
            {osPermission === "denied" && (
              <div className="flex items-start gap-2 border-b border-border bg-canvas px-4 py-2.5">
                <BellRing size={13} className="mt-0.5 flex-shrink-0 text-ink-soft" />
                <span className="text-[10.5px] text-ink-soft">
                  Alerts outside the app are blocked. Re-enable notifications for SI in your{" "}
                  {isNativeApp() ? "phone's app settings" : "browser's site settings"}.
                </span>
              </div>
            )}
            {/* Capped against the viewport, not the content: the list has to end
                above the bottom of the screen whether it holds two items or forty. */}
            <div className="max-h-[min(24rem,60dvh)] overflow-y-auto">
            {items.length === 0 && <div className="p-5 text-[12.5px] text-ink-soft text-center">You're all caught up.</div>}
            {items.map((n) => {
              const meta = NOTIFICATION_META[n.type] || { icon: "Bell", color: "#64748B" };
              const Icon = ICONS[meta.icon] || Bell;
              const isUnread = n.status !== "read";
              return (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className="w-full text-left flex items-start gap-2.5 px-4 py-3 border-t border-[#F1F3F5] hover:bg-canvas first:border-t-0"
                  style={{ background: isUnread ? "#F6F8FB" : "transparent" }}
                >
                  <Icon size={15} style={{ color: meta.color, marginTop: 1, flexShrink: 0 }} />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-ink">{n.title}</div>
                    <div className="text-[11.5px] text-ink-soft mt-0.5">{n.body}</div>
                    <div className="text-[10.5px] text-ink-soft mt-1 font-mono">{fmtRelative(n.created_at)}</div>
                  </div>
                  {isUnread && <div className="w-1.5 h-1.5 rounded-full bg-danger mt-1.5 flex-shrink-0" />}
                </button>
              );
            })}
            </div>
            <div className="px-4 py-2.5 border-t border-border text-center">
              <button
                onClick={() => {
                  setOpen(false);
                  router.push("/notifications");
                }}
                className="text-[12px] font-semibold text-navy"
              >
                View all notifications
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
