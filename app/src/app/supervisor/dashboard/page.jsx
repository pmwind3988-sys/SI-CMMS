"use client";

import RequireAuth from "../../../components/RequireAuth";
import RequireRole from "../../../components/RequireRole";
import DashboardPlaceholder from "../../../components/DashboardPlaceholder";
import { ROLES } from "../../../lib/roles";

export default function SupervisorDashboardPage() {
  return (
    <RequireAuth>
      <RequireRole allow={[ROLES.SUPERVISOR]}>
        <DashboardPlaceholder
          title="Supervisor Dashboard"
          description="Your department's work orders, assignment queue, and SLA status."
        />
      </RequireRole>
    </RequireAuth>
  );
}
