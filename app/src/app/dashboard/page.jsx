"use client";

import RequireAuth from "../../components/RequireAuth";
import RequireRole from "../../components/RequireRole";
import RoleDashboard from "../../components/dashboard/RoleDashboard";
import { ROLES } from "../../lib/roles";

export default function DashboardPage() {
  return (
    <RequireAuth>
      <RequireRole allow={[ROLES.REQUESTER]}>
        <RoleDashboard />
      </RequireRole>
    </RequireAuth>
  );
}
