"use client";

import { useEffect, useState, useRef } from "react";
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
  ThumbsUp,
  ArrowUpDown,
  PackageSearch,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import RequireAuth from "../../components/RequireAuth";
import { useAuth } from "../../context/AuthContext";
import {
  listenNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearReadNotifications,
  pathForNotification,
  NOTIFICATION_META,
  NOTIFICATION_SOURCES,
  SOURCE_ORDER,
  notificationSource,
} from "../../lib/notifications";
import NotificationTags from "../../components/NotificationTags";
import { describeError } from "../../lib/errors";
import { Card, EmptyState, ErrorBanner, ModalOverlay, Toast } from "../../components/ui/Surfaces";
import { usePaged, useAutoPageSize, PagerFooter } from "../../components/ui/Paged";
import Button from "../../components/ui/Button";

const ICONS = { FileCheck2, UserPlus, UserCheck, Ban, RefreshCw, RotateCcw, CheckCircle2, Clock, AlertOctagon, ThumbsUp, ArrowUpDown, PackageSearch, ShieldCheck };

// Postgres timestamptz arrives as an ISO 8601 string over PostgREST, not as a
// Firebase Timestamp object — so test parseability, not for a .toDate method.
function fmtFull(ts) {
  if (!ts || Number.isNaN(Date.parse(ts))) return "";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function NotificationsInner() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("All");
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    // A full history view, not just the bell's recent preview.
    const unsub = listenNotifications(user, setItems, () => setItems([]), 100);
    return unsub;
  }, [user]);

  const unread = (items || []).filter((n) => n.status !== "read");
  const read = (items || []).filter((n) => n.status === "read");
  /* Filtered by CATEGORY, not by type. Twelve type chips wrapped to three rows
     on a phone and asked the reader to know the difference between "Status
     update" and "Accepted" before they could use it; four categories answer the
     question people actually arrive with — is this about work I reported, work
     somebody is doing, or something waiting on me to decide. */
  const filtered = (items || []).filter((n) => filter === "All" || notificationSource(n) === filter);

  /* "Mark all read" and "Clear read" deliberately keep acting on `unread` and
     `read` - every loaded row, not the page on screen. A button whose meaning
     changed with how far you had paged would be the worse bug. */
  const listRef = useRef(null);
  const pageSize = useAutoPageSize(listRef, { min: 3, ready: !!items, signature: filtered.length });

  const pager = usePaged(filtered, { pageSize, resetKey: filter });
  const sourcesPresent = SOURCE_ORDER.filter((k) => (items || []).some((n) => notificationSource(n) === k));

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function openNotification(n) {
    if (n.status !== "read") markNotificationRead(n.id).catch(() => {});
    router.push(pathForNotification(n));
  }

  /* Clearing is a hard delete (migration 0038) — the row is gone from the
     database, not hidden. liveQuery re-runs on the delete event, so the list
     re-renders from what RLS returns now rather than from a patched local copy,
     and no optimistic removal is needed here. */
  async function dismissOne(n) {
    setError(null);
    try {
      await deleteNotification(n.id);
    } catch (e) {
      setError(describeError(e, "Couldn't clear that one — try again."));
    }
  }

  async function clearRead() {
    setBusy(true);
    setError(null);
    try {
      const n = await clearReadNotifications(user, read.map((r) => r.id));
      setConfirmClear(false);
      flash(n === 1 ? "1 notification cleared." : `${n} notifications cleared.`);
    } catch (e) {
      setError(describeError(e, "Couldn't clear — try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink mb-0.5">Notifications</h1>
          <p className="text-[13px] text-ink-soft">{items ? `${unread.length} unread of ${items.length}` : "Loading…"}</p>
        </div>
        {/* Two actions, and the order matters: reading is what makes a row
            eligible for the destructive one, so "Mark all read" sits first. */}
        <div className="flex items-center gap-1.5">
          {unread.length > 0 && (
            <Button variant="ghost" size="sm" icon={CheckCheck} onClick={() => markAllNotificationsRead(unread.map((n) => n.id))}>
              Mark all read
            </Button>
          )}
          {read.length > 0 && (
            <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setConfirmClear(true)}>
              Clear read
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {sourcesPresent.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap" role="radiogroup" aria-label="Filter notifications by what they are about">
          <button
            type="button"
            role="radio"
            aria-checked={filter === "All"}
            onClick={() => setFilter("All")}
            className="min-h-[40px] text-[12px] font-semibold px-3.5 py-1.5 rounded-full border"
            style={{ borderColor: filter === "All" ? "#0F3D91" : "#E5E9F0", background: filter === "All" ? "#0F3D9112" : "#fff", color: filter === "All" ? "#0F3D91" : "#5A6880" }}
          >
            All
          </button>
          {sourcesPresent.map((k) => {
            const src = NOTIFICATION_SOURCES[k];
            const n = (items || []).filter((x) => notificationSource(x) === k).length;
            const on = filter === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setFilter(k)}
                className="min-h-[40px] text-[12px] font-semibold px-3.5 py-1.5 rounded-full border"
                style={{ borderColor: on ? src.color : "#E5E9F0", background: on ? `${src.color}12` : "#fff", color: on ? src.color : "#5A6880" }}
              >
                {src.short}
                <span className="ml-1.5 font-normal opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      <Card className="overflow-hidden">
        {items && filtered.length === 0 && (
          <EmptyState>
            <Bell size={18} className="mx-auto mb-2 text-ink-soft opacity-50" />
            No notifications yet.
          </EmptyState>
        )}
        <div ref={listRef}>
        {pager.visible.map((n, i) => {
          const meta = NOTIFICATION_META[n.type] || { icon: "Bell", color: "#64748B" };
          const Icon = ICONS[meta.icon] || Bell;
          const isUnread = n.status !== "read";
          return (
            /* The row used to be a single <button>. The dismiss control cannot
               live inside one — a button nested in a button is invalid HTML and
               React's onClick would fire both — so the row is now a flex
               container holding two siblings: the button that opens the work
               order, and the one that clears the notification. */
            <div
              key={n.id}
              className={`flex items-start hover:bg-canvas ${i > 0 ? "border-t border-[#F1F3F5]" : ""}`}
              style={{ background: isUnread ? "#F6F8FB" : "transparent" }}
            >
              <button
                onClick={() => openNotification(n)}
                className="min-w-0 flex-1 text-left flex items-start gap-3 pl-4 py-3.5 sm:pl-5 sm:py-4"
              >
                <Icon size={17} style={{ color: meta.color, marginTop: 1, flexShrink: 0 }} />
                <div className="min-w-0 flex-1">
                  {/* Wraps to two lines on a phone instead of squeezing the
                      timestamp — notification titles run to a full clause. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="text-[13.5px] font-semibold text-ink">{n.title}</span>
                    <span className="text-[11px] text-ink-soft font-mono whitespace-nowrap">{fmtFull(n.created_at)}</span>
                  </div>
                  <div className="text-[12.5px] text-ink-soft mt-0.5">{n.body}</div>
                  <NotificationTags notification={n} className="mt-1.5" />
                  {n.entity_label && <div className="text-[11px] text-ink-soft font-mono mt-1">{n.entity_label}</div>}
                </div>
                {isUnread && <div className="w-2 h-2 rounded-full bg-danger mt-1.5 flex-shrink-0" />}
              </button>
              {/* 40px square rather than a bare 14px glyph: this is a phone
                  target sitting next to a much larger one, and an × that takes
                  two attempts to hit is worse than no × at all. */}
              <button
                onClick={() => dismissOne(n)}
                aria-label="Clear this notification"
                title="Clear this notification"
                className="flex-shrink-0 w-10 h-10 mt-2 mr-1 sm:mr-2 flex items-center justify-center rounded text-ink-soft hover:text-danger hover:bg-white"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
        </div>
        <PagerFooter pager={pager} noun="notifications" />
      </Card>

      {/* Named count rather than "are you sure": the number is the only thing
          that tells someone whether they are about to lose one stale row or a
          month of them. Unread rows are not in `read`, so the copy can promise
          they survive and mean it. */}
      {confirmClear && (
        <ModalOverlay onClose={() => setConfirmClear(false)} label="Clear read notifications">
          <div className="bg-white rounded-t-xl sm:rounded-xl w-full sm:max-w-sm p-5">
            <h2 className="text-[15px] font-bold text-ink mb-1.5">
              Clear {read.length} read notification{read.length === 1 ? "" : "s"}?
            </h2>
            <p className="text-[12.5px] text-ink-soft mb-4">
              They are deleted for good — this cannot be undone.
              {unread.length > 0 && ` Your ${unread.length} unread notification${unread.length === 1 ? "" : "s"} will stay.`}
              {" "}The work orders themselves are not affected.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>Cancel</Button>
              <Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={clearRead}>
                {busy ? "Clearing…" : "Clear them"}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      <Toast message={toast} />
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
