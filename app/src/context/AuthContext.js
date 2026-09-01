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
 *
 * ─── Session recovery ──────────────────────────────────────────────────────
 *
 * This provider also owns `sessionState`, the small machine that decides what a
 * stale session costs the person using the app. See the block comment above
 * beginRecovery() for the whole argument; the short version is that a session
 * can fail in three ways, only one of them is unrecoverable, and the app used
 * to treat all three as that one.
 */
import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { supabase, rememberMe as persistRememberMe } from "../lib/supabase";
import { dropPushSubscription } from "../lib/pushSubscription";
import { highestRole, ROLES } from "../lib/roles";
import {
  onAuthFailure,
  announceRecovered,
  isRetryableFailure,
} from "../lib/sessionRecovery";
import {
  snapshotDrafts,
  setResumeTicket,
  clearResumeTicket,
  clearDraftsFor,
} from "../lib/draftRecovery";

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

/**
 * The one sentence every rejected sign-in gets, on both paths.
 *
 * Exported, and used by the login page too, because the two paths having two
 * wordings IS the leak: the auth-signin function goes to some trouble to make an
 * unknown employee number indistinguishable from a wrong password, and a
 * different sentence arriving from GoTrue on the email path would hand that
 * distinction straight back. Kept byte-identical to the function's own GENERIC.
 */
export const GENERIC_SIGNIN_FAILURE = "Those details didn't match.";

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

/**
 * The three states a signed-in session can be in, from the app's point of view.
 *
 *   active     — normal. Also the state before anybody has signed in at all,
 *                which is what keeps first-load behaviour exactly as it was:
 *                no user and nothing wrong means "go to /login".
 *   recovering — the token has stopped working and we are trying to get a new
 *                one without asking for a password. The page STAYS MOUNTED.
 *   lost       — recovery was abandoned. Drafts have been snapshotted and the
 *                user is on their way to /login.
 */
export const SESSION_ACTIVE = "active";
export const SESSION_RECOVERING = "recovering";
export const SESSION_LOST = "lost";

/**
 * How long to wait between recovery attempts, in ms.
 *
 * Tuned around a measured constant in the auth client rather than picked for
 * feel: supabase-js caches a failed refresh for REFRESH_FAILURE_COOLDOWN_MS
 * (60s, = 2 × AUTO_REFRESH_TICK_DURATION_MS) keyed on the refresh token that
 * failed, and returns that cached failure synchronously to anyone who retries
 * with the same token inside the window.
 *
 * So the early rungs here are deliberately cheap rather than pointless. They
 * cost no network at all while the cooldown holds, and they exist for the case
 * where the token CHANGED under us in the meantime — another tab's refresh
 * rotated it, or the auto-refresh ticker succeeded — which bypasses the cache
 * and is a real attempt. The 60s cap is the first rung guaranteed to reach the
 * network again on an unchanged token.
 *
 * Nothing here is a deadline. A retryable failure retries forever, because the
 * alternative is signing someone out for going through a tunnel.
 */
