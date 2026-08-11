"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
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
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { listenNotifications, markNotificationRead, markAllNotificationsRead, pathForNotification, NOTIFICATION_META } from "../lib/notifications";

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
  const rootRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    const unsub = listenNotifications(user, setItems, (err) => console.error("notifications", err));
    return unsub;
  }, [user]);

  // Tapping anywhere else closes it. On a phone the panel covers most of the
  // screen, so without this the only way out was the bell itself — which is
  // underneath it once the header stops being the top thing on the page.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
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
