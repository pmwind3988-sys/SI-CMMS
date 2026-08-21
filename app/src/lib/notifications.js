"use client";

/**
 * SI — Service Inside · Notification Module
 * In-app notifications only, per the module's scope — no email/push/SMS
 * transport here. Every notification is written server-side (see si_notify()
 * and its callers in migrations 0003 and 0004); this file only ever reads them
 * and marks them read, matching what the notifications policies allow a client
 * to do with this table — plus, since migration 0038, deletes its own: the
 * table has no retention and no cron sweep, so clearing is the only thing that
 * ever reclaims space from the fastest-growing table in the schema.
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
  /* 0038's fan-out on accept. Without an entry here the new rows fall through
     to the component's grey generic bell, which is how a notification type
     added server-side goes unnoticed. */
  accepted: { label: "Accepted", icon: "ThumbsUp", color: "#22C55E" },
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

/**
 * Clearing is a hard DELETE, not a flag — see 0038. RLS is the boundary
 * (`recipient_id = auth.uid() or si_is_admin()`), so nothing here restates it.
 *
 * But RLS refusing a DELETE removes no rows and raises nothing, exactly as for
 * deleteWorkOrder() in workOrders.js: measured against the policy on the test
 * project, a delete aimed at somebody else's notification comes back `[]` with
 * no error at all. So both functions below select what they deleted and throw
 * when that is empty. A rejected write should look like a rejected write.
 */
export async function deleteNotification(notificationId) {
  const { data, error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("That notification could not be cleared.");
}

/**
 * Deletes the caller's own read notifications. Scoped by `recipient_id` and by
 * `status` as well as by the id list, even though RLS already narrows the
 * first: the ids come from a list the client rendered some seconds ago, and a
 * row that has been marked unread since — or a stale id belonging to somebody
 * else — should match nothing here rather than rely on the policy to catch it.
 *
 * Unread rows are deliberately out of reach: the caller passes read ids only
 * and the `status` filter enforces it server-side too. One mistyped tap must
 * not destroy something nobody has looked at yet.
 */
export async function clearReadNotifications(currentUser, notificationIds) {
  if (notificationIds.length === 0) return 0;
  const { data, error } = await supabase
    .from("notifications")
    .delete()
    .eq("recipient_id", currentUser.uid)
    .eq("status", "read")
    .in("id", notificationIds)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Nothing was cleared — try again.");
  return data.length;
}

/** Where a notification's entity should open — currently only work_order,
    but this stays a lookup (not a hardcoded path) since the entity_type/
    entity_id shape is explicitly meant to be reused by other modules. */
export function pathForNotification(n) {
  if (n.entity_type === "work_order") return `/work-orders/view?id=${n.entity_id}`;
  return "/work-orders";
}
