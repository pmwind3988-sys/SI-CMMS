// SI — Service Inside · Work Order Module
//
// What's left here is code, not data.
//
// Every domain value this file used to hold is now a row in Supabase that an
// Administrator can edit — see migration 0009 and lib/referenceData.js:
//
//   STATUS_FLOW / STATUS_LABELS / STATUS_COLORS -> wo_statuses
//   PRIORITY_COLORS                             -> priorities.color_hex
//   SLA_MATRIX                                  -> sla
//   IMPACT_OPTIONS                              -> impact_levels
//   DEPARTMENTS                                 -> departments
//   EQUIPMENT                                   -> assets
//   the safety severity escalation              -> safety_severities
//   the work order type buttons                 -> wo_types
//
// Read them with useReferenceData(). Two earlier notes still apply:
//   - SLA enforcement is the server's: si_sla_target_minutes() reads the same
//     sla table, so the client preview and the stored deadline agree.
//   - The transition matrix is wo_status_transitions, enforced by trigger.
//
// The TECHNICIANS placeholder array was removed rather than migrated:
// work_orders.assigned_to_id is a uuid foreign key onto users(id), so its slug
// ids ("tech-arun") could never have been assigned. AssignPanel reads the real
// roster via listenTechnicians().
import { ROLES, ALL_ROLES, roleRank, accountRank } from "./roles";

/** Humanise a millisecond duration for an SLA countdown. */
export function fmtDue(ms) {
  if (ms == null) return "—";
  const sign = ms < 0 ? -1 : 1;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600e3);
  const d = Math.floor(h / 24);
  let out;
  if (d >= 1) out = `${d}d ${h % 24}h`;
  else if (h >= 1) out = `${h}h ${Math.floor((abs % 3600e3) / 60000)}m`;
  else out = `${Math.floor(abs / 60000)}m`;
  return sign < 0 ? `${out} overdue` : out;
}

/* ------------------------------------------------------------------
   Client-side role predicates.

   These mirror the RLS policies in migration 0002 — they decide what to
   *show*, never what is *allowed*. The database is the authorization
   boundary; if one of these ever disagrees with a policy, the policy wins
   and the user sees an error rather than a silent success.
-------------------------------------------------------------------*/
export function isAssigneeOf(wo, currentUser) {
  return currentUser?.role === ROLES.TECHNICIAN && wo.assigned_to_id === currentUser.uid;
}
export function isRequesterOf(wo, currentUser) {
  return currentUser?.role === ROLES.REQUESTER && wo.requester_id === currentUser.uid;
}
export function isSupervisorOfDept(wo, currentUser) {
  return currentUser?.role === ROLES.SUPERVISOR && wo.department_id === currentUser.departmentId;
}
export function isManagerOrAdmin(currentUser) {
  return currentUser?.role === ROLES.MANAGER || currentUser?.role === ROLES.ADMIN;
}
export function canAssign(currentUser) {
  return currentUser?.role === ROLES.SUPERVISOR || isManagerOrAdmin(currentUser);
}
export function canEditWhileOpen(wo, currentUser) {
  return (
    (currentUser?.role === ROLES.REQUESTER && wo.requester_id === currentUser.uid) ||
    isSupervisorOfDept(wo, currentUser) ||
    isManagerOrAdmin(currentUser)
  );
}

/* ------------------------------------------------------------------
   User administration — mirrors the users_* policies and
   si_guard_user_self_update as rewritten in migration 0015.

   The rule: your own row, or one whose rank is strictly below yours.
   Managers and Supervisors have no non-self branch, which is what keeps
   user administration Admin-only.
-------------------------------------------------------------------*/

/**
 * May `me` write this user's row at all?
 *
 * A protected account is never writable from the app, its own holder included —
 * si_guard_protected_user refuses every write to one, so a Superuser changes
 * their own name in Supabase. That is what the flag is for.
 */
export function canEditUser(target, me) {
  if (!me || !target) return false;
  if (target.is_protected) return false;
  if (target.id === me.uid) return true;
  return me.role === ROLES.ADMIN && accountRank(target) < accountRank(me);
}

/**
 * Role, department and status all move someone within the hierarchy, so none of
 * them may be aimed at yourself — the row you are always allowed to write.
 */
export function canChangeUserRole(target, me) {
  return canEditUser(target, me) && target.id !== me?.uid;
}

/** Same rule; the Edge Function re-checks it server-side. */
export function canSetUserPassword(target, me) {
  return canEditUser(target, me);
}

/**
 * Creating or granting a peer is not allowed, so the picker must not offer one.
 * A Superuser ranks 6, so Administrator (5) is in range for them and for nobody
 * else — which is exactly how a new Administrator gets made.
 */
export function assignableRoles(me) {
  return ALL_ROLES.filter((r) => roleRank(r) < accountRank(me));
}
