"use client";

/**
 * SI — Service Inside · Work Order Module
 * Supabase data-access layer. Every exported function maps 1:1 to a policy in
 * migration 0002 or a row in wo_status_transitions — this file shapes writes,
 * it does not authorize them; RLS and the transition trigger are the actual
 * authorization boundary.
 *
 * Two notes on what the database now does that this file used to:
 *
 *   - wo_number, the SLA due timestamps, decline_count, resolved_at and
 *     closed_at are all set by triggers (migration 0003). Do not send them.
 *   - The transition matrix is enforced in the database. An illegal transition
 *     raises rather than silently no-opping, so callers get a real error.
 *
 * Transitions go through si_transition_work_order() (migration 0010) rather than
 * an UPDATE followed by an INSERT. That closes the audit-trail gap the Firebase
 * original had — a failure between the two statements used to leave the work
 * order advanced with no record of who advanced it — and it means the history's
 * actor is read from auth.uid() server-side instead of being whatever the client
 * claimed. The `actor` argument these functions still accept is used only for
 * building remark text; it no longer establishes identity.
 */
import { supabase, liveQuery, liveRow } from "./supabase";
import { ROLES } from "./roles";

const WO_SELECT = "*";

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
  const { data, error } = await supabase
    .from("work_orders")
    .insert({
      department_id: departmentId,
      asset_id: assetId,
      asset_name: assetName,
      plant_id: "PLT001",
      type,
      priority,
      status: "open",
      impact,
      est_downtime_value: estDowntimeValue === "" || estDowntimeValue == null ? null : Number(estDowntimeValue),
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
      // wo_number / sla_ack_due_at / sla_resolution_due_at / sla_breached /
      // decline_count are all filled in by si_before_work_order_insert —
      // counters and SLA computation are never client-writable.
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

/* ------------------------------------------------------------------
   EDIT — core fields, while status is still "open" only.
-------------------------------------------------------------------*/
export async function updateWorkOrderFields(woId, fields) {
  const { error } = await supabase
    .from("work_orders")
    .update({ ...fields, status: "open" }) // the open -> open row in the matrix
    .eq("id", woId);
  if (error) throw error;
}

/* ------------------------------------------------------------------
   DELETE — the one destructive operation in the module.
-------------------------------------------------------------------*/

/**
 * Remove a work order permanently.
 *
 * Who may do this is data, not code: role_permissions.can_delete_work_orders,
 * which only a Superuser writes (migration 0018). The work_orders_delete policy
 * additionally holds the caller to the rows their role can already see, so a
 * granted Supervisor reaches their own department and not the plant.
 *
 * The database handles the rest of it: a BEFORE DELETE trigger snapshots the row
 * into work_order_deletions and removes the comments, attachments and
 * notifications that reference it polymorphically. History cascades on its FK.
 *
 * Two details worth keeping:
 *
 *   - Storage objects are outside all of that, and the attachment rows naming
 *     them are gone a moment later, so the keys are collected first. Removing
 *     them is best-effort: a bucket that refuses the delete leaves orphaned
 *     files, which is a tidiness problem, not a correctness one, and must not
 *     fail an operation the database has already committed.
 *   - RLS refusing a DELETE is silent — it removes no rows and reports no
 *     error. `.select()` is what turns that back into something the user can be
 *     told, matching how the rest of this module reports refusals.
 */
export async function deleteWorkOrder(woId) {
  let paths = [];
  const { data: files } = await supabase
    .from("attachments")
    .select("storage_path, file_url")
    .eq("entity_type", "work_order")
    .eq("entity_id", woId);
  paths = (files ?? []).map((a) => a.storage_path || a.file_url).filter(Boolean);

  const { data, error } = await supabase
    .from("work_orders")
    .delete()
    .eq("id", woId)
    .select("id, wo_number");

  if (error) throw error;
  if (!data?.length) {
    throw new Error(
      "That work order was not deleted. Either your role has not been granted deletion, " +
        "or this record is outside what your role can see. A Superuser grants deletion in " +
        "Administration → Settings → Permissions."
    );
  }

  if (paths.length) {
    try {
      await supabase.storage.from("attachments").remove(paths);
    } catch {
      // The rows are gone either way; orphaned objects are a cleanup job.
    }
  }

  return data[0];
}

/* ------------------------------------------------------------------
   READS (live)
-------------------------------------------------------------------*/
export function listenWorkOrder(woId, cb, onError) {
  return liveRow({
    table: "work_orders",
    filter: `id=eq.${woId}`,
    run: () => supabase.from("work_orders").select(WO_SELECT).eq("id", woId).maybeSingle().then(
      ({ data, error }) => ({ data: data ? [data] : [], error })
    ),
    cb,
    onError,
  });
}

/**
 * Role-scoped list. RLS would scope this on its own, but the explicit filters
 * are kept for the same reason the Firestore version had them: they let Postgres
 * use the (requester_id, created_at) / (assigned_to_id, created_at) /
 * (department_id, created_at) indexes instead of scanning and then discarding
 * rows in the policy.
 */
export function listenWorkOrderList(currentUser, cb, onError) {
  const base = () => supabase.from("work_orders").select(WO_SELECT).order("created_at", { ascending: false });

  let run;
  if (currentUser.role === ROLES.REQUESTER) {
    run = () => base().eq("requester_id", currentUser.uid);
  } else if (currentUser.role === ROLES.TECHNICIAN) {
    run = () => base().eq("assigned_to_id", currentUser.uid);
  } else if (currentUser.role === ROLES.SUPERVISOR) {
    run = () => base().eq("department_id", currentUser.departmentId);
  } else {
    // manager / admin — system-wide.
    run = () => base().limit(300);
  }

  return liveQuery({ table: "work_orders", run, cb, onError });
}

export function listenWorkOrderHistory(woId, cb, onError) {
  return liveQuery({
    table: "work_order_history",
    filter: `work_order_id=eq.${woId}`,
    run: () =>
      supabase
        .from("work_order_history")
        .select("*")
        .eq("work_order_id", woId)
        .order("created_at", { ascending: true }),
    cb,
    onError,
  });
}

export function listenComments(woId, cb, onError) {
  return liveQuery({
    table: "comments",
    filter: `entity_id=eq.${woId}`,
    run: () =>
      supabase
        .from("comments")
        .select("*")
        .eq("entity_type", "work_order")
        .eq("entity_id", woId)
        .order("created_at", { ascending: true }),
    cb,
    onError,
  });
}

/**
 * The attachments bucket is private, so a durable public URL no longer exists
 * (see migration 0005 for why that changed). file_url is stored as the object
 * key and swapped for a short-lived signed URL here, which keeps
 * AttachmentsPanel's `<img src={p.file_url}>` working untouched.
 */
export function listenAttachments(woId, cb, onError) {
  return liveQuery({
    table: "attachments",
    filter: `entity_id=eq.${woId}`,
    run: async () => {
      const { data, error } = await supabase
        .from("attachments")
        .select("*")
        .eq("entity_type", "work_order")
        .eq("entity_id", woId)
        .order("uploaded_at", { ascending: false });

      if (error || !data?.length) return { data, error };

      const paths = data.map((a) => a.storage_path || a.file_url);
      const { data: signed } = await supabase.storage
        .from("attachments")
        .createSignedUrls(paths, 3600);

      const byPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]));
      return {
        data: data.map((a) => ({
          ...a,
          file_url: byPath.get(a.storage_path || a.file_url) || a.file_url,
        })),
        error: null,
      };
    },
    cb,
    onError,
  });
}

