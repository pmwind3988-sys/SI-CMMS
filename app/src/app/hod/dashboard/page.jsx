"use client";

import RequireAuth from "../../../components/RequireAuth";
import RequireRole from "../../../components/RequireRole";
import RoleDashboard from "../../../components/dashboard/RoleDashboard";
import { ROLES } from "../../../lib/roles";

/**
 * Where a Head of Department lands (migration 0059).
 *
 * `includeElevated={false}`, unlike every other role dashboard. RequireRole
 * normally lets a Manager or Administrator into any screen, and that is right
 * for screens which show them something; this one is a queue of work waiting on
 * an HOD specifically, and neither of those roles can verify anything. Letting
 * them in would show them a list of jobs and no way to act on any of it.
 */
export default function HodDashboardPage() {
  return (
    <RequireAuth>
      <RequireRole allow={[ROLES.HOD]} includeElevated={false}>
        <RoleDashboard viewRole={ROLES.HOD} />
      </RequireRole>
    </RequireAuth>
  );
}