const RECOVERY_BACKOFF_MS = [0, 2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * How long after a successful recovery to ignore further failure reports.
 *
 * Measured rather than guessed. Loading the work order list with a token the
 * server refuses produced ELEVEN PGRST301 reports and TWO recoveries: the first
 * ten coalesced into one refresh, and a straggler whose request had left with
 * the old token landed after that refresh completed and started a second,
 * entirely pointless one.
 *
 * It converges either way — the second refresh succeeds and nothing further
 * fails — so this is not a loop being broken. It is one wasted round trip on
 * every recovery, and on a plant phone that is the difference between the
 * banner clearing once and clearing twice.
 *
 * A request that failed cannot say when it started, so "was this failure
 * already answered?" can only be approximated by elapsed time. Two seconds is
 * comfortably longer than an in-flight PostgREST read and far shorter than any
 * interval over which a freshly-issued token could go bad on its own — and if
 * one somehow did, the next failure after the window still recovers.
 */
const RECOVERY_GRACE_MS = 2_000;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /**
   * `recovering` and `lost` above. Read by RequireAuth, which is the component
   * that decides between holding the page and leaving it.
   */
  const [sessionState, setSessionState] = useState(SESSION_ACTIVE);
  /**
   * Which sentence the banner shows: "expired" while we are simply getting a
   * new token, "offline" once an attempt has failed for a reason that will fix
   * itself. Starting at "expired" and only moving to "offline" after evidence
   * means a two-second recovery never accuses the user's connection.
   */
  const [recoveryReason, setRecoveryReason] = useState("expired");

  /**
   * Was the sign-out asked for?
   *
   * supabase-js emits the same SIGNED_OUT event whether the user pressed Sign
   * out or the refresh token was rejected, and the two must not be handled
   * alike: one should clear the screen immediately, the other must not clear
   * anything until recovery has been tried. Nothing in the event distinguishes
   * them, so the intent has to be recorded on our side, by the only code that
   * knows it.
   */
  const intentional = useRef(false);
  /** Single-flight guard: one expired token fails every mounted listener at once. */
  const recovering = useRef(false);
  /**
   * The last refresh token we saw on a live session.
   *
   * Needed because by the time SIGNED_OUT reaches us the auth client has
   * already erased the session from storage, so a bare refreshSession() has
   * nothing to work with and fails with AuthSessionMissingError. This is the
   * only copy left, and it is held in memory only — never written anywhere.
   */
  const lastRefreshToken = useRef(null);
  /** The signed-in user as of right now, readable from callbacks that must not re-subscribe. */
  const userRef = useRef(null);
  /** Resolves the current backoff sleep early, so `online` can cut a 60s wait short. */
  const wake = useRef(null);
  /**
   * When the last recovery succeeded. See RECOVERY_GRACE_MS.
   *
   * Starts at 0 rather than Date.now() so the very first failure after a cold
   * load is never inside the window.
   */
  const recoveredAt = useRef(0);

  /**
   * Recovery succeeded, or was never running.
   *
   * Called on EVERY event that carries a session, not only on the one our own
   * refresh produced. The auth client runs its own ticker and its own
   * visibility handler, so it frequently gets there first — and a banner still
   * reading "signing you back in…" over a session that already works is a worse
   * bug than the one being fixed.
   */
  const finishRecovery = useCallback(() => {
    const wasRecovering = recovering.current;
    recovering.current = false;
    wake.current = null;
    setSessionState(SESSION_ACTIVE);
    setRecoveryReason("expired");
    /* Only when something was actually broken. Announcing on an ordinary
       sign-in would make every live query run twice on the first paint. */
    if (wasRecovering) {
      recoveredAt.current = Date.now();
      announceRecovered();
    }
  }, []);

  /**
   * Recovery is over and it failed for a reason that will not fix itself.
   *
   * The ORDER in this function is the entire point of it. snapshotDrafts() has
   * to run while the tree is still mounted, because a draft is captured by
   * asking the live component for its state — and clearing `user` is what makes
   * RequireAuth redirect and unmount everything. Reverse these two lines and
   * the feature still compiles, still shows the right banner, still lands on
   * the right page, and silently saves nothing every single time.
   */
  const abandonRecovery = useCallback(() => {
    recovering.current = false;
    wake.current = null;

    const uid = userRef.current?.uid;
    if (uid) {
      const drafts = snapshotDrafts(uid);
      /* Read off window rather than through usePathname/useSearchParams: this
         is not a component, and useSearchParams would demand a Suspense
         boundary that the static export build rejects. Same reasoning, and the
         same expression, as RequireAuth. */
      const next =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/";
      setResumeTicket(uid, next, drafts);
    }

    setSessionState(SESSION_LOST);
    userRef.current = null;
    setUser(null);
  }, []);

  /**
   * One attempt at getting a working session back, with no password.
   *
   * Two calls rather than one because the two situations need different inputs.
   * If a session is still in storage — the token merely expired — the ordinary
   * refreshSession() is right, and it has the additional virtue of picking up a
   * token another tab may have rotated in the meantime, which sidesteps the
   * auth client's 60-second same-token failure cache. If the session is GONE,
   * which is what an involuntary SIGNED_OUT means, the in-memory mirror is the
   * only credential left anywhere.
   *
   * With neither, there is nothing to recover from and saying so as a
   * non-retryable failure is what routes the user to a sign-in screen instead
   * of a banner that spins forever.
   */
  const attemptRefresh = useCallback(async () => {
    const { data: current } = await supabase.auth.getSession();
    if (current?.session) return supabase.auth.refreshSession();
    if (lastRefreshToken.current) {
      return supabase.auth.refreshSession({ refresh_token: lastRefreshToken.current });
    }
    return { data: { session: null }, error: new Error("No session left to recover.") };
  }, []);

  /**
   * The retry loop.
   *
   * The one branch worth reading twice is the last: a RETRYABLE failure never
   * ends the loop. Being offline is not being signed out, and treating it as
   * one destroys work in order to react to a condition that resolves itself
   * when the user walks out of the lift. Only an affirmative rejection of the
   * refresh token — the account was deactivated, the password changed, the
   * token was revoked — reaches abandonRecovery().
   */
  const runRecovery = useCallback(async () => {
    for (let attempt = 0; recovering.current; attempt += 1) {
      const delay = RECOVERY_BACKOFF_MS[Math.min(attempt, RECOVERY_BACKOFF_MS.length - 1)];
      if (delay) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay);
          // Lets the `online` listener below cut a 60-second wait short.
          wake.current = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      // Re-checked after every await: the auth client's own ticker may have
      // succeeded while we slept, in which case finishRecovery() has already
      // run and there is nothing left to do.
      if (!recovering.current) return;

      const { data, error: refreshError } = await attemptRefresh();
      if (!recovering.current) return;

      if (data?.session) {
        /* onAuthStateChange fires TOKEN_REFRESHED and would call this anyway.
           Calling it here as well makes the success path independent of an
           event arriving, and finishRecovery is idempotent by construction. */
        finishRecovery();
        return;
      }
      if (!isRetryableFailure(refreshError)) {
        abandonRecovery();
        return;
      }
      setRecoveryReason("offline");
    }
  }, [attemptRefresh, finishRecovery, abandonRecovery]);

  /**
   * ─── Why any of this exists ─────────────────────────────────────────────
   *
   * A session stops working in three quite different ways, and this app used to
   * treat all three as the worst one: redirect to /login, discarding whatever
   * was on screen. On a phone, on a plant floor, that is a typed fault report
   * gone.
   *
   *   1. The access token expired, the refresh token is fine. By far the most
   *      common — a tab open since Friday, a phone that slept. Recoverable with
   *      no password, and the user need never know it happened beyond a strip
   *      at the top of the screen.
   *   2. The network is down. The session is perfectly good. Signing anyone out
   *      over this is indefensible.
   *   3. The refresh token was rejected. Nothing can re-authenticate without
   *      the password, so the only thing left to do well is lose nothing on the
   *      way to the sign-in screen.
   *
   * Single-flight, because one expired token fails every mounted listener at
   * once — the work order detail page alone runs five — and eleven simultaneous
   * reports must produce one refresh, not eleven.
   */
  const beginRecovery = useCallback(() => {
    if (recovering.current) return;
    recovering.current = true;
    setSessionState(SESSION_RECOVERING);
    setRecoveryReason("expired");
    void runRecovery();
  }, [runRecovery]);

  /**
   * The two things that say "the token stopped working" from outside this file.
   *
   * The first is the data layer: liveQuery reports a PGRST301 here rather than
   * pushing eleven red "JWT expired" banners into eleven components. Guarded on
   * there being a user, so a 401 arriving on a page nobody is signed in to is
   * left alone rather than starting a recovery for nobody.
   *
   * The second is `online`. It does not start a recovery — coming back onto
   * Wi-Fi is not evidence that anything is wrong — it only shortens a wait
   * already in progress, which is the difference between the banner clearing as
   * the user reconnects and clearing up to a minute later.
   */
  useEffect(() => {
    const stopListening = onAuthFailure(() => {
      if (!userRef.current) return;
      /* A straggler that left with the token we have just replaced. See
         RECOVERY_GRACE_MS — this is what stops one recovery costing two
         refreshes. */
      if (Date.now() - recoveredAt.current < RECOVERY_GRACE_MS) return;
      beginRecovery();
    });
    const nudge = () => {
      if (recovering.current) wake.current?.();
    };
    window.addEventListener("online", nudge);
    return () => {
      stopListening();
      window.removeEventListener("online", nudge);
    };
  }, [beginRecovery]);

  useEffect(() => {
    let active = true;

    async function resolve(session) {
      setError(null);
      if (!session?.user) {
        if (active) {
          userRef.current = null;
          setUser(null);
          setLoading(false);
        }
        return;
      }
      // Mirrored on every live session, because SIGNED_OUT arrives after the
      // stored copy has already been erased. See lastRefreshToken above.
      if (session.refresh_token) lastRefreshToken.current = session.refresh_token;
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

        const resolved = {
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
        };
        userRef.current = resolved;
        setUser(resolved);
      } catch (e) {
        if (active) {
          setError(e);
          userRef.current = null;
          setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => resolve(data.session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      /**
       * A sign-out nobody asked for is the symptom this whole mechanism exists
       * for, and it is handled by NOT handling it: resolve() is skipped, so
       * `user` keeps its value and every mounted component — including the
       * half-filled work order form — stays exactly as it is while recovery
       * runs.
       *
       * Keeping a stale `user` on screen is safe here for the reason stated at
       * the top of CLAUDE.md: the database is the authorization boundary. The
       * client object decides what to SHOW; every request still carries
       * whatever token actually exists, which during recovery is none, so
       * nothing is granted. The alternative — nulling it — makes every mounted
       * component dereference a null user and crashes the page this is
       * supposed to be protecting.
       *
       * The cross-tab case resolves itself rather than being special-cased:
       * another tab pressing Sign out broadcasts SIGNED_OUT here too, and this
       * tab will try to recover — but supabase-js signs out with `scope:
       * 'global'` by default, so the mirrored refresh token has already been
       * revoked server-side and the attempt is refused. One round trip, then
       * the same sign-in screen the user was expecting.
       */
      if (event === "SIGNED_OUT" && !intentional.current && userRef.current) {
        beginRecovery();
        return;
      }
      /**
       * A session has arrived but `user` is not built yet, and resolve() below
       * is asynchronous — it fetches the profile row before it can set one.
       * Nothing awaits it, so without this line there is a window in which
       * `loading` is false and `user` is null, which is indistinguishable from
       * "nobody is signed in" to every consumer of this context.
       *
       * That window is what produced the double sign-in: the login page has the
       * session, navigates to the dashboard, and RequireAuth — reaching the
       * false/null pair — bounces straight back to /login. The user re-typed a
       * password they had already got right, and the second attempt worked only
       * because the first one's profile fetch had landed by then. Intermittent
       * because it is a race between one `users` row fetch and a client-side
       * route change: won on a desk, lost on a plant phone.
       *
       * Guarded on there being no user yet, so an ordinary hourly TOKEN_REFRESHED
       * on a live page does not flash a "Loading…" screen over somebody's work.
       * resolve() clears it again in its `finally`.
       */
      if (session && !userRef.current) setLoading(true);
      /* Any event carrying a session means the token works again — whether it
         came from our own refreshSession() or from the auth client's ticker
         getting there first. Either way recovery is over. */
      if (session) finishRecovery();
      resolve(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Sign in with a company email address or an employee number.
   *
   * TWO PATHS, DELIBERATELY. An email goes straight to GoTrue as it always has. A
   * number goes through the auth-signin Edge Function, because resolving it to an
   * address needs the service-role key — an anon-callable lookup would be a
   * public staff directory (see that function's header).
   *
   * Routing everything through the function would be more uniform, and would make
   * it a single point of failure for all access. Splitting means an outage costs
   * employee-ID sign-ins only, and the people most likely to have a mailbox are
   * the ones still able to get in — and to be sent a recovery link.
   *
   * The cost of splitting is TWO ERROR SURFACES. Both must refuse in the same
   * words, or the difference between them becomes the oracle the function's
   * generic message exists to deny: see friendlyError() on the login page, which
   * flattens GoTrue's "user not found" into the same sentence.
   */
  const signIn = useCallback(async (identifier, password, remember) => {
    const trimmed = (identifier ?? "").trim();
    const byEmail = trimmed.includes("@");

    /* A deliberate sign-in ends any recovery, including one still retrying in
       the background against a dead token. Without this the loop outlives the
       new session and its next failure would abandon a session that works. */
    recovering.current = false;
    wake.current = null;
    intentional.current = false;

    // Before either call — it decides which store the session lands in, and the
    // session is written by whichever call below succeeds. See the storage
    // adapter in lib/supabase.js.
    persistRememberMe(remember);

    let session;
    let authUser;

    if (byEmail) {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (signInError) throw signInError;
      session = data.session;
      authUser = data.user;
    } else {
      const { data, error: fnError } = await supabase.functions.invoke("auth-signin", {
        body: { identifier: trimmed, password },
      });
      /* supabase-js collapses any non-2xx into "Edge Function returned a non-2xx
         status code" and hides the real reason in error.context. Unwrap it — the
         function only ever sends the one generic sentence, so there is nothing to
         leak by showing it, and the generic message is better than the wrapper. */
      if (fnError) {
        let detail = null;
        try {
          detail = (await fnError.context?.json())?.error;
        } catch {
          // Not JSON — fall through to the generic message.
        }
        throw new Error(detail || GENERIC_SIGNIN_FAILURE);
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.session?.access_token) throw new Error(GENERIC_SIGNIN_FAILURE);

      // setSession is what writes it into the store the flag above selected, and
      // what makes onAuthStateChange fire so AuthContext resolves the user.
      const { data: set, error: setError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (setError) throw setError;
      session = set.session;
      authUser = set.user;
    }

    /* The identifier only after the credentials were accepted, so a rejected
       attempt leaves no typo waiting in the field. Stored AS TYPED: someone who
       signs in by number is offered the number next time, not an address they may
       not even know. */
    if (remember) persistRememberMe(true, trimmed);

    // Hand the roles back with the user so the caller can redirect immediately
    // instead of waiting for onAuthStateChange to populate `user`. Same source
    // of truth as everywhere else: the access-token hook's claims. An empty set
    // means the hook is disabled, this account has no row in public.users, or it
    // is inactive — callers should treat that as its own failure, not as bad
    // credentials.
    const signInClaims = claimsFromSession(session);
    const roles =
      signInClaims.user_roles ?? (signInClaims.user_role ? [signInClaims.user_role] : []);
    return {
      user: authUser,
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

  /**
   * The flag is what tells the SIGNED_OUT handler above that this one was
   * asked for, and must be set BEFORE the call that emits the event.
   *
   * Resetting it in `finally` is safe rather than racy: supabase-js awaits
   * _notifyAllSubscribers('SIGNED_OUT') inside signOut(), so the handler has
   * already run and read the flag by the time this returns.
   *
   * Drafts go with it. A deliberate sign-out is not an interruption, so there
   * is nothing to resume — and leaving a rescued work order behind for the next
   * person to sign in on a shared plant terminal is the one outcome this whole
   * mechanism must not produce.
   */
  const signOut = useCallback(async () => {
    intentional.current = true;

    /**
     * Stop any recovery still in flight, and stop it HERE rather than letting it
     * notice on its own.
     *
     * Pressing Sign out while the banner is up is an ordinary thing to do — it
     * is the obvious response to "signing you back in…" taking a while. Two
     * things went wrong without this. The retry loop outlived the sign-out, its
     * next attempt was refused, and abandonRecovery() filed a resume ticket, so
     * a user who had deliberately signed out was met with "Your session ended"
     * and an offer to take them back to what they were doing. And
     * `sessionState` was left on `recovering`, which is precisely the state
     * RequireAuth refuses to redirect out of — so the app cleared the user,
     * declined to navigate, and rendered nothing at all.
     */
    recovering.current = false;
    wake.current = null;
    setSessionState(SESSION_ACTIVE);
    setRecoveryReason("expired");

    const uid = userRef.current?.uid;
    try {
      /* Before the session goes, not after: si_unregister_push_subscription is
         an RPC and needs a token. Reversed, it fails silently and this browser
         keeps receiving alerts for somebody who has signed out — which on a
         shared plant terminal means the next person's phone-shaped problem. */
      await dropPushSubscription();

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } finally {
      if (uid) clearDraftsFor(uid);
      clearResumeTicket();
      intentional.current = false;
    }
  }, []);

  const resetPassword = useCallback(async (email) => {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: resetRedirectUrl(),
    });
    if (resetError) throw resetError;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        signIn,
        signOut,
        resetPassword,
        sessionState,
        recoveryReason,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
