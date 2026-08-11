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
 * The rank of an actual account, as opposed to the rank of a role name.
 * Accepts either shape: a `users` row (`is_protected`) or the AuthContext user
 * (`isSuperuser`).
 */
export function accountRank(account) {
  if (!account) return 0;
  if (account.is_protected || account.isSuperuser) return SUPERUSER_RANK;
  return roleRank(account.role);
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
