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
import RequireAuth from "../../components/RequireAuth";
import { useAuth } from "../../context/AuthContext";
import { listenNotifications, markNotificationRead, markAllNotificationsRead, pathForNotification, NOTIFICATION_META } from "../../lib/notifications";
import { Card, EmptyState } from "../../components/ui/Surfaces";
import Button from "../../components/ui/Button";

const ICONS = { FileCheck2, UserPlus, UserCheck, Ban, RefreshCw, RotateCcw, CheckCircle2, Clock, AlertOctagon };

function fmtFull(ts) {
  if (!ts?.toDate) return "";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function NotificationsInner() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    if (!user) return;
    // A full history view, not just the bell's recent preview.
    const unsub = listenNotifications(user, setItems, () => setItems([]), 100);
    return unsub;
  }, [user]);

  const unread = (items || []).filter((n) => n.status !== "read");
  const filtered = (items || []).filter((n) => filter === "All" || n.type === filter);
  const typesPresent = Array.from(new Set((items || []).map((n) => n.type)));

  function openNotification(n) {
    if (n.status !== "read") markNotificationRead(n.id).catch(() => {});
    router.push(pathForNotification(n));
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink mb-0.5">Notifications</h1>
          <p className="text-[13px] text-ink-soft">{items ? `${unread.length} unread of ${items.length}` : "Loading…"}</p>
        </div>
        {unread.length > 0 && (
          <Button variant="ghost" size="sm" icon={CheckCheck} onClick={() => markAllNotificationsRead(unread.map((n) => n.id))}>
            Mark all read
          </Button>
        )}
      </div>

      {typesPresent.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setFilter("All")}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-full border"
            style={{ borderColor: filter === "All" ? "#0F3D91" : "#E5E9F0", background: filter === "All" ? "#0F3D9112" : "#fff", color: filter === "All" ? "#0F3D91" : "#64748B" }}
          >
            All
          </button>
          {typesPresent.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-full border"
              style={{ borderColor: filter === t ? "#0F3D91" : "#E5E9F0", background: filter === t ? "#0F3D9112" : "#fff", color: filter === t ? "#0F3D91" : "#64748B" }}
            >
              {NOTIFICATION_META[t]?.label || t}
            </button>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        {items && filtered.length === 0 && (
          <EmptyState>
            <Bell size={18} className="mx-auto mb-2 text-ink-soft opacity-50" />
            No notifications yet.
          </EmptyState>
        )}
        {filtered.map((n, i) => {
          const meta = NOTIFICATION_META[n.type] || { icon: "Bell", color: "#64748B" };
          const Icon = ICONS[meta.icon] || Bell;
          const isUnread = n.status !== "read";
          return (
            <button
              key={n.id}
              onClick={() => openNotification(n)}
              className={`w-full text-left flex items-start gap-3 px-5 py-4 hover:bg-canvas ${i > 0 ? "border-t border-[#F1F3F5]" : ""}`}
              style={{ background: isUnread ? "#F6F8FB" : "transparent" }}
            >
              <Icon size={17} style={{ color: meta.color, marginTop: 1, flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-ink">{n.title}</span>
                  <span className="text-[11px] text-ink-soft font-mono whitespace-nowrap">{fmtFull(n.created_at)}</span>
                </div>
                <div className="text-[12.5px] text-ink-soft mt-0.5">{n.body}</div>
                {n.entity_label && <div className="text-[11px] text-ink-soft font-mono mt-1">{n.entity_label}</div>}
              </div>
              {isUnread && <div className="w-2 h-2 rounded-full bg-danger mt-1.5 flex-shrink-0" />}
            </button>
          );
        })}
      </Card>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <NotificationsInner />
    </RequireAuth>
  );
}
