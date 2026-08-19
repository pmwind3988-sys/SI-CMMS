"use client";

/**
 * SI — Service Inside · Authentication Module
 *
 * Owns:
 *  - Supabase Auth sign-in / sign-out
 *  - "Remember Me" via the storage adapter in lib/supabase.js
 *  - Password reset
 *  - Resolving role + department_id from the JWT's custom claims, enriched with
 *    display fields (name, phone, photo) from public.users
 *  - Exposing a single `user` shape every component in this module reads:
 *      { uid, email, name, phone, roles, role, departmentId, plantIds,
 *        isSuperuser, mustChangePassword }
 *
 * `roles` is the set the account holds and is what every permission decision
 * reads, via hasRole()/hasAnyRole() — authorization is their union (migration
 * 0020). `role` is the highest of them, and exists only so landing pages and
 * badges have one value to use. Never decide access on `role`.
 *
 * `roles` comes from the token's claims and from nowhere else. An account that
 * is inactive or owes a password change is issued a token with no role claims at
 * all (migration 0026), and reading its own users row to fill the gap would undo
 * that — see the comment on resolvedRoles, which is where that fallback used to
 * be.
 *
 * Claim naming: Supabase reserves the `role` claim for the Postgres role
 * PostgREST switches into, so the application roles travel as `user_roles` (the
 * set) and `user_role` (the highest). The access-token hook populates both from
 * public.users — see migration 0020.
 *
 * Session management notes:
 *  - Supabase persists the session across reloads by default. "Remember Me"
 *    selects which store backs it (see lib/supabase.js):
 *      checked   -> localStorage   (survives closing the browser)
 *      unchecked -> sessionStorage (cleared when the tab/window closes)
 *  - The flag must be set BEFORE signInWithPassword, because that is the call
 *    whose session gets written — the same ordering constraint Firebase had
 *    with setPersistence.
 *  - onAuthStateChange fires on TOKEN_REFRESHED as well as sign-in/out, so a
 *    claims change (e.g. an admin just changed this user's role) is picked up
 *    the next time Supabase silently refreshes the token, without requiring the
 *    user to sign out and back in. Call refreshSession() to make it immediate.
 */
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase, rememberMe as persistRememberMe } from "../lib/supabase";
import { highestRole, ROLES } from "../lib/roles";

