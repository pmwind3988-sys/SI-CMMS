"use client";

/**
 * SI — Service Inside · Work Order Module
 * Firestore data-access layer. Every exported function maps 1:1 to a
 * clause in firestore.rules — this file shapes writes, it does not
 * authorize them; the rules are the actual authorization boundary.
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit as fbLimit,
  serverTimestamp,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, app } from "./firebase";
import { ROLES } from "./roles";

const woCol = collection(db, "work_orders");
const historyCol = collection(db, "work_order_history");
const commentsCol = collection(db, "comments");
const attachmentsCol = collection(db, "attachments");

/* ------------------------------------------------------------------
   CREATE
-------------------------------------------------------------------*/
export async function createWorkOrder({
  departmentId,
  assetId,
  assetName,
  type,
  priority,
  impact,
  estDowntimeValue,
  estDowntimeUnit,
  description,
  safetyRisk,
  environmentalRisk,
  requesterId,
  requesterName,
  requesterPhone,
}) {
  const docRef = await addDoc(woCol, {
    department_id: departmentId,
    asset_id: assetId,
    asset_name: assetName,
    type,
    priority,
    status: "open",
    impact,
    est_downtime_value: Number(estDowntimeValue),
    est_downtime_unit: estDowntimeUnit,
    description,
    safety_risk: safetyRisk || { flag: false, severity: null },
    environmental_risk: environmentalRisk || { flag: false },
    permit_required: !!safetyRisk?.flag,
    requester_id: requesterId,
    requester_name: requesterName,
    requester_phone: requesterPhone,
    assigned_to_id: null,
    assigned_to_name: null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    // wo_number / sla_ack_due_at / sla_resolution_due_at / sla_breached /
    // decline_count are all filled in server-side by onWorkOrderCreate —
    // counters and SLA computation are never client-writable.
  });
  return docRef.id;
}

/* ------------------------------------------------------------------
   EDIT — core fields, while status is still "open" only.
-------------------------------------------------------------------*/
export async function updateWorkOrderFields(woId, fields) {
  await updateDoc(doc(db, "work_orders", woId), {
    ...fields,
    status: "open", // rules require status to remain "open" through this path
    updated_at: serverTimestamp(),
  });
}

/* ------------------------------------------------------------------
   READS (real-time listeners)
-------------------------------------------------------------------*/
export function listenWorkOrder(woId, cb, onError) {
  return onSnapshot(doc(db, "work_orders", woId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null), onError);
}

