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
    }
  }, [loading, user, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-soft text-[13.5px]">
        Loading…
      </div>
    );
  }
  if (!user) return null;

  return <AppShell>{children}</AppShell>;
}