/**
 * Where a password-reset link should land.
 *
 * window.location.origin is wrong in the APK — Capacitor serves the same static
 * export from https://localhost, so a link built from it points at the phone
 * itself and dies in whatever browser opens the mail. NEXT_PUBLIC_SITE_URL is
 * the deployed web origin, and it is what the Android build must use.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || null;

function resetRedirectUrl() {
  const base =
    SITE_URL || (typeof window !== "undefined" ? window.location.origin : null);
  if (!base) return undefined;
  // trailingSlash: true in next.config.js — /reset-password without the slash
  // is a redirect, and Supabase matches the redirect allow-list on the exact URL.
  return `${base.replace(/\/+$/, "")}/reset-password/`;
}

const AuthContext = createContext(null);

/** Decode the claims the access-token hook injected. */
function claimsFromSession(session) {
  const token = session?.access_token;
  if (!token) return {};
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json))) || {};
  } catch {
    return {};
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function resolve(session) {
      setError(null);
      if (!session?.user) {
        if (active) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      try {
        const claims = claimsFromSession(session);

        // Display-only fields are enriched from the users table; authorization
        // itself never depends on this read succeeding — role/department come
        // from the claims above, which are already trustworthy on their own.
        let profile = {};
        try {
          const { data } = await supabase
            .from("users")
            // `roles` is deliberately NOT selected. Nothing here may read the
            // account's roles from its own row — see resolvedRoles below.
            .select("name, phone, department_id, plant_ids, photo_url")
            .eq("id", session.user.id)
            .maybeSingle();
          if (data) profile = data;
        } catch {
          // Non-fatal — the user can still use the app with claims alone.
        }

        if (!active) return;

        /**
         * The roles this account holds — CLAIMS ONLY.
         *
         * THE ABSENCE OF A profile.roles FALLBACK IS LOAD-BEARING. It used to be
         * the last leg of this chain, as a migration-0020 rollout requirement,
         * and migration 0026 turned it into a hole: an account that is inactive
         * or owes a password change is now issued a token with NO role claims,
         * and users_select lets any account read its own row. So the fallback
         * read the roles straight back out of the profile and handed them to
         * hasRole() — the client mirror of the array_agg trap 0026 exists to
         * close. Measured on the live schema: a roleless token still returns
         * `roles: ["requester"]` from its own users row.
         *
         * Nothing would be granted — every policy still denies — which is what
         * makes it worth spelling out. The failure is not an escalation; it is a
         * complete app in which every list is empty and nothing says why.
         *
         * The user_role leg stays. It costs nothing, it is what a token minted
         * before 0020 carries, and 0026 withholds both claims together, so it
         * cannot reopen the withholding.
         */
        const resolvedRoles =
          claims.user_roles ?? (claims.user_role ? [claims.user_role] : []);

        setUser({
          uid: session.user.id,
          email: session.user.email,
          name: profile.name || session.user.email,
          phone: profile.phone || "",
          roles: resolvedRoles,
          // The highest role held. Landing page and display only — never a
          // permission decision. Those ask hasRole()/hasAnyRole(), because
          // authorization is the union of every role held.
          role: highestRole(resolvedRoles),
          departmentId: claims.department_id || profile.department_id || null,
          plantIds: claims.plant_ids || profile.plant_ids || [],
          /**
           * A Superuser is role 'admin' plus is_protected, ranking above every
           * role (migration 0015). Claims only, never the profile row: a missing
           * claim must read false so a stale token degrades to plain admin
           * rather than silently granting the top tier.
           *
           * BOTH halves are required, which is what si_is_superuser() computes —
           * it is si_has_role('admin') AND the flag, so it goes false the moment
           * 0026 withholds the roles. Without the conjunction here, a flagged or
           * deactivated Superuser would still be offered every Superuser-only
           * control on a token the database grants nothing to.
           */
          isSuperuser: claims.is_protected === true && resolvedRoles.includes(ROLES.ADMIN),
          /**
           * This account was given its password by somebody else. It is WHY the
           * roles above are empty, and it is what /change-password routes on.
           */
          mustChangePassword: claims.must_change_password === true,
        });
      } catch (e) {
        if (active) {
          setError(e);
          setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => resolve(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => resolve(session));

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password, remember) => {
    // The flag must precede signInWithPassword — it decides which store the
    // session lands in. See the storage adapter in lib/supabase.js.
    persistRememberMe(remember);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;
    // The address only after the credentials were accepted, so a rejected
    // attempt does not leave a typo waiting in the field next time.
    if (remember) persistRememberMe(true, email);
    // Hand the roles back with the user so the caller can redirect immediately
    // instead of waiting for onAuthStateChange to populate `user`. Same source
    // of truth as everywhere else: the access-token hook's claims, read with
    // the same pre-0020 fallback as above. An empty set means the hook is
    // disabled or this account has no row in public.users — callers should
    // treat that as its own failure, not as bad credentials.
    const signInClaims = claimsFromSession(data.session);
    const roles =
      signInClaims.user_roles ?? (signInClaims.user_role ? [signInClaims.user_role] : []);
    return {
      user: data.user,
      roles,
      // The login page redirects on this: landing is one destination, so it is
      // the highest role held.
      role: highestRole(roles),
      /**
       * Why `roles` can be empty even though the credentials were accepted. The
       * login page needs the distinction: this one is a routing decision, an
       * empty set without it is a misconfiguration to report.
       */
      mustChangePassword: signInClaims.must_change_password === true,
    };
  }, []);

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
  }, []);

  const resetPassword = useCallback(async (email) => {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectUrl(),
    });
    if (resetError) throw resetError;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, error, signIn, signOut, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
