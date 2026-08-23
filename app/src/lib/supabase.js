"use client";

import { createClient } from "@supabase/supabase-js";
import { isAuthExpiryError, reportAuthFailure, onRecovered } from "./sessionRecovery";

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

/** The address to prefill the sign-in form with, when the box was ticked. */
export const REMEMBERED_EMAIL_KEY = "si_remembered_email";

/**
 * Web Storage throws rather than returning null in a few real situations — a
 * WebView with DOM storage disabled, Safari's private mode quota, a page
 * running from a file:// origin. Every access here is guarded, because the one
 * thing that must not happen is the whole auth layer failing to load over it.
 */
function store(kind) {
  try {
    return window[kind] ?? null;
  } catch {
    return null;
  }
}

function readFrom(kind, key) {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function isRemembered() {
  // Default to remembering, matching Firebase's default persistence.
  return readFrom("localStorage", REMEMBER_ME_KEY) !== "false";
}

const hybridStorage = {
  /**
   * Read from wherever the value actually is, rather than from wherever the
   * flag says it should be.
   *
   * That distinction is the bug "Remember me" had. The flag picked the store for
   * reads as well as writes, so a session written to localStorage under a ticked
   * box became invisible the moment anything set the flag to "false" — a second
   * sign-in with the box cleared, a sign-in that errored after the flag was
   * written, a stale "false" from an earlier visit. The token was still sitting
   * in localStorage; nothing ever looked there again, and the user was returned
   * to the sign-in screen with no explanation.
   *
   * localStorage wins when both hold something, but setItem below guarantees
   * they never do.
   */
  getItem: (key) => readFrom("localStorage", key) ?? readFrom("sessionStorage", key),

  /**
   * Exactly one store holds the session at any moment: the one the flag selects.
   * Purging the other first is what keeps the fallback read above honest — a
   * leftover token in localStorage must not resurrect a session the user
   * deliberately chose not to persist.
   */
  setItem: (key, value) => {
    const remembered = isRemembered();
    try {
      store(remembered ? "sessionStorage" : "localStorage")?.removeItem(key);
    } catch {
      // Nothing to clean up, or storage is unavailable — the write below is
      // what matters.
    }
    try {
      store(remembered ? "localStorage" : "sessionStorage")?.setItem(key, value);
    } catch {
      // Out of quota or storage disabled. The session still works for this page
      // load; it just will not survive a reload.
    }
  },

  // Clear both, so signing out can never orphan a live token in the store we
  // are no longer reading from.
  removeItem: (key) => {
    for (const kind of ["localStorage", "sessionStorage"]) {
      try {
        store(kind)?.removeItem(key);
      } catch {
        // Already gone, or storage is unavailable.
      }
    }
  },
};

/**
 * Record the choice before signing in — it decides which store the session
 * lands in, and signInWithPassword is the call that writes it.
 *
 * The address is kept alongside it only when the box is ticked, so the sign-in
 * form can prefill. It is an identifier, not a credential; the password is
 * never stored.
 *
 * Omitting `email` sets the flag and leaves any stored address alone. That is
 * what lets the caller do this in two steps — flag before signInWithPassword,
 * because it decides the store; address only once the credentials were actually
 * accepted, so a typo in a rejected attempt is not what greets the user next
 * time. Unticking clears the address either way.
 */
export function rememberMe(flag, email) {
  const local = store("localStorage");
  if (!local) return;
  try {
    local.setItem(REMEMBER_ME_KEY, flag ? "true" : "false");
    if (!flag) local.removeItem(REMEMBERED_EMAIL_KEY);
    else if (email) local.setItem(REMEMBERED_EMAIL_KEY, email);
  } catch {
    // Storage unavailable — sign-in still works, it just won't be remembered.
  }
}

export function rememberedEmail() {
  if (readFrom("localStorage", REMEMBER_ME_KEY) === "false") return "";
  return readFrom("localStorage", REMEMBERED_EMAIL_KEY) || "";
}

export function wasRememberMeChecked() {
  return isRemembered();
}

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
 *
 * `table` accepts an array when the result depends on more than one table, so
 * that a change to any of them re-runs the query. listenTechnicians() is the
 * case that needs it: it reads the roster from `technicians` but decides
 * membership from `users`, and watching only the former left a revoked
 * technician on screen for as long as the panel stayed open.
 */
let channelSeq = 0;

export function liveQuery({ table, filter, run, cb, onError }) {
  let cancelled = false;

  const refresh = async () => {
    const { data, error } = await run();
    if (cancelled) return;
    if (error) {
      /**
       * An expired token is not this listener's problem to report.
       *
       * PostgREST answers one with PGRST301, and an expired token fails EVERY
       * mounted listener at once — a work order detail page runs five. Left to
       * the ordinary path, the user gets a screen of identical red boxes
       * reading "JWT expired", which names the mechanism and tells them nothing
       * they can act on, while the app quietly does nothing about it.
       *
       * So it goes to the recovery machine instead, which coalesces the lot
       * into one banner and one refresh, and onError is deliberately NOT
       * called: there is nothing for the component to show that the banner is
       * not already saying better. If recovery succeeds, the onRecovered
       * subscription below re-runs this query and the data simply appears. If
       * it fails, the user is on their way to /login and this component is
       * about to unmount.
       *
       * Narrow on purpose. Everything that is not an auth expiry still reaches
       * onError exactly as before — a broken policy or a bad column must stay
       * visible, not disappear into a spinner that never resolves.
       */
      if (isAuthExpiryError(error)) {
        reportAuthFailure(error);
        return;
      }
      onError?.(error);
      return;
    }
    cb(data ?? []);
  };

  refresh();

  /**
   * Re-run once the session is working again.
   *
   * Without this a listener that failed during the gap sits on stale or empty
   * data until something happens to change a row it watches — which on a quiet
   * work order is never. The user would be signed back in, told so, and still
   * looking at an empty list.
   */
  const stopWatchingRecovery = onRecovered(refresh);

  // One channel, one binding per table. `filter` describes the first table
  // only — it is a column predicate, and there is no caller that wants the same
  // one applied to a second, differently-shaped table.
  const tables = Array.isArray(table) ? table : [table];
  const channel = supabase.channel(`si-${tables.join("-")}-${++channelSeq}`);

  tables.forEach((t, i) => {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: t, ...(filter && i === 0 ? { filter } : {}) },
      refresh
    );
  });

  channel.subscribe();

  return () => {
    cancelled = true;
    stopWatchingRecovery();
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
