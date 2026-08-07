"use client";

/**
 * SI — Service Inside · Authentication Module
 *
 * Owns:
 *  - Firebase Authentication sign-in / sign-out
 *  - "Remember Me" via Firebase Auth persistence mode
 *  - Password reset
 *  - Resolving role + department_id from the ID token's custom claims,
 *    enriched with display fields (name, phone, photo) from /users/{uid}
 *  - Exposing a single `user` shape every component in this module reads:
 *      { uid, email, name, phone, role, departmentId, plantIds }
 *
 * Session management notes:
 *  - Firebase Auth already persists the session across page reloads by
 *    default (IndexedDB-backed). "Remember Me" here controls *which*
 *    persistence mode is used going into the next sign-in call:
 *      checked   -> browserLocalPersistence   (survives closing the browser)
 *      unchecked -> browserSessionPersistence (cleared when the tab/window closes)
 *  - Persistence must be set *before* calling signInWithEmailAndPassword —
 *    Firebase applies it to the sign-in call that follows, not retroactively.
 *  - onIdTokenChanged (not just onAuthStateChanged) is used so a custom-claims
 *    refresh (e.g., an admin just changed this user's role) is picked up the
 *    next time Firebase silently refreshes the token, without requiring the
 *    user to sign out and back in.
 */
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

const AuthContext = createContext(null);

const REMEMBER_ME_KEY = "si_remember_me";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (fbUser) => {
      setError(null);
      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const tokenResult = await fbUser.getIdTokenResult();
        const claims = tokenResult.claims || {};

        // Display-only fields are enriched from Firestore; authorization
        // itself never depends on this read succeeding — role/department
        // come from claims above, which are already trustworthy on their own.
        let profile = {};
        try {
          const snap = await getDoc(doc(db, "users", fbUser.uid));
          if (snap.exists()) profile = snap.data();
        } catch {
          // Non-fatal — the user can still use the app with claims alone.
        }

        setUser({
          uid: fbUser.uid,
          email: fbUser.email,
          name: profile.name || fbUser.displayName || fbUser.email,
          phone: profile.phone || "",
          role: claims.role || profile.role || null,
          departmentId: claims.department_id || profile.department_id || null,
          plantIds: claims.plant_ids || profile.plant_ids || [],
        });
      } catch (e) {
        setError(e);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const signIn = useCallback(async (email, password, rememberMe) => {
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? "true" : "false");
    }
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const resetPassword = useCallback(async (email) => {
    await sendPasswordResetEmail(auth, email);
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
