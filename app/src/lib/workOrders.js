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
import { compressImage } from "./compressImage";
import { ROLES, hasRole } from "./roles";

const WO_SELECT = "*";

/* ------------------------------------------------------------------
   CREATE
-------------------------------------------------------------------*/
export async function createWorkOrder({
  departmentId,
  assetId,
  assetName,
  area,
  type,
  priority,
  impact,
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
      // Blank is "not recorded", not an empty string — the detail view hides the
      // row on null and would otherwise print an empty label.
      area: area?.trim() || null,
      plant_id: "PLT001",
      type,
      priority,
      status: "open",
      impact,
      // est_downtime_value / est_downtime_unit are deliberately not sent. The
      // field is gone from the raise form, and both columns are nullable, so a
      // new work order simply carries no estimate. The columns stay for the
      // work orders raised before it was removed.
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
 * additionally holds the caller to the rows their role can already see — which
 * since migration 0019 means a granted Supervisor reaches every work order, the
 * same set they can now read. The capability half is what still holds them back:
 * no role but Admin has it by default.
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
 * use the (requester_id, created_at) / (assigned_to_id, created_at) indexes
 * instead of scanning and then discarding rows in the policy.
 *
 * Supervisor lost its filter in migration 0019 and now falls through to the
 * system-wide branch. That filter was `.eq("department_id", …)`, and leaving it
 * would have made the widened work_orders_select policy invisible: the policy
 * permits every row, and the query would still have asked for one department's.
 * A client filter narrower than the policy is not defence in depth, it is a
 * feature that silently does not work.
 *
 * Since 0020 an account holds a set of roles, so this is a union rather than a
 * chain of exclusive branches — a Requester+Technician sees what they raised
 * AND what they were assigned, which the old if/else could not express.
 */
export function listenWorkOrderList(currentUser, cb, onError, range = null) {
  const run = () => {
    const q = scopedWorkOrderQuery(currentUser, range);
    // Display cap. The export deliberately does not share it — see
    // fetchWorkOrdersForExport.
    return q.canScopeToSelf ? q.query : q.query.limit(LIST_DISPLAY_LIMIT);
  };
  return liveQuery({ table: "work_orders", run, cb, onError });
}

/** How many rows the list renders at once. Not a cap on what can be exported. */
const LIST_DISPLAY_LIMIT = 300;

/**
 * The role scope and the date range, in one place.
 *
 * Extracted from listenWorkOrderList so the export cannot drift from the list it
 * was taken from. That is the same argument si_dashboard_card_rows() makes about
 * the dashboard drill-down: a second definition of the row set is how a total
 * starts disagreeing with the rows behind it.
 *
 * The date range is applied HERE, in the query, rather than by filtering the
 * loaded array. That is not a performance preference, it is a correctness one:
 * the system-wide branch is capped at LIST_DISPLAY_LIMIT rows of newest-first, so
 * filtering client-side for "January" would search the newest 300 rows and report
 * whichever few of January's happened to be among them. Narrowing server-side
 * makes the cap apply inside the range instead.
 *
 * `to` is EXCLUSIVE — `.lt()`, never `.lte()`. See dateRangePreset() in
 * lib/datetime for why an inclusive end silently drops rows.
 */
function scopedWorkOrderQuery(currentUser, range) {
  let query = supabase.from("work_orders").select(WO_SELECT).order("created_at", { ascending: false });

  if (range?.from) query = query.gte("created_at", range.from);
  if (range?.to) query = query.lt("created_at", range.to);

  // Supervisor, Manager and Admin are all system-wide as of 0019, so holding any
  // of them means "everything" and no narrower filter can apply on top.
  const systemWide =
    hasRole(currentUser, ROLES.SUPERVISOR) ||
    hasRole(currentUser, ROLES.MANAGER) ||
    hasRole(currentUser, ROLES.ADMIN);

  if (systemWide) return { query, canScopeToSelf: false };

  const clauses = [];
  if (hasRole(currentUser, ROLES.REQUESTER)) clauses.push(`requester_id.eq.${currentUser.uid}`);
  if (hasRole(currentUser, ROLES.TECHNICIAN)) clauses.push(`assigned_to_id.eq.${currentUser.uid}`);
  // No usable role: show nothing rather than everything. RLS would return an
  // empty set anyway; this makes the client agree with it instead of asking
  // for rows it will never be given.
  if (!clauses.length) return { query: query.limit(0), canScopeToSelf: true };

  return { query: query.or(clauses.join(",")), canScopeToSelf: true };
}

/* ------------------------------------------------------------------
   EXPORT — the whole record, not the visible page.
-------------------------------------------------------------------*/

/**
 * Supabase caps a single response at 1000 rows by default, and does it SILENTLY:
 * a truncated result is indistinguishable from a complete one. That is the whole
 * reason this helper exists rather than a plain `.select()`. Ten history rows per
 * work order means three hundred work orders overflow it, and the export would
 * quietly lose the tail of the audit trail — the same shape of failure as a
 * column nothing reads.
 */
const PAGE_SIZE = 1000;

/** Chunk size for `.in()` id lists. 100 uuids is roughly 4KB of query string. */
const ID_CHUNK = 100;

async function fetchAllPages(buildQuery) {
  const out = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    // A short page is the only reliable end-of-data signal PostgREST gives here.
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * `orderBy` is a parameter and not hardcoded to created_at, because
 * `attachments` has no created_at column — it stamps `uploaded_at` (migration
 * 0001). Ordering every child table by the same name would have failed that one
 * query outright.
 */
async function fetchChildRows(table, idColumn, ids, select, { orderBy = "created_at", extraFilter } = {}) {
  const rows = [];
  for (const ids_ of chunk(ids, ID_CHUNK)) {
    const page = await fetchAllPages(() => {
      let q = supabase.from(table).select(select).in(idColumn, ids_);
      if (extraFilter) q = extraFilter(q);
      return q.order(orderBy, { ascending: true });
    });
    rows.push(...page);
  }
  return rows;
}

/**
 * Everything the export needs, for the given role scope and date range.
 *
 * Four queries (each paginated), not four per work order: the child tables are
 * fetched with one `.in()` per chunk of ids.
 *
 * Deliberately NOT capped at LIST_DISPLAY_LIMIT. The list renders 300 rows
 * because rendering more is pointless; an export truncated at 300 would be a
 * file that silently disagrees with the range printed on its own Export Info
 * sheet. Whoever presses the button gets the range they asked for.
 *
 * No authorization work here, and none needed: RLS scopes work_orders,
 * work_order_history, comments and attachments independently, so a Requester's
 * export contains their own work orders and nothing else. The role filters below
 * exist to use the indexes, exactly as they do on the listener.
 *
 * Attachment rows are metadata only — no signed URLs are minted. The workbook
 * carries a count, because a one-hour signed URL written into a saved file is
 * dead before anyone opens it.
 */
export async function fetchWorkOrdersForExport(currentUser, range = null) {
  // A fresh query per page: a PostgREST builder is single-use once .range() has
  // been applied to it, so the scope is rebuilt rather than reused.
  const workOrders = await fetchAllPages(() => scopedWorkOrderQuery(currentUser, range).query);

  if (!workOrders.length) {
    return { workOrders: [], history: [], comments: [], attachments: [] };
  }

  const ids = workOrders.map((w) => w.id);

  const [history, comments, attachments] = await Promise.all([
    fetchChildRows("work_order_history", "work_order_id", ids, "*"),
    fetchChildRows("comments", "entity_id", ids, "*", {
      extraFilter: (q) => q.eq("entity_type", "work_order"),
    }),
    fetchChildRows(
      "attachments",
      "entity_id",
      ids,
      "id, entity_id, file_type, file_size_bytes, uploaded_by_role, uploaded_at",
      { orderBy: "uploaded_at", extraFilter: (q) => q.eq("entity_type", "work_order") }
    ),
  ]);

  return { workOrders, history, comments, attachments };
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

/**
 * The assignment picker's roster — replaces the frozen TECHNICIANS array.
 *
 * `technicians` on its own answers "who has ever been a technician", not "who is
 * one now". si_set_user_roles() creates the row when the role is granted and
 * deliberately LEAVES IT IN PLACE when the role is revoked, because it holds
 * skills and certifications — facts about the person rather than their current
 * role (migration 0020, behaviour dating to 0004). Offering that as the roster
 * produced a work order nobody could move: si_eligible_roles() computes
 * eligibility from the assignee's OWN roles, so someone no longer holding
 * `technician` can never accept, and the job sits at `assigned` until a Manager
 * or Admin reassigns it. An inactive account is the same story — hence both
 * filters here. The skills row is left untouched; only the roster is narrowed.
 *
 * `users!inner` is load-bearing: without `!inner` PostgREST nulls the embed for
 * a non-matching user instead of dropping the technicians row, which would put
 * every revoked technician straight back in the list.
 *
 * Only Supervisor+ may read `users` (users_select), which is exactly who may
 * assign — so AssignPanel subscribes only when canAssign() holds. For anyone
 * else the inner join would return nothing and read as "no technicians exist".
 *
 * Both tables are watched: revoking a role writes `users`, not `technicians`.
 */
export function listenTechnicians(cb, onError) {
  return liveQuery({
    table: ["technicians", "users"],
    run: () =>
      supabase
        .from("technicians")
        .select("user_id, name, skills, current_load, availability_status, users!inner(roles, status)")
        .contains("users.roles", ["technician"])
        .eq("users.status", "active")
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
   ATTACHMENTS — Upload Photos / Documents

   Video upload is gone (migration 0036 also drops the three video mime types
   from the bucket, so it is refused rather than merely unoffered). Rows already
   carrying file_type 'video' are untouched and still play in the viewer.
-------------------------------------------------------------------*/
export async function addAttachment(woId, actor, file, fileType) {
  /* Compressed HERE rather than at the two call sites, because this function is
     the chokepoint both of them already go through — the raise form and the
     work order's Attachments tab. Doing it here is what makes "the original is
     never stored" structural instead of a thing each caller has to remember:
     only `upload` below sees a file, and it only ever sees this one.

     compressImage() never rejects — an undecodable format (HEIC outside
     Safari) or a result that came out larger returns the original untouched, so
     nothing here needs a fallback. Everything downstream reads the compressed
     file: `contentType` from its type, and file_size_bytes from its size, which
     is why the recorded size is the stored size and not the camera's. */
  const upload = fileType === "photo" ? await compressImage(file) : file;

  const safeName = upload.name.replace(/[^\w.\-]/g, "_");
  const path = `work_orders/${woId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("attachments")
    .upload(path, upload, { contentType: upload.type, upsert: false });
  if (uploadError) throw uploadError;

  const { error } = await supabase.from("attachments").insert({
    entity_type: "work_order",
    entity_id: woId,
    file_url: path, // the object key; a signed URL is minted on read
    storage_path: path,
    file_type: fileType, // "photo" | "document" ('video' is legacy-read-only)
    file_size_bytes: upload.size,
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

/**
 * matrix: assigned -> open, requires decline_reason. The trigger clears the
 * assignee and increments decline_count.
 *
 * The one transition that does NOT go through `transition()`, and migration
 * 0037 is the reason: clearing the assignee moves the row out of the declining
 * technician's own SELECT scope, and Postgres applies the SELECT policy to an
 * UPDATE's *new* row — so the invoker-rights RPC was refused with a raw
 * row-level-security error, which the user saw as "You don't have permission to
 * do that." `si_decline_work_order` is a SECURITY DEFINER path for this move
 * alone; the transition matrix still decides who may call it, and the remark
 * ("Declined: …") is built server-side there, like actor_id/name/role.
 */
export async function declineWorkOrder(woId, actor, reason) {
  const { error } = await supabase.rpc("si_decline_work_order", {
    p_wo_id: woId,
    p_reason: reason,
  });
  if (error) throw error;
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
