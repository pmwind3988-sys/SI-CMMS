"use client";

import RequireAuth from "../../../components/RequireAuth";
import RequireRole from "../../../components/RequireRole";
import RoleDashboard from "../../../components/dashboard/RoleDashboard";
import { ROLES } from "../../../lib/roles";

export default function SupervisorDashboardPage() {
  return (
    <RequireAuth>
      <RequireRole allow={[ROLES.SUPERVISOR]}>
        <RoleDashboard viewRole={ROLES.SUPERVISOR} />
      </RequireRole>
    </RequireAuth>
  );
}