/** Role-scoped list, mirroring exactly what the security rules allow. */
export function listenWorkOrderList(currentUser, cb, onError) {
  let q;
  if (currentUser.role === ROLES.REQUESTER) {
    q = query(woCol, where("requester_id", "==", currentUser.uid), orderBy("created_at", "desc"));
  } else if (currentUser.role === ROLES.TECHNICIAN) {
    q = query(woCol, where("assigned_to_id", "==", currentUser.uid), orderBy("created_at", "desc"));
  } else if (currentUser.role === ROLES.SUPERVISOR) {
    q = query(woCol, where("department_id", "==", currentUser.departmentId), orderBy("created_at", "desc"));
  } else {
    // manager / admin — system-wide.
    q = query(woCol, orderBy("created_at", "desc"), fbLimit(300));
  }
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export function listenWorkOrderHistory(woId, cb, onError) {
  const q = query(historyCol, where("work_order_id", "==", woId), orderBy("created_at", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export function listenComments(woId, cb, onError) {
  const q = query(
    commentsCol,
    where("entity_type", "==", "work_order"),
    where("entity_id", "==", woId),
    orderBy("created_at", "asc")
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export function listenAttachments(woId, cb, onError) {
  const q = query(
    attachmentsCol,
    where("entity_type", "==", "work_order"),
    where("entity_id", "==", woId),
    orderBy("uploaded_at", "desc")
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

/* ------------------------------------------------------------------
   COMMENTS — unifies what earlier iterations called "progress notes"
   into the single, reusable comments collection every module shares.
-------------------------------------------------------------------*/
export async function addComment(woId, actor, text) {
  await addDoc(commentsCol, {
    entity_type: "work_order",
    entity_id: woId,
    author_id: actor.uid,
    author_name: actor.name,
    author_role: actor.role,
    text,
    created_at: serverTimestamp(),
    edited_at: null,
  });
}

export async function editComment(commentId, newText) {
  await updateDoc(doc(db, "comments", commentId), { text: newText, edited_at: serverTimestamp() });
}

/* ------------------------------------------------------------------
   ATTACHMENTS — Upload Photos / Upload Videos
-------------------------------------------------------------------*/
export async function addAttachment(woId, actor, file, fileType) {
  const storage = getStorage(app);
  const path = `work_orders/${woId}/attachments/${Date.now()}-${file.name}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file);
  const fileUrl = await getDownloadURL(ref);
  await addDoc(attachmentsCol, {
    entity_type: "work_order",
    entity_id: woId,
    file_url: fileUrl,
    file_type: fileType, // "photo" | "video" | "document"
    file_size_bytes: file.size,
    uploaded_by_id: actor.uid,
    uploaded_by_role: actor.role,
    uploaded_at: serverTimestamp(),
  });
  return fileUrl;
}

/* ------------------------------------------------------------------
   WORKFLOW TRANSITIONS (Approval Workflow + Status Tracking)
   Every function writes exactly the field set its matching rules
   clause expects, then appends a work_order_history entry.
-------------------------------------------------------------------*/
async function appendHistory(woId, entry) {
  await addDoc(historyCol, { work_order_id: woId, ...entry, created_at: serverTimestamp() });
}

const PRE_ACCEPTANCE_STATUSES = ["open", "assigned"];

/** rules: isSupervisorLike() (dept-scoped for Supervisor) — Assign Technician */
export async function assignTechnician(woId, technician, actor) {
  await updateDoc(doc(db, "work_orders", woId), {
    status: "assigned",
    assigned_to_id: technician.id,
    assigned_to_name: technician.name,
    updated_at: serverTimestamp(),
  });
  await appendHistory(woId, {
    from_status: "open",
    to_status: "assigned",
    actor_id: actor.uid,
    actor_name: actor.name,
    actor_role: actor.role,
    remarks: `Assigned to ${technician.name}`,
  });
}

/**
 * rules: isSupervisorLike() — reassign at any pre-Completed stage.
 * Per FSD Business Rule 6: reassigning before acceptance still routes
 * through "assigned" (fresh accept required); reassigning at accepted or
 * later preserves the current status exactly — ownership changes, the
 * flow does not restart.
 */
export async function reassignTechnician(woId, fromStatus, technician, actor) {
  const preservesStatus = !PRE_ACCEPTANCE_STATUSES.includes(fromStatus);
  const newStatus = preservesStatus ? fromStatus : "assigned";
  await updateDoc(doc(db, "work_orders", woId), {
    status: newStatus,
    assigned_to_id: technician.id,
    assigned_to_name: technician.name,
    updated_at: serverTimestamp(),
  });
  await appendHistory(woId, {
    from_status: fromStatus,
    to_status: newStatus,
    actor_id: actor.uid,
    actor_name: actor.name,
    actor_role: actor.role,
    remarks: preservesStatus
      ? `Reassigned to ${technician.name} — status unchanged (${fromStatus})`
      : `Reassigned to ${technician.name}`,
  });
}

/** rules: role technician, assigned_to_id==uid, assigned -> accepted */
export async function acceptWorkOrder(woId, actor) {
  await updateDoc(doc(db, "work_orders", woId), { status: "accepted", updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "assigned", to_status: "accepted", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: "Accepted by technician" });
}

/** rules: role technician, assigned -> open, assigned_to_id cleared, decline_reason required */
export async function declineWorkOrder(woId, actor, reason) {
  await updateDoc(doc(db, "work_orders", woId), {
    status: "open",
    assigned_to_id: null,
    assigned_to_name: null,
    decline_reason: reason,
    updated_at: serverTimestamp(),
  });
  await appendHistory(woId, { from_status: "assigned", to_status: "open", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: `Declined by ${actor.name}: ${reason}` });
}

/** rules: role technician, accepted -> on_the_way */
export async function startTravel(woId, actor) {
  await updateDoc(doc(db, "work_orders", woId), { status: "on_the_way", updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "accepted", to_status: "on_the_way", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: "Technician en route" });
}

/** rules: role technician, on_the_way -> on_site */
export async function arriveOnSite(woId, actor) {
  await updateDoc(doc(db, "work_orders", woId), { status: "on_site", updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "on_the_way", to_status: "on_site", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: "Arrived on site" });
}

/** rules: role technician, on_site -> repairing */
export async function startRepair(woId, actor) {
  await updateDoc(doc(db, "work_orders", woId), { status: "repairing", updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "on_site", to_status: "repairing", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: "Started repair" });
}

/** rules: role technician, repairing -> waiting_spare_part, spare_part_reason required */
export async function markWaitingSparePart(woId, actor, reason) {
  await updateDoc(doc(db, "work_orders", woId), { status: "waiting_spare_part", spare_part_reason: reason, updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "repairing", to_status: "waiting_spare_part", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: reason });
}

/** rules: role technician, waiting_spare_part -> repairing */
export async function resumeRepair(woId, actor) {
  await updateDoc(doc(db, "work_orders", woId), { status: "repairing", updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "waiting_spare_part", to_status: "repairing", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: "Spare part received — resumed repair" });
}

/** rules: role technician, repairing -> testing */
export async function startTesting(woId, actor) {
  await updateDoc(doc(db, "work_orders", woId), { status: "testing", updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "repairing", to_status: "testing", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: "Repair complete — testing" });
}

/** rules: role technician, testing -> repairing, test_fail_reason required */
export async function testFailed(woId, actor, reason) {
  await updateDoc(doc(db, "work_orders", woId), { status: "repairing", test_fail_reason: reason, updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "testing", to_status: "repairing", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: `Test failed: ${reason}` });
}

/** rules: role technician, testing -> completed, resolution_notes required */
export async function markCompleted(woId, actor, resolutionNotes) {
  await updateDoc(doc(db, "work_orders", woId), { status: "completed", resolution_notes: resolutionNotes, updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "testing", to_status: "completed", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: "Test passed — awaiting requester verification" });
}

/** rules: role requester, completed -> closed, verified_by==uid */
export async function verifyAndClose(woId, actor) {
  await updateDoc(doc(db, "work_orders", woId), { status: "closed", verified_by: actor.uid, verified_at: serverTimestamp(), updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "completed", to_status: "verified", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: "Confirmed fixed by requester" });
  await appendHistory(woId, { from_status: "verified", to_status: "closed", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: null });
}

/** rules: role manager or admin — Completed -> Closed override (requester unresponsive) */
export async function forceVerifyAndClose(woId, actor) {
  await updateDoc(doc(db, "work_orders", woId), { status: "closed", verified_by: actor.uid, verified_at: serverTimestamp(), updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "completed", to_status: "verified", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: `Force-verified by ${actor.name} (requester unresponsive)` });
  await appendHistory(woId, { from_status: "verified", to_status: "closed", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: null });
}

/** rules: role requester, completed -> repairing, reopen_reason required */
export async function reopenWorkOrder(woId, actor, reason) {
  await updateDoc(doc(db, "work_orders", woId), { status: "repairing", reopen_reason: reason, updated_at: serverTimestamp() });
  await appendHistory(woId, { from_status: "completed", to_status: "repairing", actor_id: actor.uid, actor_name: actor.name, actor_role: actor.role, remarks: `Reopened by requester: ${reason}` });
}
