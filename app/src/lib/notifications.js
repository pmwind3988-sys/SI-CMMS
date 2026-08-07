"use client";

/**
 * SI — Service Inside · Notification Module
 * In-app notifications only, per the module's scope — no email/push/SMS
 * transport here. Every notification is written server-side (see the
 * `notify()` helper and its callers in functions/index.js); this file only
 * ever reads them and marks them read, matching what firestore.rules allows
 * a client to do with this collection.
 */
import { collection, doc, updateDoc, onSnapshot, query, where, orderBy, limit as fbLimit, writeBatch } from "firebase/firestore";
import { db } from "./firebase";

const notificationsCol = collection(db, "notifications");

/**
 * Every notification type this module currently triggers, with the
 * in-app display metadata (icon name is a lucide-react export name,
 * resolved by the component — kept as a string here so this file has no
 * UI-framework dependency of its own).
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
  const q = query(notificationsCol, where("recipient_id", "==", currentUser.uid), orderBy("created_at", "desc"), fbLimit(max));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function markNotificationRead(notificationId) {
  await updateDoc(doc(db, "notifications", notificationId), { status: "read" });
}

export async function markAllNotificationsRead(notificationIds) {
  if (notificationIds.length === 0) return;
  const batch = writeBatch(db);
  notificationIds.forEach((id) => batch.update(doc(db, "notifications", id), { status: "read" }));
  await batch.commit();
}

/** Where a notification's entity should open — currently only work_order,
    but this stays a lookup (not a hardcoded path) since the entity_type/
    entity_id shape is explicitly meant to be reused by other modules. */
export function pathForNotification(n) {
  if (n.entity_type === "work_order") return `/work-orders/view?id=${n.entity_id}`;
  return "/work-orders";
}
