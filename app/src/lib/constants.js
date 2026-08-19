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
import { ROLES, ALL_ROLES, roleRank, accountRank, hasRole } from "./roles";

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

   These mirror the RLS policies in migrations 0002, 0019 and 0020 — they
   decide what to
   *show*, never what is *allowed*. The database is the authorization
   boundary; if one of these ever disagrees with a policy, the policy wins
   and the user sees an error rather than a silent success.
-------------------------------------------------------------------*/
export function isAssigneeOf(wo, currentUser) {
  return hasRole(currentUser, ROLES.TECHNICIAN) && wo.assigned_to_id === currentUser.uid;
}
export function isRequesterOf(wo, currentUser) {
  return hasRole(currentUser, ROLES.REQUESTER) && wo.requester_id === currentUser.uid;
}
/**
 * A Supervisor reaches every work order, not just their own department's
 * (migration 0019). Equipment is pickable from anywhere, so the department a
 * work order carries is the machine's, not the raiser's — it identifies who
 * maintains the asset and what the dashboard groups by, and no longer decides
 * who may look. The `wo` argument is kept so the call sites read the same as
 * the other two scope predicates beside it.
 */
export function isSupervisor(wo, currentUser) {
  return hasRole(currentUser, ROLES.SUPERVISOR);
}
export function isManagerOrAdmin(currentUser) {
  return hasRole(currentUser, ROLES.MANAGER) || hasRole(currentUser, ROLES.ADMIN);
}
export function canAssign(currentUser) {
  return hasRole(currentUser, ROLES.SUPERVISOR) || isManagerOrAdmin(currentUser);
}
export function canEditWhileOpen(wo, currentUser) {
  return (
    (hasRole(currentUser, ROLES.REQUESTER) && wo.requester_id === currentUser.uid) ||
    isSupervisor(wo, currentUser) ||
    isManagerOrAdmin(currentUser)
  );
}

/**
 * May this account delete work orders at all?
 *
 * Mirrors si_can_delete_work_orders() (migration 0018): a Superuser always, and
 * otherwise whatever the role_permissions row for their role says. `roleCan`
 * comes from useReferenceData(), which keeps that table live.
 *
 * A Superuser is unconditional in both places on purpose — the account that
 * administers the toggles must not be able to switch off its own way back.
 */
export function canDeleteWorkOrders(currentUser, roleCan) {
  if (!currentUser) return false;
  if (currentUser.isSuperuser) return true;
  // A union, matching si_can_delete_work_orders(): the capability is held if ANY
  // role this account holds has been granted it.
  return (currentUser.roles ?? []).some(
    (r) => roleCan?.(r, "can_delete_work_orders") === true
  );
}

/**
 * …and may they delete *this* one? The capability grants the verb; the row still
 * has to be inside what their role can see, which is the second half of the
 * work_orders_delete policy restated.
 */
export function canDeleteWorkOrder(wo, currentUser, roleCan) {
  if (!canDeleteWorkOrders(currentUser, roleCan)) return false;
  return (
    isManagerOrAdmin(currentUser) ||
    isSupervisor(wo, currentUser) ||
    isAssigneeOf(wo, currentUser) ||
    isRequesterOf(wo, currentUser)
  );
}

/** Only a Superuser writes role_permissions — see migration 0018. */
export function canEditRolePermissions(currentUser) {
  return currentUser?.isSuperuser === true;
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
  // No membership test needed here, and that is not an oversight: accountRank()
  // reads the whole set and returns the highest (migration 0020), so the rank
  // comparison below already means "below every role they hold".
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
 * Same rule again, and it has to be: a sign-in address you can repoint at a
 * mailbox you control is an account takeover, so changing one is exactly as
 * privileged as setting a password. Your own is included — an Administrator
 * correcting their own address needs no Superuser — and a peer Administrator's
 * is not, which is the whole point of the rank rule.
 */
export function canChangeUserEmail(target, me) {
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
