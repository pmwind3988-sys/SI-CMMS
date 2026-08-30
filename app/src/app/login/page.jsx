"use client";

/**
 * SI — Service Inside · Authentication Module
 * Login screen. Redirect-on-success always goes to the signed-in user's
 * own role dashboard (see roles.js) — `next` (if present, from a session
 * expiry mid-use) is intentionally not used to override that, matching
 * the requirement that role determines landing page, not browsing history.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useAuth, GENERIC_SIGNIN_FAILURE } from "../../context/AuthContext";
import { rememberedEmail, wasRememberMeChecked } from "../../lib/supabase";
import {
  peekResumeTicket,
  clearResumeTicket,
  clearDraftsFor,
} from "../../lib/draftRecovery";
import { dashboardPathForRole } from "../../lib/roles";
import Field, { inputClass } from "../../components/ui/Field";
import PasswordInput from "../../components/ui/PasswordInput";
import { ErrorBanner } from "../../components/ui/Surfaces";

const COMPANY_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_COMPANY_EMAIL_DOMAIN || null;

function Logo({ size = 38 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-label="SI logo">
      <rect width="34" height="34" rx="9" fill="#fff" />
      <path
        d="M9.2 13.4c0-2.1 1.9-3.6 4.6-3.6 2.4 0 4.1 1 4.8 2.7l-2.3 1.1c-.5-1-1.3-1.5-2.5-1.5-1.1 0-1.8.5-1.8 1.2 0 .8.8 1.1 2.3 1.5 2.5.6 4.3 1.4 4.3 3.8 0 2.2-2 3.7-4.9 3.7-2.6 0-4.5-1.1-5.2-2.9l2.3-1.1c.5 1.1 1.5 1.7 2.9 1.7 1.2 0 2-.5 2-1.3 0-.8-.8-1.1-2.5-1.5-2.4-.6-4-1.5-4-3.8z"
        fill="#0F3D91"
      />
      <rect x="22.4" y="10.1" width="2.5" height="12.9" rx="1.1" fill="#0F3D91" />
      <circle cx="23.65" cy="7.4" r="1.9" fill="#F59E0B" />
    </svg>
  );
}

/**
 * Only applies to something that is actually an email address.
 *
 * Without the second guard, configuring a company domain would reject every
 * employee number before it reached the network — the field accepts two kinds of
 * identifier now, and this rule is about only one of them.
 */
