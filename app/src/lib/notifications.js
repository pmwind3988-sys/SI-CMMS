"use client";

/**
 * SI — Service Inside · Notification Module
 * In-app notifications only, per the module's scope — no email/push/SMS
 * transport here. Every notification is written server-side (see si_notify()
 * and its callers in migrations 0003 and 0004); this file only ever reads them
 * and marks them read, matching what the notifications policies allow a client
 * to do with this table.
 */
import { supabase, liveQuery } from "./supabase";

/**
 * Every notification type this module currently triggers, with the in-app
 * display metadata (icon name is a lucide-react export name, resolved by the
 * component — kept as a string here so this file has no UI-framework
 * dependency of its own).
 */
export const NOTIFICATION_META = {
  submitted: { label: "Work order submitted", icon: "FileCheck2", color: "#0F3D91" },
  needs_assignment: { label: "Needs assignment", icon: "UserPlus", color: "#EF4444" },
  assigned: { label: "Assigned", icon: "UserCheck", color: "#0F3D91" },
  declined: { label: "Declined", icon: "Ban", color: "#EF4444" },
  status_change: { label: "Status update", icon: "RefreshCw", color: "#F59E0B" },
  reopened: { label: "Reopened", icon: "RotateCcw", color: "#EF4444" },
  completed: { label: "Completed — verify", icon: "CheckCircle2", color: "#22C55E" },
  sla_warning: { label: "SLA warning", icon: "Clock", color: "#F59E0B" },
  sla_breach: { label: "SLA breached", icon: "AlertOctagon", color: "#EF4444" },
};

export function listenNotifications(currentUser, cb, onError, max = 30) {
  return liveQuery({
    table: "notifications",
    filter: `recipient_id=eq.${currentUser.uid}`,
    run: () =>
      supabase
        .from("notifications")
        .select("*")
        .eq("recipient_id", currentUser.uid)
        .order("created_at", { ascending: false })
        .limit(max),
    cb,
    onError,
  });
}

export async function markNotificationRead(notificationId) {
  const { error } = await supabase
    .from("notifications")
    .update({ status: "read" })
    .eq("id", notificationId);
  if (error) throw error;
}

/**
 * One statement rather than Firestore's writeBatch — `in` covers the whole set,
 * and RLS still evaluates the recipient check per row, so a forged id in the
 * list simply matches nothing.
 */
export async function markAllNotificationsRead(notificationIds) {
  if (notificationIds.length === 0) return;
  const { error } = await supabase
    .from("notifications")
    .update({ status: "read" })
    .in("id", notificationIds);
  if (error) throw error;
}

/** Where a notification's entity should open — currently only work_order,
    but this stays a lookup (not a hardcoded path) since the entity_type/
    entity_id shape is explicitly meant to be reused by other modules. */
export function pathForNotification(n) {
  if (n.entity_type === "work_order") return `/work-orders/view?id=${n.entity_id}`;
  return "/work-orders";
}
