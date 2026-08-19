/**
 * SI — Service Inside · Authentication Module
 * Role constants. Values are lowercase snake_case to match the si_role enum in
 * Postgres and the `user_role` JWT claim the access-token hook populates —
 * see supabase/migrations/0002_auth_and_rls.sql.
 */
export const ROLES = {
  REQUESTER: "requester",
  TECHNICIAN: "technician",
  SUPERVISOR: "supervisor",
  MANAGER: "manager", // Maintenance Manager
  ADMIN: "admin", // Administrator
};

export const ALL_ROLES = Object.values(ROLES);

/**
 * The role hierarchy, mirroring si_role_rank() in migration 0015. You may write
 * a user's row if it is your own, or if their rank is strictly below yours —
 * which is what stops one Administrator editing another.
 *
 * Anything unrecognised ranks 0, below every real role, so an unknown role can
 * act on nobody rather than on everybody. Same failure direction as the SQL.
 */
export const ROLE_RANK = {
  [ROLES.REQUESTER]: 1,
  [ROLES.TECHNICIAN]: 2,
  [ROLES.SUPERVISOR]: 3,
  [ROLES.MANAGER]: 4,
  [ROLES.ADMIN]: 5,
};

/**
 * A Superuser is not a sixth role — it is `role: 'admin'` carrying
 * `is_protected`, so every existing admin check keeps passing for them and only
 * the rank comparison sees the extra tier. See migration 0015 for why that
 * beats adding to the si_role enum.
 */
export const SUPERUSER_RANK = 6;

export function roleRank(role) {
  return ROLE_RANK[role] ?? 0;
}

/**
 * The highest-ranked role in a set — what the app lands on and displays.
 *
 * Landing and display only. Never a permission decision: permissions are the
 * union of every role held, which is what hasRole()/hasAnyRole() answer.
 */
export function highestRole(roles) {
  if (!roles?.length) return null;
  return [...roles].sort((a, b) => roleRank(b) - roleRank(a))[0];
}

/** Does this account hold this role? Mirrors si_has_role() in migration 0020. */
export function hasRole(account, role) {
  return Array.isArray(account?.roles) && account.roles.includes(role);
}

export function hasAnyRole(account, roles) {
  return roles.some((r) => hasRole(account, r));
}

/** "Supervisor · Technician", highest first. For badges and table cells. */
export function rolesLabel(roles) {
  if (!roles?.length) return "—";
  return [...roles]
    .sort((a, b) => roleRank(b) - roleRank(a))
    .map((r) => ROLE_LABELS[r] || r)
    .join(" · ");
}

/**
 * The rank of an actual account, as opposed to the rank of a role name: the
 * HIGHEST role held, or 6 for a Superuser. Mirrors
 * si_account_rank(si_role[], boolean) in migration 0020.
 *
 * Accepts either shape: a `users` row (`is_protected`) or the AuthContext user
 * (`isSuperuser`).
 *
 * The `?? [account.role]` fallback is the client mirror of si_roles()'s claim
 * fallback, and is there for the same reason — a row read before migration
 * 0020, or a stale cached profile, would otherwise rank 0 and silently deny
 * everything rather than degrading to the single role it actually names.
 */
export function accountRank(account) {
  if (!account) return 0;
  if (account.is_protected || account.isSuperuser) return SUPERUSER_RANK;
  const roles = account.roles ?? (account.role ? [account.role] : []);
  return roles.reduce((max, r) => Math.max(max, roleRank(r)), 0);
}

export const ROLE_LABELS = {
  [ROLES.REQUESTER]: "Requester",
  [ROLES.TECHNICIAN]: "Technician",
  [ROLES.SUPERVISOR]: "Supervisor",
  [ROLES.MANAGER]: "Maintenance Manager",
  [ROLES.ADMIN]: "Administrator",
};

/** Where each role lands immediately after a successful sign-in. */
export const ROLE_DASHBOARD_PATH = {
  [ROLES.REQUESTER]: "/dashboard",
  [ROLES.TECHNICIAN]: "/technician/dashboard",
  [ROLES.SUPERVISOR]: "/supervisor/dashboard",
  [ROLES.MANAGER]: "/manager/dashboard",
  [ROLES.ADMIN]: "/admin/dashboard",
};

export function dashboardPathForRole(role) {
  return ROLE_DASHBOARD_PATH[role] || "/login";
}

/**
 * Roles that may view a page in addition to whatever roles that page
 * explicitly lists — Manager ("access everything") and Admin ("full
 * access") per the approved access hierarchy. A page can opt out of
 * this by passing includeElevated={false} to <RequireRole>.
 */
export const ELEVATED_ROLES = [ROLES.MANAGER, ROLES.ADMIN];
