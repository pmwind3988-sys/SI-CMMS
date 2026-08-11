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
 *      { uid, email, name, phone, role, departmentId, plantIds }
 *
 * Claim naming: Supabase reserves the `role` claim for the Postgres role
 * PostgREST switches into, so the application role travels as `user_role`. The
 * access-token hook in migration 0002 populates it from public.users.
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
import { supabase, REMEMBER_ME_KEY } from "../lib/supabase";

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
            .select("name, phone, role, department_id, plant_ids, photo_url")
            .eq("id", session.user.id)
            .maybeSingle();
          if (data) profile = data;
        } catch {
          // Non-fatal — the user can still use the app with claims alone.
        }

        if (!active) return;
        setUser({
          uid: session.user.id,
          email: session.user.email,
          name: profile.name || session.user.email,
          phone: profile.phone || "",
          role: claims.user_role || profile.role || null,
          departmentId: claims.department_id || profile.department_id || null,
          plantIds: claims.plant_ids || profile.plant_ids || [],
          // A Superuser is role 'admin' plus is_protected, ranking above every
          // role (migration 0015). Claims only, never the profile row: a missing
          // claim must read false so a stale token degrades to plain admin
          // rather than silently granting the top tier.
          isSuperuser: claims.is_protected === true,
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

  const signIn = useCallback(async (email, password, rememberMe) => {
    // Must precede signInWithPassword — it decides which store the session
    // lands in. See the storage adapter in lib/supabase.js.
    if (typeof window !== "undefined") {
      window.localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "true" : "false");
    }
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;
    // Hand the role back with the user so the caller can redirect immediately
    // instead of waiting for onAuthStateChange to populate `user`. Same source
    // of truth as everywhere else: the user_role claim from the access-token
    // hook. A null role means the hook is disabled or this account has no row
    // in public.users — callers should treat that as its own failure, not as
    // bad credentials.
    return {
      user: data.user,
      role: claimsFromSession(data.session).user_role ?? null,
    };
  }, []);

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
  }, []);

  const resetPassword = useCallback(async (email) => {
    const redirectTo =
      typeof window !== "undefined" ? `${window.location.origin}/reset-password/` : undefined;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
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
