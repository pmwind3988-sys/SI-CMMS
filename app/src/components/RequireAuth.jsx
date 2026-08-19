"use client";

/**
 * SI — Service Inside · Authentication Module
 * Wraps any protected page. Unauthenticated visitors are sent to /login
 * with a `next` query param so LoginPage can return them to where they
 * were headed — used for session-expiry mid-use, not for the initial
 * post-login redirect (that one always goes to the role's own dashboard,
 * per spec, regardless of `next`).
 */
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import AppShell from "./AppShell";

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const onChangePassword = (pathname || "").startsWith("/change-password");

  useEffect(() => {
    if (!loading && !user) {
      // Keep the query string: work order ids live in `?id=`, so dropping it
      // would return the user to a detail page with nothing selected. Read it
      // off window rather than via useSearchParams — that hook would require a
      // Suspense boundary around every page this component wraps, which the
      // static export build rejects.
      const search = typeof window !== "undefined" ? window.location.search : "";
      const target = `${pathname || "/"}${search}`;
      router.replace(`/login?next=${encodeURIComponent(target)}`);
      return;
    }
    /**
     * A password issued by somebody else buys access to exactly one page.
     *
     * Here rather than in a role gate, because a flagged account holds no roles
     * (migration 0026) and RequireRole would reject it from the very page it has
     * to reach. The exclusion below is what stops this being a loop:
     * /change-password is itself wrapped in RequireAuth, which is the point —
     * that page needs a session and nothing more.
     *
     * Not the enforcement, only the signpost. The token carries no roles, so the
     * app is empty either way; without this the account simply landed on
     * whatever page it asked for and read "0 of 0 work orders" with nothing
     * anywhere explaining why.
     */
    if (!loading && user?.mustChangePassword && !onChangePassword) {
      router.replace("/change-password/");
    }
  }, [loading, user, pathname, router, onChangePassword]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-ink-soft text-[13.5px]">
        Loading…
      </div>
    );
  }
  if (!user) return null;

  return <AppShell>{children}</AppShell>;
}
