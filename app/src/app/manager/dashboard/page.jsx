"use client";

import RequireAuth from "../../../components/RequireAuth";
import RequireRole from "../../../components/RequireRole";
import DashboardModule from "../../../components/dashboard/DashboardModule";
import { ROLES } from "../../../lib/roles";

export default function ManagerDashboardPage() {
  return (
    <RequireAuth>
      <RequireRole allow={[ROLES.MANAGER]}>
        <DashboardModule />
      </RequireRole>
    </RequireAuth>
  );
}
