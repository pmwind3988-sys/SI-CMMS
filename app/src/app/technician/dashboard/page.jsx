"use client";

import RequireAuth from "../../../components/RequireAuth";
import RequireRole from "../../../components/RequireRole";
import DashboardPlaceholder from "../../../components/DashboardPlaceholder";
import { ROLES } from "../../../lib/roles";

export default function TechnicianDashboardPage() {
  return (
    <RequireAuth>
      <RequireRole allow={[ROLES.TECHNICIAN]}>
        <DashboardPlaceholder
          title="Technician Dashboard"
          description="Your assigned tasks and today's field work."
        />
      </RequireRole>
    </RequireAuth>
  );
}
