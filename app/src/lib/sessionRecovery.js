"use client";

/**
 * SI — Service Inside · Session recovery bus
 *
 * A session can go stale in three quite different ways, and the app used to
 * treat all three identically: bounce to /login and lose whatever was on screen.
 *
 *   1. The access token expired and the refresh token is still good. This is the
 *      overwhelmingly common case — a tab left open over a weekend, a phone that
 *      slept. It is recoverable with no password at all.
 *   2. The network is down. Nothing is wrong with the session; it simply cannot
 *      be refreshed right now. Signing the user out over this is the worst of
 *      the three outcomes, because it destroys work in order to react to a
 *      condition that fixes itself.
 *   3. The refresh token itself was rejected — revoked, rotated away, the
 *      password changed elsewhere, the account deactivated. Nothing in this
 *      file or any other can re-authenticate without the password. The only
 *      thing left to do well is to lose nothing on the way to the sign-in
 *      screen.
 *
 * This module is the plumbing that lets those be told apart and reacted to in
 * one place. It is deliberately:
 *
 *   - **Free of React.** lib/supabase.js is where the 401s surface and it is not
 *     a component; the state machine that consumes this lives in AuthContext.
 *   - **Free of any Supabase import.** lib/supabase.js imports THIS module, so
 *     importing it back would be a cycle. The refresh itself is performed by
 *     AuthContext, which owns both. Nothing here knows how a session is renewed
 *     — only that somebody should try.
 */

/**
 * Does this error mean "your token is no longer acceptable", as opposed to any
 * of the hundred other things that can go wrong with a request?
 *
 * Three shapes, because three layers can raise it:
 *
 *   - PostgREST answers an expired or malformed JWT with **PGRST301**. That is
 *     the one that actually fires in this app: every read goes through
 *     liveQuery, and an expired access token comes back as PGRST301 rather than
 *     as anything from the auth client.
 *   - A bare HTTP **401** covers Storage, Edge Functions and the REST endpoint
 *     when PostgREST has not attached a code.
 *   - GoTrue's own wording, for the paths that surface an AuthApiError directly.
 *
 * Everything else is somebody else's problem and must keep flowing to the
 * caller's onError. Widening this predicate is how a genuine bug — a broken
 * policy, a bad column — turns into an infinite "signing you back in…" loop
 * that never diagnoses itself, so keep it narrow.
 */
export function isAuthExpiryError(error) {
  if (!error) return false;

  const code = String(error.code ?? "");
  if (code === "PGRST301") return true;

  // `status` is what supabase-js puts on a PostgrestError / AuthApiError;
  // `statusCode` appears on StorageApiError.
  if (Number(error.status) === 401 || Number(error.statusCode) === 401) return true;

  const msg = String(error.message ?? "");
  return /jwt expired|invalid jwt|jwt.*(malformed|invalid)|token is expired|session (from session_id claim in jwt )?does not exist|refresh_token_not_found/i.test(
    msg
  );
}

/**
 * Is this the kind of failure that will fix itself?
 *
 * The distinction decides whether the user keeps their work. supabase-js labels
 * a failed fetch `AuthRetryableFetchError` and — importantly — does NOT destroy
 * the session over one; it only tears the session down when the refresh token is
 * affirmatively rejected. This mirrors that judgement on our side so a tunnel, a
 * lift or a dropped Wi-Fi connection produces "retrying…" and never a sign-out.
 *
 * Matched on the message as well as the name for the same reason describeError()
 * does it: a fetch rejection arriving through a different layer is a plain
 * TypeError, and the name alone would miss it. A real bug in our own code is
 * also a TypeError, which is why the message pattern and not `instanceof` is
 * what decides.
 */
export function isRetryableFailure(error) {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  const msg = String(error.message ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|timeout|aborted/i.test(msg);
}

/* ------------------------------------------------------------------------- *
 * The bus.
 *
 * Two channels, not one, because the two directions have different audiences:
 * `failure` has exactly one subscriber (AuthContext, which drives recovery),
 * while `recovered` has many (every live query that needs to re-run). Keeping
 * them separate is what stops a stray listener from being handed the job of
 * refreshing the session.
 * ------------------------------------------------------------------------- */

const failureSubscribers = new Set();
const recoverySubscribers = new Set();

function emit(subscribers, arg) {
  // Copied before iterating: a subscriber is allowed to unsubscribe itself from
  // inside its own callback, and mutating a Set mid-iteration skips the next
  // entry silently.
  for (const fn of [...subscribers]) {
    try {
      fn(arg);
    } catch {
      /* One bad subscriber must not stop the others from being told. There is
         nothing useful to do with the error here — this is a notification, and
         the thing being notified about is already a degraded session. */
    }
  }
}

/**
 * "A request just failed because the token is no longer good."
 *
 * Called from the data layer, which has no idea whether anything can be done
 * about it. Fan-out is one-way and fire-and-forget: this never throws and never
 * returns a promise, so a caller in the middle of handling a query error is
 * never made to await a token refresh.
 *
 * Coalescing is the CONSUMER's job, not this function's. A single expired token
 * makes every mounted listener fail at once — a work order detail page has five
 * — so AuthContext keeps recovery single-flight rather than this pretending one
 * report is more meaningful than eleven.
 */
export function reportAuthFailure(error) {
  emit(failureSubscribers, error ?? null);
}

/** Subscribe to auth failures. Returns an unsubscribe function. */
export function onAuthFailure(cb) {
  failureSubscribers.add(cb);
  return () => failureSubscribers.delete(cb);
}

/**
 * "The session is good again."
 *
 * Announced by AuthContext once a refresh has actually produced a session. Its
 * subscribers are the live queries that gave up during the gap: without this
 * they would sit on stale or empty data until something else happened to change
 * a row, which on a quiet work order is never.
 */
export function announceRecovered() {
  emit(recoverySubscribers, undefined);
}

/** Subscribe to recovery. Returns an unsubscribe function. */
export function onRecovered(cb) {
  recoverySubscribers.add(cb);
  return () => recoverySubscribers.delete(cb);
}
