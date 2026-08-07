"use client";

import RequireAuth from "../../components/RequireAuth";
import RequireRole from "../../components/RequireRole";
import DashboardPlaceholder from "../../components/DashboardPlaceholder";
import { ROLES } from "../../lib/roles";

export default function DashboardPage() {
  return (
    <RequireAuth>
      <RequireRole allow={[ROLES.REQUESTER]}>
        <DashboardPlaceholder
          title="Dashboard"
          description="Your submitted work orders and their status."
        />
      </RequireRole>
    </RequireAuth>
  );
}
