"use client";

import RequireAuth from "../../../components/RequireAuth";
import RequireRole from "../../../components/RequireRole";
import UsersAdmin from "../../../components/admin/UsersAdmin";
import { ROLES } from "../../../lib/roles";

export default function AdminUsersPage() {
  return (
    <RequireAuth>
      {/* includeElevated=false, matching /admin/dashboard: user and role
          administration stays Admin-only rather than Admin-or-Manager. */}
      <RequireRole allow={[ROLES.ADMIN]} includeElevated={false}>
        <UsersAdmin />
      </RequireRole>
    </RequireAuth>
  );
}
