"use client";

import RequireAuth from "../../../components/RequireAuth";
import RequireRole from "../../../components/RequireRole";
import SettingsAdmin from "../../../components/admin/SettingsAdmin";
import { ROLES } from "../../../lib/roles";

export default function AdminSettingsPage() {
  return (
    <RequireAuth>
      {/* Admin-only: these rows are system configuration, and migration 0009
          grants UPDATE on the lookup tables to si_is_admin() alone. Showing the
          screen to a Manager would only produce permission errors. */}
      <RequireRole allow={[ROLES.ADMIN]} includeElevated={false}>
        <SettingsAdmin />
      </RequireRole>
    </RequireAuth>
  );
}
