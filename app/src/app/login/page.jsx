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
import { Eye, EyeOff, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { rememberedEmail, wasRememberMeChecked } from "../../lib/supabase";
import { dashboardPathForRole } from "../../lib/roles";
import Field, { inputClass } from "../../components/ui/Field";
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

function isCompanyEmail(email) {
  if (!COMPANY_EMAIL_DOMAIN) return true; // no domain configured -> don't block
  return email.toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN.toLowerCase()}`);
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);

  /**
   * Read in an effect rather than as a useState initialiser. This page is part
   * of a static export, so its HTML is generated at build time with an empty
   * field; seeding the initial state from localStorage would make the first
   * client render disagree with that HTML, and React discards the whole tree
   * on a hydration mismatch.
   */
  useEffect(() => {
    setRememberMe(wasRememberMeChecked());
    const saved = rememberedEmail();
    if (saved) setEmail(saved);
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
        return "Couldn't sign in — check your email and password and try again.";
      case "over_request_rate_limit":
        return "Too many attempts. Wait a few minutes and try again.";
      default:
        break;
    }
    if (e?.status === 429) return "Too many attempts. Wait a few minutes and try again.";
    if (e?.status === 400 || e?.status === 422) {
      return "Couldn't sign in — check your email and password and try again.";
    }
    return e?.message || "Couldn't sign in — please try again.";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!isCompanyEmail(email)) {
      setError(`Please sign in with your company email address (@${COMPANY_EMAIL_DOMAIN}).`);
      return;
    }

    setStatus("checking");
    try {
      const { role, mustChangePassword } = await signIn(email, password, rememberMe);

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
      router.replace(dashboardPathForRole(role));
    } catch (e) {
      setStatus("idle");
      setError(friendlyError(e));
    }
  }

  return (
    // min-h-dvh, not min-h-screen: 100vh on a mobile browser is the height with
    // the URL bar hidden, so the sign-in card sat partly below the fold and the
    // page scrolled for no reason.
    <div className="min-h-dvh flex flex-col md:flex-row bg-navy font-sans">
      {/* The navy panel, on a phone.
          Below `md` the branded half was simply hidden and the screen was a
          plain grey field with a form on it — the one place in the app with no
          brand surface at all. This is the same gradient, reduced to a band
          across the top, with the sign-in card overlapping its bottom edge so
          the two read as one object rather than two stacked blocks. */}
      <div className="si-navy px-6 pb-11 pt-[calc(2.5rem+env(safe-area-inset-top))] md:hidden">
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

      <div className="si-navy hidden flex-1 flex-col justify-between p-12 md:flex">
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

      <div className="-mt-6 flex flex-1 items-start justify-center rounded-t-[20px] bg-canvas px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 md:mt-0 md:items-center md:rounded-none md:p-6">
        <div className="rise w-full max-w-sm">
          <h2 className="text-xl font-bold text-ink mb-1.5">Sign in</h2>
          <p className="text-[13.5px] text-ink-soft mb-5">
            {COMPANY_EMAIL_DOMAIN
              ? `Use your @${COMPANY_EMAIL_DOMAIN} company email address.`
              : "Use your company email address."}
          </p>
          {error && <ErrorBanner message={error} />}
          <form onSubmit={handleSubmit}>
            <Field label="Company email" required>
              {/* No placeholder on either field. The label already says what
                  goes in it, and a greyed sample address is routinely misread as
                  a filled-in value — people tab past it and submit an empty
                  form. The password field's row of bullets was worse: it is
                  indistinguishable from a typed password. */}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Password" required>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClass} pr-10`}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-3 top-2.5 text-ink-soft"
                  aria-label="Toggle password visibility"
                >
                  {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
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
