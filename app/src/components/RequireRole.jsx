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
import { ELEVATED_ROLES, dashboardPathForRole } from "../lib/roles";

export default function RequireRole({ allow, includeElevated = true, children }) {
  const { user } = useAuth();
  const router = useRouter();

  const permitted = user && (allow.includes(user.role) || (includeElevated && ELEVATED_ROLES.includes(user.role)));

  useEffect(() => {
    if (user && !permitted) {
      router.replace(dashboardPathForRole(user.role));
    }
  }, [user, permitted, router]);

  if (!user || !permitted) return null;

  return children;
}