function isCompanyEmail(value) {
  if (!COMPANY_EMAIL_DOMAIN) return true; // no domain configured -> don't block
  if (!value.includes("@")) return true; // an employee number, not an address
  return value.toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN.toLowerCase()}`);
}

export default function LoginPage() {
  const { signIn, user, sessionState } = useAuth();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  /**
   * Set when we arrived here because a session ended rather than because
   * nobody was signed in. Holds the ticket AuthContext wrote on the way out —
   * who was interrupted, where, and whether anything was actually saved.
   */
  const [expired, setExpired] = useState(null);

  /**
   * Read in an effect rather than as a useState initialiser. This page is part
   * of a static export, so its HTML is generated at build time with an empty
   * field; seeding the initial state from localStorage would make the first
   * client render disagree with that HTML, and React discards the whole tree
   * on a hydration mismatch.
   */
  /**
   * Somebody who is already signed in does not need this page.
   *
   * With a live session in storage, /login rendered the sign-in form anyway:
   * a dead end for the user, and on a shared machine an invitation to type
   * credentials into a form while a different account is still active
   * underneath — the next thing that happens is two people sharing one
   * session without either of them realising.
   *
   * Gated on `active` deliberately. During recovery `user` deliberately keeps
   * its value while there is no usable token (see AuthContext), and a `lost`
   * session is exactly the case this page exists for; redirecting on either
   * would bounce somebody away from the only screen that can help them.
   * `mustChangePassword` is excluded because that account's one destination is
   * /change-password, which dashboardPathForRole cannot name.
   */
  useEffect(() => {
    if (sessionState !== "active" || !user || user.mustChangePassword) return;
    router.replace(dashboardPathForRole(user.role));
  }, [user, sessionState, router]);

  useEffect(() => {
    setRememberMe(wasRememberMeChecked());
    // Whatever was typed last time — an address or a number.
    const saved = rememberedEmail();
    if (saved) setIdentifier(saved);

    /**
     * Both halves are required before anything is promised.
     *
     * `reason=expired` says how the user got here; the ticket says whether
     * there is actually something to go back to. Reading only the query
     * parameter would let a hand-typed or bookmarked ?reason=expired produce a
     * "your work is waiting" message with nothing behind it — and the same URL
     * arriving days later would say it again. Read off window rather than via
     * useSearchParams, which would need a Suspense boundary the static export
     * build rejects.
     */
    const params = new URLSearchParams(window.location.search);
    if (params.get("reason") !== "expired") return;
    const ticket = peekResumeTicket();
    if (ticket?.uid) setExpired(ticket);
  }, []);

  /**
   * Supabase auth errors carry a machine-readable `code` plus an HTTP `status`;
   * they never use Firebase's `auth/*` strings.
   *
   * The default branch deliberately surfaces the underlying message rather than
   * blaming the password. An unrecognised error is a bug or a misconfiguration,
   * and reporting it as "check your email and password" sends you hunting for a
   * credentials problem that isn't there.
   */
  function friendlyError(e) {
    if (e?.name === "AuthRetryableFetchError") {
      return "Can't reach the authentication server. Check your connection, and that NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set correctly.";
    }
    switch (e?.code) {
      case "validation_failed":
        return "That doesn't look like a valid email address.";
      case "user_banned":
        return "This account has been disabled. Contact your administrator.";
      case "email_not_confirmed":
        return "Confirm your email address first — check your inbox for the verification link.";
      case "invalid_credentials":
      case "user_not_found":
        /* Byte-identical to the auth-signin function's refusal, via the shared
           constant. Two paths phrasing a rejection differently is a way to tell
           an unknown identifier from a wrong password — which is exactly what
           that function's generic message and timing floor exist to deny, so
           leaking it here would undo both. */
        return GENERIC_SIGNIN_FAILURE;
      case "over_request_rate_limit":
        return "Too many attempts. Wait a few minutes and try again.";
      default:
        break;
    }
    if (e?.status === 429) return "Too many attempts. Wait a few minutes and try again.";
    if (e?.status === 400 || e?.status === 422) {
      return GENERIC_SIGNIN_FAILURE;
    }
    return e?.message || "Couldn't sign in — please try again.";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!isCompanyEmail(identifier)) {
      setError(`Please sign in with your company email address (@${COMPANY_EMAIL_DOMAIN}).`);
      return;
    }

    setStatus("checking");
    try {
      const { user: signedIn, role, mustChangePassword } = await signIn(
        identifier,
        password,
        rememberMe,
      );

      /**
       * Where to land — and the one documented exception to "role decides".
       *
       * The rule in CLAUDE.md and the FSD is that the landing page is the
       * signed-in role's own dashboard, never browsing history. That rule is
       * about a fresh sign-in, and it stays. This is the other case: the user
       * was already working, the session ended underneath them, and their
       * half-typed work order is sitting in storage waiting for the page it
       * belongs to. Sending them to a dashboard instead would mean rescuing the
       * draft and then hiding it.
       *
       * THE UID TEST IS THE WHOLE SAFETY ARGUMENT. A sign-in screen raised by
       * an expiry is exactly where a second person walks up to a shared
       * workshop terminal — so resuming is permitted only when the account that
       * signed in is the account that was interrupted. Anyone else gets their
       * own dashboard, and the previous holder's drafts are destroyed rather
       * than left sitting in the tab. They were never readable across accounts
       * (the uid is part of every draft key), but unreachable and absent are
       * different claims and only one of them is worth making.
       */
      let resumeTo = null;
      const ticket = peekResumeTicket();
      if (ticket?.uid) {
        if (signedIn?.id && ticket.uid === signedIn.id) {
          resumeTo = ticket.next || null;
        } else {
          clearDraftsFor(ticket.uid);
        }
        clearResumeTicket();
      }

      /**
       * Checked BEFORE the no-role branch below, because it is the reason the
       * roles are missing (migration 0026 withholds them while the flag is set)
       * and because this branch navigates while that one does not.
       *
       * Getting this order wrong strands the account: an admin creates a user,
       * that user signs in with the password they were given, and the no-role
       * branch reports a misconfiguration and returns — so they never reach
       * /change-password, which is the only thing they are allowed to do. That
       * is not hypothetical; it is what happened the first time an account was
       * created after admin-users started flagging them.
       */
      if (mustChangePassword) {
        setStatus("success");
        router.replace("/change-password/");
        return;
      }

      if (!role) {
        /**
         * Credentials accepted, no role claims in the token. Three causes, and
         * the person signing in cannot tell them apart: the account is not
         * active (migration 0026), it has no row in public.users, or the
         * access-token hook is not enabled in the Supabase dashboard
         * (Authentication → Hooks → Customize Access Token).
         *
         * All three are an administrator's problem and none of them is a typo,
         * which is why this does not say "check your password".
         */
        setStatus("idle");
        setError(
          "Signed in, but this account has no access. It may have been deactivated, " +
            "or it has no role assigned. Contact your administrator.",
        );
        return;
      }
      setStatus("success");
      /* resumeTo is same-account-only and comes from a ticket this app wrote,
         never from the URL — so it is always an in-app path, and it cannot be
         used to point somebody at a page they did not come from. */
      router.replace(resumeTo || dashboardPathForRole(role));
    } catch (e) {
      setStatus("idle");
      setError(friendlyError(e));
    }
  }

  return (
    // min-h-dvh, not min-h-screen: 100vh on a mobile browser is the height with
    // the URL bar hidden, so the sign-in card sat partly below the fold and the
    // page scrolled for no reason.
    <div className="min-h-dvh flex flex-col lg:flex-row bg-navy font-sans">
      {/* The navy panel, on a phone.
          Below `md` the branded half was simply hidden and the screen was a
          plain grey field with a form on it — the one place in the app with no
          brand surface at all. This is the same gradient, reduced to a band
          across the top, with the sign-in card overlapping its bottom edge so
          the two read as one object rather than two stacked blocks. */}
      <div className="si-navy px-6 pb-11 pt-[calc(2.5rem+env(safe-area-inset-top))] lg:hidden">
        <div className="rise flex items-center gap-3">
          <Logo size={34} />
          <div>
            <div className="text-[19px] font-extrabold leading-none text-white">SI</div>
            <div className="mt-0.5 text-[9.5px] tracking-wide text-[#9FB6E0]">SERVICE INSIDE</div>
          </div>
        </div>
        <h1 className="rise-slow mt-5 text-[19px] font-bold leading-snug text-white">
          One system, five roles, one source of truth.
        </h1>
      </div>

      <div className="si-navy hidden flex-1 flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-white font-extrabold text-xl leading-none">SI</div>
            <div className="text-[10px] text-[#9FB6E0] tracking-wide mt-0.5">SERVICE INSIDE</div>
          </div>
        </div>
        <div className="rise-slow max-w-md">
          <h1 className="text-white text-2xl font-bold leading-snug mb-3.5">
            One system, five roles, one source of truth.
          </h1>
          <p className="text-[#B9C9E8] text-[15px] leading-relaxed">
            Requester, Technician, Supervisor, Maintenance Manager, Administrator — each signs in
            once and lands exactly where their work is.
          </p>
        </div>
        <div className="font-mono text-[#5B76AE] text-[12px]">Authentication Module · v1.0</div>
      </div>

      <div className="-mt-6 flex flex-1 items-start justify-center rounded-t-[20px] bg-canvas px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 lg:mt-0 lg:items-center lg:rounded-none lg:p-6">
        {/* max-w-sm is right on a phone and mean on a tablet, where the
            stacked layout now runs up to 1024px — 24rem of form in a 768px
            window looked like a phone screenshot pasted onto an iPad. */}
        <div className="rise w-full max-w-sm sm:max-w-md">
          <h2 className="text-xl font-bold text-ink mb-1.5">Sign in</h2>
          <p className="text-[13.5px] text-ink-soft mb-5">
            {COMPANY_EMAIL_DOMAIN
              ? `Use your @${COMPANY_EMAIL_DOMAIN} email address, or your employee ID.`
              : "Use your company email address, or your employee ID."}
          </p>
          {/**
            * Why they are looking at this screen.
            *
            * Without it, being thrown to a sign-in form mid-job reads as the
            * app having lost their work — which is the thing that makes people
            * stop trusting it and start keeping a paper pad. The second
            * sentence is conditional on drafts having ACTUALLY been saved,
            * because a promise of restored work that turns out to be an empty
            * form is worse than no promise. `expired` is only set when the
            * ticket exists, so this cannot appear on an ordinary sign-in.
            */}
          {expired && !error && (
            <div className="mb-4 rounded border border-[#F59E0B55] bg-[#FEF3C7] px-4 py-3 text-[13px] text-[#78350F]">
              Your session ended, so you’ll need to sign in again.
              {expired.drafts > 0
                ? " Sign in as the same person and you’ll go straight back to what you were doing, with what you had typed still there."
                : " You’ll be taken back to the page you were on."}
            </div>
          )}
          {error && <ErrorBanner message={error} />}
          <form onSubmit={handleSubmit}>
            <Field label="Company email or employee ID" required>
              {/* No placeholder on either field. The label already says what
                  goes in it, and a greyed sample address is routinely misread as
                  a filled-in value — people tab past it and submit an empty
                  form. The password field's row of bullets was worse: it is
                  indistinguishable from a typed password. */}
              {/* type="text", not "email": the browser's own validation rejects
                  a bare employee number before any of this code runs. */}
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputClass}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </Field>
            <Field label="Password" required>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>

            <div className="flex items-center justify-between mb-5">
              <label className="flex items-center gap-2 text-[13px] text-ink-soft cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="accent-amber"
                />
                Remember me
              </label>
              <Link href="/forgot-password" className="text-[13px] text-ink-soft underline">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={status !== "idle"}
              className="w-full py-3 rounded bg-ink text-white font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {status === "checking" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign in <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>
          <p className="text-[12px] text-ink-soft text-center mt-6 flex items-center justify-center gap-1.5">
            <ShieldCheck size={13} /> Your role and access are set by your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
