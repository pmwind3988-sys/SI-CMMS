"use client";

/**
 * SI — Service Inside · Role switcher
 *
 * An account may hold several roles (migration 0020), and their "waiting on
 * you" queues live on different dashboards: a Technician's assigned jobs, a
 * Supervisor's unassigned queue. This links between them.
 *
 * IT IS A VIEW CONTROL, NOT A SECURITY CONTROL.
 *
 * Permissions are the union of every role held, enforced server-side, and none
 * of that depends on which view is open. Nothing here may ever gate a
 * capability — the moment it does, a security boundary is living in the
 * browser, where the user can edit it.
 *
 * Renders nothing at all for a single-role account, which is almost everyone.
 */
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import { ROLE_DASHBOARD_PATH, ROLE_LABELS, roleRank } from "../../lib/roles";

export default function RoleSwitcher({ current }) {
  const { user } = useAuth();

  // Filtered by ROLE_DASHBOARD_PATH rather than listed: every role has a
  // dashboard today, but a role added later without one must not render a link
  // to undefined.
  const roles = (user?.roles ?? [])
    .filter((r) => ROLE_DASHBOARD_PATH[r])
    .sort((a, b) => roleRank(b) - roleRank(a));

  if (roles.length < 2) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[12px] text-ink-soft">Viewing as</span>
      {roles.map((r) => (
        <Link
          key={r}
          href={ROLE_DASHBOARD_PATH[r]}
          aria-current={r === current ? "page" : undefined}
          className={`rounded border px-3 py-1.5 text-[12.5px] font-semibold ${
            r === current
              ? "border-ink bg-ink text-white"
              : "border-[#D8DEE4] bg-white text-ink"
          }`}
        >
          {ROLE_LABELS[r] || r}
        </Link>
      ))}
    </div>
  );
}
