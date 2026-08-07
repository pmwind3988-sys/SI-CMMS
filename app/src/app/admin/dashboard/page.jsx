"use client";

import RequireAuth from "../../../components/RequireAuth";
import RequireRole from "../../../components/RequireRole";
import DashboardModule from "../../../components/dashboard/DashboardModule";
import { ROLES } from "../../../lib/roles";

export default function AdminDashboardPage() {
  return (
    <RequireAuth>
      {/* includeElevated=false: Manager is elevated everywhere else, but
          system administration (users, roles, security config) is the one
          area that stays Admin-only rather than Admin-or-Manager. */}
      <RequireRole allow={[ROLES.ADMIN]} includeElevated={false}>
        <DashboardModule />
      </RequireRole>
    </RequireAuth>
  );
}
