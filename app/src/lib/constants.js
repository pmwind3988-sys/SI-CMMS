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
/**
 * Did this person raise this work order? Ownership only — no role test.
 *
 * Migration 0040: "requester" means the person who raised the row, not an
 * account carrying the Requester role. Since 0020 an account holds a set of
 * roles and most non-staff accounts do not carry `requester` at all, so the
 * role test made an Administrator, Manager, Supervisor or Technician who
 * reported a fault not the requester of it — the thing `requester_id` records
 * that they plainly are.
 *
 * This mirrors work_orders_select / _update / _delete, all three of which now
 * test `requester_id = auth.uid()` with no role condition.
 */
export function raisedBy(wo, currentUser) {
  return !!wo?.requester_id && wo.requester_id === currentUser?.uid;
}
/* `isRequesterOf` — "holds the Requester role AND raised this" — is deleted
   rather than deprecated. Every one of its callers wanted `raisedBy`, and
   leaving a second, subtly narrower predicate beside it is how the next person
   reintroduces the bug 0040 fixes. If the Requester ROLE is ever genuinely the
   question, `hasRole(user, ROLES.REQUESTER)` says so without ambiguity. */
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
    raisedBy(wo, currentUser) ||
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
    raisedBy(wo, currentUser)
  );
}

/** Only a Superuser writes role_permissions — see migration 0018. */
export function canEditRolePermissions(currentUser) {
  return currentUser?.isSuperuser === true;
}

/**
 * May this account take a reference value out of use, or put it back?
 *
 * Superuser only, mirroring si_guard_reference_retire() (migration 0031). The
 * trigger rather than a policy is the enforcement point, because
 * departments_update is si_is_manager_or_admin() and assets_update is
 * si_is_admin() — both have to stay open for ordinary edits, and RLS grants a
 * whole row rather than a column.
 */
export function canRetireReferenceData(currentUser) {
  return currentUser?.isSuperuser === true;
}

/**
 * …and may they remove the row outright?
 *
 * Restates the DELETE policies rather than the retire rule, because they differ:
 * 0031 gave priorities/impact_levels/wo_types/safety_severities a
 * `si_is_superuser()` delete policy, while departments and assets keep the
 * `si_is_admin()` one 0002 gave them. Taking that away from Administrators
 * would have been a regression dressed up as a new feature.
 *
 * Whether the row CAN go is a different question again, and not one the client
 * answers: si_guard_reference_delete() counts what still references it.
 */
export function canRemoveReferenceRow(table, currentUser) {
  if (!currentUser) return false;
  if (currentUser.isSuperuser === true) return true;
  return (
    (table === "departments" || table === "assets") && hasRole(currentUser, ROLES.ADMIN)
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
  // No membership test needed here, and that is not an oversight: accountRank()
  // reads the whole set and returns the highest (migration 0020), so the rank
  // comparison below already means "below every role they hold".
  if (!me || !target) return false;
  if (target.is_protected) return false;
  if (target.id === me.uid) return true;
  // A test account is the Superuser's alone (migration 0028). Mirroring the
  // policy rather than relying on it: users_select already hides these rows from
  // everyone else, so in practice nobody else has one to pass in — and a
  // predicate that would say "yes" if they did is the kind that survives into a
  // screen that reads differently one day.
  if (target.is_test_account && me.isSuperuser !== true) return false;
  return hasRole(me, ROLES.ADMIN) && accountRank(target) < accountRank(me);
}

/**
 * May `me` mark this account as a test fixture, or unmark it?
 *
 * Superuser only, and never your own row — an account that can mark itself can
 * hide itself, which is the same objection as everywhere else in this schema.
 */
export function canMarkTestAccount(target, me) {
  if (!me || !target) return false;
  if (target.is_protected) return false;
  if (target.id === me.uid) return false;
  return me.isSuperuser === true;
}

/**
 * May `me` delete this account outright? SUPERUSER ONLY (migration 0030).
 *
 * Not the rank rule, and not a role_permissions toggle like work-order delete.
 * Deleting an account is the one irreversible thing that can be done to a person
 * in this module, and a toggle is a thing that can be flipped.
 *
 * This predicate cannot tell you whether the delete will SUCCEED, only whether to
 * offer it. Six foreign keys onto users(id) are ON DELETE NO ACTION, so an
 * account with any history is refused by the database — and the count that
 * decides it is not on the row this function receives. So the button is offered
 * and the server explains, which is the sanctioned direction: the policy and the
 * trigger are the boundary, and si_guard_user_delete's message is written to be
 * read by whoever hit it.
 */
export function canDeleteUser(target, me) {
  if (!me || !target) return false;
  if (me.isSuperuser !== true) return false;
  if (target.is_protected) return false;
  // Your own row is the one RLS always lets you write, so it is the one that
  // needs excluding by hand — the same shape canChangeUserRole uses. The Edge
  // Function refuses it too; this only avoids offering it.
  if (target.id === me.uid) return false;
  return true;
}

/**
 * Role, department and status all move someone within the hierarchy, so none of
 * them may be aimed at yourself — the row you are always allowed to write.
 */
export function canChangeUserRole(target, me) {
  return canEditUser(target, me) && target.id !== me?.uid;
}

/**
 * Setting somebody else's password is SUPERUSER ONLY, so that no Administrator
 * ever holds a credential belonging to another person. The rank rule was not
 * enough: it stopped an Administrator taking over a *peer*, and said nothing
 * about their subordinates.
 *
 * Your own is not restricted — that is /change-password, and the Edge Function
 * allows the self case.
 *
 * `isSuperuser` is true only when the account carries is_protected AND holds
 * 'admin' (see AuthContext), which is exactly what si_is_superuser() computes.
 * So a Superuser who is inactive or owes a password change is offered nothing,
 * because their token grants nothing.
 */
export function canSetUserPassword(target, me) {
  if (!me || !target) return false;
  if (target.id === me.uid) return true;
  return me.isSuperuser === true && canEditUser(target, me);
}

/**
 * What an Administrator uses instead: Supabase emails the person a link and they
 * choose their own password. Ordinary rank rule, because nothing about it puts a
 * credential in the sender's hands.
 *
 * A placeholder address is excluded here as well as refused server-side. The
 * refusal is the boundary; this only avoids offering a button whose one possible
 * outcome is that refusal. si_dummy_flags is a computed column (migration 0012)
 * and already on every row this screen reads.
 */
export function canSendRecoveryLink(target, me) {
  if (!canEditUser(target, me)) return false;
  return !(target.si_dummy_flags ?? []).includes("placeholder_email");
}

/**
 * Paired with canSetUserPassword, and it has to be: repoint a subordinate's
 * sign-in address at a mailbox you control, run the PUBLIC self-service reset at
 * /forgot-password, and you have their password without ever setting it.
 * Restricting one without the other would have been theatre.
 *
 * Your own is included — an Administrator correcting their own address needs no
 * Superuser, and changing your own address is not an escalation.
 */
export function canChangeUserEmail(target, me) {
  if (!me || !target) return false;
  if (target.id === me.uid) return canEditUser(target, me);
  return me.isSuperuser === true && canEditUser(target, me);
}

/**
 * Creating or granting a peer is not allowed, so the picker must not offer one.
 * A Superuser ranks 6, so Administrator (5) is in range for them and for nobody
 * else — which is exactly how a new Administrator gets made.
 */
export function assignableRoles(me) {
  return ALL_ROLES.filter((r) => roleRank(r) < accountRank(me));
}
