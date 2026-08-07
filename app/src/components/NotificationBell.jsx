"use client";

import { useEffect, useState } from "react";
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

function fmtRelative(ts) {
  if (!ts?.toDate) return "";
  const diffMs = Date.now() - ts.toDate().getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return ts.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!user) return;
    const unsub = listenNotifications(user, setItems, (err) => console.error("notifications", err));
    return unsub;
  }, [user]);

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
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative" aria-label="Notifications">
        <Bell size={19} className="text-ink-soft" />
        {unread.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-danger" />}
      </button>
      {open && (
        <div className="absolute right-0 top-8 w-80 bg-white rounded border border-border shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-bold text-[13px] text-ink">Notifications</span>
            {unread.length > 0 && (
              <button onClick={handleMarkAllRead} className="flex items-center gap-1 text-[11.5px] text-ink-soft hover:text-navy">
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
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
      )}
    </div>
  );
}
