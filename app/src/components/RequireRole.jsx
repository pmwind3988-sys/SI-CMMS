"use client";

/**
 * SI — Service Inside · Authentication Module
 * Role-gate for a specific page, used *inside* RequireAuth (so it can
 * assume `user` already exists). A role not in `allow` (and not elevated,
 * unless explicitly opted out) never sees the page's content — they're
 * redirected to their own correct dashboard instead of a bare "denied"
 * screen, since that's almost always what they actually meant to open.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { ELEVATED_ROLES, dashboardPathForRole, hasAnyRole } from "../lib/roles";

export default function RequireRole({ allow, includeElevated = true, children }) {
  const { user } = useAuth();
  const router = useRouter();

  // Membership, not equality: an account holds a set of roles and any one of
  // them admitting it is enough (migration 0020). This is what lets a
  // Supervisor+Technician reach both dashboards.
  const permitted =
    user && (hasAnyRole(user, allow) || (includeElevated && hasAnyRole(user, ELEVATED_ROLES)));

  useEffect(() => {
    if (user && !permitted) {
      router.replace(dashboardPathForRole(user.role));
    }
  }, [user, permitted, router]);

  if (!user || !permitted) return null;

  return children;
}
