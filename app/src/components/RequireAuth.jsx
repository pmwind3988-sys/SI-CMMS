"use client";

/**
 * SI — Service Inside · Authentication Module
 * Wraps any protected page. Unauthenticated visitors are sent to /login
 * with a `next` query param so LoginPage can return them to where they
 * were headed — used for session-expiry mid-use, not for the initial
 * post-login redirect (that one always goes to the role's own dashboard,
 * per spec, regardless of `next`).
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, SESSION_RECOVERING, SESSION_LOST } from "../context/AuthContext";
import { onRecovered } from "../lib/sessionRecovery";
import { SessionRecoveryBanner, Toast } from "./ui/Surfaces";
import AppShell from "./AppShell";

export default function RequireAuth({ children }) {
  const { user, loading, sessionState, recoveryReason } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const onChangePassword = (pathname || "").startsWith("/change-password");
  const recovering = sessionState === SESSION_RECOVERING;

  /**
   * The receipt for a recovery the user watched happen.
   *
   * Without it the banner simply vanishes, which is indistinguishable from it
   * having been dismissed or from the app having given up quietly. Two seconds
   * of "Signed back in" is what turns a disappearing warning into a resolved
   * one.
   */
  const [recoveredToast, setRecoveredToast] = useState(false);
  useEffect(() => {
    const stopListening = onRecovered(() => setRecoveredToast(true));
    return stopListening;
  }, []);
  useEffect(() => {
    if (!recoveredToast) return undefined;
    const timer = setTimeout(() => setRecoveredToast(false), 2600);
    return () => clearTimeout(timer);
  }, [recoveredToast]);

  useEffect(() => {
    /**
     * THE HOLD.
     *
     * `recovering` means the token stopped working and a new one is being
     * fetched without a password. Redirecting now would unmount the tree — and
     * the tree is where the unsaved work order lives, both as something the
     * user can still see and as the only thing that can be asked for a snapshot
     * if recovery does end up failing. So this effect does nothing at all until
     * the session is either back or definitively gone.
     *
     * `user` is deliberately still populated during recovery (see the
     * SIGNED_OUT branch in AuthContext), so the `!user` test below is already
     * false here. The explicit guard is belt and braces on the one condition
     * this component must never get wrong.
     */
    if (recovering) return;

    if (!loading && !user) {
      // Keep the query string: work order ids live in `?id=`, so dropping it
      // would return the user to a detail page with nothing selected. Read it
      // off window rather than via useSearchParams — that hook would require a
      // Suspense boundary around every page this component wraps, which the
      // static export build rejects.
      const search = typeof window !== "undefined" ? window.location.search : "";
      const target = `${pathname || "/"}${search}`;
      /**
       * `reason=expired` is what separates "you are not signed in" from "you
       * were signed in and something ended it". The login page needs the
       * distinction for two reasons: it changes the sentence at the top of the
       * form, and it is the only case in which landing anywhere other than the
       * role dashboard is permitted.
       */
      const reason = sessionState === SESSION_LOST ? "&reason=expired" : "";
      router.replace(`/login?next=${encodeURIComponent(target)}${reason}`);
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
  }, [loading, user, pathname, router, onChangePassword, recovering, sessionState]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-ink-soft text-[13.5px]">
        Loading…
      </div>
    );
  }
  if (!user) return null;

  return (
    <>
      {recovering && <SessionRecoveryBanner reason={recoveryReason} />}
      <AppShell>{children}</AppShell>
      {recoveredToast && <Toast message="Signed back in." />}
    </>
  );
}