/** The assignment picker's roster — replaces the frozen TECHNICIANS array. */
export function listenTechnicians(cb, onError) {
  return liveQuery({
    table: "technicians",
    run: () =>
      supabase
        .from("technicians")
        .select("user_id, name, skills, current_load, availability_status")
        .order("name", { ascending: true }),
    cb,
    onError,
  });
}

/* ------------------------------------------------------------------
   COMMENTS — unifies what earlier iterations called "progress notes"
   into the single, reusable comments table every module shares.
-------------------------------------------------------------------*/
export async function addComment(woId, actor, text) {
  const { error } = await supabase.from("comments").insert({
    entity_type: "work_order",
    entity_id: woId,
    author_id: actor.uid,
    author_name: actor.name,
    author_role: actor.role,
    text,
    edited_at: null,
  });
  if (error) throw error;
}

export async function editComment(commentId, newText) {
  const { error } = await supabase
    .from("comments")
    .update({ text: newText, edited_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) throw error;
}

/* ------------------------------------------------------------------
   ATTACHMENTS — Upload Photos / Upload Videos
-------------------------------------------------------------------*/
export async function addAttachment(woId, actor, file, fileType) {
  const safeName = file.name.replace(/[^\w.\-]/g, "_");
  const path = `work_orders/${woId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error } = await supabase.from("attachments").insert({
    entity_type: "work_order",
    entity_id: woId,
    file_url: path, // the object key; a signed URL is minted on read
    storage_path: path,
    file_type: fileType, // "photo" | "video" | "document"
    file_size_bytes: file.size,
    uploaded_by_id: actor.uid,
    uploaded_by_role: actor.role,
  });
  if (error) throw error;

  return path;
}

/* ------------------------------------------------------------------
   WORKFLOW TRANSITIONS (Approval Workflow + Status Tracking)
   Every function writes exactly the field set its matching row in
   wo_status_transitions requires, then appends a history entry.
-------------------------------------------------------------------*/
/**
 * One round trip, one transaction. `fields` is whitelisted server-side, so only
 * columns a transition may legitimately carry are applied. `viaStatus` records an
 * intermediate step in the history without the work order ever sitting there —
 * used by verify-and-close.
 */
async function transition(woId, toStatus, { fields = {}, remarks = null, viaStatus = null } = {}) {
  const { error } = await supabase.rpc("si_transition_work_order", {
    p_wo_id: woId,
    p_to_status: toStatus,
    p_fields: fields,
    p_remarks: remarks,
    p_via_status: viaStatus,
  });
  if (error) throw error;
}

const PRE_ACCEPTANCE_STATUSES = ["open", "assigned"];

/** matrix: open -> assigned, roles {supervisor, manager, admin} */
export async function assignTechnician(woId, technician) {
  await transition(woId, "assigned", {
    fields: { assigned_to_id: technician.id, assigned_to_name: technician.name },
    remarks: `Assigned to ${technician.name}`,
  });
}

/**
 * matrix: the status-preserving reassignment rows.
 * Per FSD Business Rule 6: reassigning before acceptance still routes through
 * "assigned" (fresh accept required); reassigning at accepted or later
 * preserves the current status exactly — ownership changes, the flow does not
 * restart.
 */
export async function reassignTechnician(woId, fromStatus, technician) {
  const preservesStatus = !PRE_ACCEPTANCE_STATUSES.includes(fromStatus);
  const newStatus = preservesStatus ? fromStatus : "assigned";
  await transition(woId, newStatus, {
    fields: { assigned_to_id: technician.id, assigned_to_name: technician.name },
    remarks: preservesStatus
      ? `Reassigned to ${technician.name} — status unchanged (${fromStatus})`
      : `Reassigned to ${technician.name}`,
  });
}

/** matrix: assigned -> accepted, technician must be the assignee */
export async function acceptWorkOrder(woId) {
  await transition(woId, "accepted", { remarks: "Accepted by technician" });
}

/** matrix: assigned -> open, requires decline_reason. The trigger clears the
    assignee and increments decline_count. */
export async function declineWorkOrder(woId, actor, reason) {
  // The remark is just the reason: who declined is already the history row's
  // actor_name, which the server fills in from the session.
  await transition(woId, "open", {
    fields: { decline_reason: reason },
    remarks: `Declined: ${reason}`,
  });
}

/** matrix: accepted -> on_the_way */
export async function startTravel(woId) {
  await transition(woId, "on_the_way", { remarks: "Technician en route" });
}

/** matrix: on_the_way -> on_site */
export async function arriveOnSite(woId) {
  await transition(woId, "on_site", { remarks: "Arrived on site" });
}

/** matrix: on_site -> repairing */
export async function startRepair(woId) {
  await transition(woId, "repairing", { remarks: "Started repair" });
}

/** matrix: repairing -> waiting_spare_part, requires spare_part_reason */
export async function markWaitingSparePart(woId, actor, reason) {
  await transition(woId, "waiting_spare_part", {
    fields: { spare_part_reason: reason },
    remarks: reason,
  });
}

/** matrix: waiting_spare_part -> repairing */
export async function resumeRepair(woId) {
  await transition(woId, "repairing", { remarks: "Spare part received — resumed repair" });
}

/** matrix: repairing -> testing */
export async function startTesting(woId) {
  await transition(woId, "testing", { remarks: "Repair complete — testing" });
}

/** matrix: testing -> repairing, requires test_fail_reason */
export async function testFailed(woId, actor, reason) {
  await transition(woId, "repairing", {
    fields: { test_fail_reason: reason },
    remarks: `Test failed: ${reason}`,
  });
}

/** matrix: testing -> completed, requires resolution_notes. The trigger stamps
    resolved_at. */
export async function markCompleted(woId, actor, resolutionNotes) {
  await transition(woId, "completed", {
    fields: { resolution_notes: resolutionNotes },
    remarks: "Test passed — awaiting requester verification",
  });
}

/** matrix: completed -> closed, requires verified_by. The trigger stamps
    closed_at, verified_at and the final sla_breached verdict. The status goes
    straight to closed; viaStatus records the verification step in the trail. */
export async function verifyAndClose(woId, actor) {
  await transition(woId, "closed", {
    fields: { verified_by: actor.uid },
    remarks: "Confirmed fixed by requester",
    viaStatus: "verified",
  });
}

/** matrix: completed -> closed for manager/admin — requester unresponsive */
export async function forceVerifyAndClose(woId, actor) {
  await transition(woId, "closed", {
    fields: { verified_by: actor.uid },
    remarks: "Force-verified — requester unresponsive",
    viaStatus: "verified",
  });
}

/** matrix: completed -> repairing, requires reopen_reason */
export async function reopenWorkOrder(woId, actor, reason) {
  await transition(woId, "repairing", {
    fields: { reopen_reason: reason },
    remarks: `Reopened: ${reason}`,
  });
}
