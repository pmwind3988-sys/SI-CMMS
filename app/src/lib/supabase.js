"use client";

import { createClient } from "@supabase/supabase-js";

/**
 * SI — Service Inside · Supabase client
 *
 * The two NEXT_PUBLIC_* values are inlined at build time. They are absent in
 * two situations that must not crash: a `next build` run before .env.local has
 * been filled in, and the static-export prerender pass (which evaluates this
 * module in Node, where createClient() throws on an empty URL — failing the
 * build).
 *
 * Placeholders keep module evaluation safe. Real misconfiguration is reported
 * loudly in the browser instead, where it is actionable.
 *
 * The anon/publishable key is meant to be public. It carries no authority of
 * its own: every request it makes is evaluated against Row Level Security using
 * the signed-in user's JWT, exactly as the Firebase web API key was evaluated
 * against security rules.
 */
const PLACEHOLDER_URL = "https://unconfigured.supabase.co";
const PLACEHOLDER_KEY = "unconfigured";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY;

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

if (typeof window !== "undefined" && !isSupabaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    "[SI] Supabase is not configured — every sign-in and query will fail.\n" +
      "Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in\n" +
      "app/.env.local (Supabase Dashboard → Project Settings → API), then rebuild:\n" +
      "  npm run build   (web / Vercel)\n" +
      "  npm run apk     (Android APK)"
  );
}

/**
 * "Remember Me" persistence.
 *
 * Firebase exposed this as browserLocalPersistence vs browserSessionPersistence.
 * Supabase picks its storage backend once, at client construction, so the same
 * behaviour needs a storage adapter that routes per call:
 *   remembered  -> localStorage   (survives closing the browser)
 *   not         -> sessionStorage (cleared when the tab/window closes)
 *
 * The same ordering constraint Firebase had still applies: the flag must be set
 * BEFORE signInWithPassword, because that is the call whose session gets
 * written. See AuthContext.signIn.
 */
export const REMEMBER_ME_KEY = "si_remember_me";

function backingStore() {
  // Default to remembering, matching Firebase's default persistence.
  const remembered = window.localStorage.getItem(REMEMBER_ME_KEY) !== "false";
  return remembered ? window.localStorage : window.sessionStorage;
}

const hybridStorage = {
  getItem: (key) => backingStore().getItem(key),
  setItem: (key, value) => backingStore().setItem(key, value),
  // Clear both, so flipping the flag can never orphan a live token in the
  // store we are no longer reading from.
  removeItem: (key) => {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Needed so a password-recovery link can establish a session from the URL
    // fragment. Harmless everywhere else.
    detectSessionInUrl: true,
    storage: typeof window === "undefined" ? undefined : hybridStorage,
  },
});

/**
 * Firestore's onSnapshot handed back the whole result set on every change.
 * Supabase Realtime hands back individual row deltas instead, so to preserve
 * the `listenX(args, cb, onError)` contract that every component in this module
 * is built around, each listener re-runs its query whenever a relevant row
 * changes.
 *
 * That is one extra round trip per change rather than a locally-patched cache.
 * It is the right trade here: the query is indexed and small, the result is
 * always consistent with what RLS would return right now, and it keeps ~24
 * component call sites completely unchanged.
 *
 * Realtime respects RLS on postgres_changes, so a technician subscribed to
 * work_orders is still only woken for rows their SELECT policy allows.
 */
let channelSeq = 0;

export function liveQuery({ table, filter, run, cb, onError }) {
  let cancelled = false;

  const refresh = async () => {
    const { data, error } = await run();
    if (cancelled) return;
    if (error) {
      onError?.(error);
      return;
    }
    cb(data ?? []);
  };

  refresh();

  const channel = supabase
    .channel(`si-${table}-${++channelSeq}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
      refresh
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

/** Single-row variant: cb receives the row or null, not an array. */
export function liveRow({ table, filter, run, cb, onError }) {
  return liveQuery({
    table,
    filter,
    run,
    cb: (rows) => cb(Array.isArray(rows) ? rows[0] ?? null : rows ?? null),
    onError,
  });
}
