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
 * WHO THE EVENT CAME FROM — the categories the list is grouped and filtered by.
 *
 * Not "who it was sent to": every row already carries `recipient_role`, and
 * grouping by that tells you nothing, because on your own list you are always
 * the recipient. What is worth separating is whose ACTION produced it — work
 * you reported moving, versus work somebody is doing, versus the queue asking
 * for a decision, versus a clock going off with nobody involved at all.
 *
 * Four, not more: the point of a category is that a glance sorts the list, and
 * a filter row with ten chips is the flat stream it replaced.
 */
export const NOTIFICATION_SOURCES = {
  requester: { label: "From the requester", short: "Requester", color: "#0F3D91" },
  technician: { label: "From the technician", short: "Technician", color: "#22C55E" },
  assignment: { label: "Needs a decision", short: "Assignment", color: "#F59E0B" },
  system: { label: "From the system", short: "System", color: "#64748B" },
};

export const SOURCE_ORDER = ["assignment", "technician", "requester", "system"];

/**
 * Every notification type this module currently triggers, with the in-app
 * display metadata (icon name is a lucide-react export name, resolved by the
 * component — kept as a string here so this file has no UI-framework
 * dependency of its own).
 *
 * `source` is one of NOTIFICATION_SOURCES above and describes what CAUSED the
 * event, which is not always who receives it: `completed` is the technician's
 * doing and lands on the requester's list, and `verified_closed` is the
 * reverse. Getting that backwards would make the two categories mean "my work
 * orders" and "other people's", which is the same list twice.
 *
 * The phase each row is about is NOT here — it is `notifications.wo_status`,
 * stamped per row by si_notify() (migration 0056), because one type covers
 * several phases: `status_change` is accept, start-work and resume-after-part.
 * A phase mapped from the type here would be a second, quietly wrong answer to
 * a question the row already carries the right answer to.
 */
export const NOTIFICATION_META = {
  submitted: { label: "Work order submitted", icon: "FileCheck2", color: "#0F3D91", source: "requester" },
  needs_assignment: { label: "Needs assignment", icon: "UserPlus", color: "#EF4444", source: "assignment" },
  assigned: { label: "Assigned", icon: "UserCheck", color: "#0F3D91", source: "assignment" },
  declined: { label: "Declined", icon: "Ban", color: "#EF4444", source: "assignment" },
  /* 0038's fan-out on accept. Without an entry here the new rows fall through
     to the component's grey generic bell, which is how a notification type
     added server-side goes unnoticed. */
  accepted: { label: "Accepted", icon: "ThumbsUp", color: "#22C55E", source: "technician" },
  /* 0051's Administrator re-grade. Violet, matching P7's badge, because the
     re-grade that matters most is the one to or from long-term work. */
  priority_changed: { label: "Priority changed", icon: "ArrowUpDown", color: "#7C3AED", source: "assignment" },
  status_change: { label: "Status update", icon: "RefreshCw", color: "#F59E0B", source: "technician" },
  /* 0056. The repair has stopped on something nobody in the app can fix by
     working harder — amber rather than red: it is a hold, not a failure. */
  waiting_part: { label: "Waiting for a part", icon: "PackageSearch", color: "#F59E0B", source: "technician" },
  reopened: { label: "Reopened", icon: "RotateCcw", color: "#EF4444", source: "requester" },
  completed: { label: "Completed — verify", icon: "CheckCircle2", color: "#22C55E", source: "technician" },
  /* 0056. The end of the flow, and the one message a technician gets that is
     purely good news — hence its own type and its own icon rather than another
     grey status_change. */
  verified_closed: { label: "Verified and closed", icon: "ShieldCheck", color: "#22C55E", source: "requester" },
  sla_warning: { label: "SLA warning", icon: "Clock", color: "#F59E0B", source: "system" },
  sla_breach: { label: "SLA breached", icon: "AlertOctagon", color: "#EF4444", source: "system" },
};

/** The category a row belongs to, defaulting the way the icon does. */
export function notificationSource(n) {
  return NOTIFICATION_META[n?.type]?.source || "system";
}

export function listenNotifications(currentUser, cb, onError, max = 30) {
  return liveQuery({
    table: "notifications",
    filter: `recipient_id=eq.${currentUser.uid}`,
    run: () =>
      supabase
        .from("notifications")
        .select("*")
        .eq("recipient_id", currentUser.uid)
        /* Newest first, then by id — and the tie-break is not decoration.
           si_notify() fans one event out to several recipients inside a single
           transaction, so those rows carry an IDENTICAL created_at. Postgres
           gives ties no defined order, and liveQuery re-runs the whole query on
           every relevant change rather than patching a local cache, so without
           a second key the same batch can come back in a different order each
           time and the list visibly reshuffles under the reader. */
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
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
