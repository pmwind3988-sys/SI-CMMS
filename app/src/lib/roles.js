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
