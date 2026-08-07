"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

/**
 * The six NEXT_PUBLIC_* values are inlined at build time. They are absent in two
 * situations that must not crash: a `next build` run before .env.local has been
 * filled in, and the static-export prerender pass (which evaluates this module
 * in Node, where getAuth() would throw `auth/invalid-api-key` on an empty key
 * and getFirestore() would throw on a missing projectId — failing the build).
 *
 * Placeholders keep module evaluation safe. Real misconfiguration is reported
 * loudly in the browser instead, where it is actionable.
 */
const PLACEHOLDER = "unconfigured";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || PLACEHOLDER,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || `${PLACEHOLDER}.firebaseapp.com`,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || PLACEHOLDER,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${PLACEHOLDER}.appspot.com`,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || `1:000000000000:web:${PLACEHOLDER}`,
};

export const isFirebaseConfigured = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ? true : false;

if (typeof window !== "undefined" && !isFirebaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    "[SI] Firebase is not configured — every sign-in and Firestore read will fail.\n" +
      "Fill in the NEXT_PUBLIC_FIREBASE_* values in app/.env.local (Firebase Console →\n" +
      "Project Settings → General → Your apps → SDK setup and configuration), then rebuild:\n" +
      "  npm run build   (web / Hosting)\n" +
      "  npm run apk     (Android APK)"
  );
}

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Optional local development against the Firebase Emulator Suite.
// Run `npm run emulators` alongside `npm run dev` and set
// NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true in .env.local to use this.
if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true" &&
  !globalThis.__SI_EMULATORS_CONNECTED__
) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  globalThis.__SI_EMULATORS_CONNECTED__ = true;
}
