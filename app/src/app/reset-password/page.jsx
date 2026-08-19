"use client";

/**
 * SI — Service Inside · Authentication Module
 * Set a new password, reached from the link in a password-recovery email.
 *
 * Firebase hosted this screen itself; Supabase does not — it sends the user back
 * to the app, which is why this page has to exist. The redirect target is set in
 * AuthContext.resetPassword (`${origin}/reset-password/`) and must also be listed
 * under Authentication → URL Configuration → Redirect URLs, or Supabase refuses
 * the redirect before the user ever gets here.
 *
 * How the session arrives — three shapes, because which one Supabase sends is
 * decided by project configuration this page does not control, and getting only
 * one of them right is why "the reset link doesn't work" is such a common
 * report:
 *
 *   1. Fragment (#access_token=…&type=recovery). The implicit flow, which is
 *      supabase-js's default and what this client uses. `detectSessionInUrl` in
 *      lib/supabase.js consumes the fragment, establishes a session and emits
 *      PASSWORD_RECOVERY. That happens asynchronously and may complete before
 *      this component mounts, so waiting only for the event would race —
 *      getSession() is checked as well, and either is enough.
 *
 *   2. Query ?token_hash=…&type=recovery. What the current default email
 *      template produces once a project moves to the /auth/v1/verify endpoint.
 *      Nothing consumes it automatically; verifyOtp() has to be called.
 *
 *   3. Query ?code=…. The PKCE flow. exchangeCodeForSession() redeems it.
 *
 *   A failed link (expired, already used, tampered with) comes back as
 *   error=…&error_description=… in whichever of the two the project uses. The
 *   fragment is read on the very first render, because detectSessionInUrl strips
 *   it once it has looked at it.
 *
 * Deliberately NOT wrapped in RequireAuth: the visitor is mid-recovery and has no
 * ordinary session, and RequireAuth would bounce them to /login and discard the
 * tokens in the fragment.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { describeError } from "../../lib/errors";
import Field from "../../components/ui/Field";
import PasswordInput from "../../components/ui/PasswordInput";
import { ErrorBanner } from "../../components/ui/Surfaces";

const MIN_LENGTH = 8;

/**
 * The fragment is captured at module-evaluation time, not in the component.
 * detectSessionInUrl strips it as soon as it has read it, and that work starts
 * when lib/supabase.js is imported — earlier than the first render. Reading it
 * here, during import, is the only point that reliably still sees it.
 */
const INITIAL_HASH =
  typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
const INITIAL_QUERY =
  typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");

const HASH_PARAMS = new URLSearchParams(INITIAL_HASH);
const QUERY_PARAMS = new URLSearchParams(INITIAL_QUERY);

/**
 * Which of the three link shapes this is, if any.
 *
 * Deliberately not "a session exists": this page is reached from an emailed
 * link, so an ordinary signed-in session must NOT unlock it. Otherwise anyone
 * with access to an unattended browser could set a new password without
 * knowing the current one, which is a real privilege escalation on a shared
 * shop-floor terminal.
 */
const RECOVERY = (() => {
  if (/(^|&)type=recovery(&|$)/.test(INITIAL_HASH)) return { kind: "fragment" };
  const tokenHash = QUERY_PARAMS.get("token_hash");
  if (tokenHash && QUERY_PARAMS.get("type") === "recovery") {
    return { kind: "token_hash", tokenHash };
  }
  const code = QUERY_PARAMS.get("code");
  if (code) return { kind: "code", code };
  return null;
})();

/** Read the error the recovery redirect may have left, in either carrier. */
function readLinkError() {
  const params = HASH_PARAMS.get("error") || HASH_PARAMS.get("error_code") ? HASH_PARAMS : QUERY_PARAMS;
  if (!params.get("error") && !params.get("error_code")) return null;
  const code = params.get("error_code") || params.get("error");
  const description = params.get("error_description");
  if (code === "otp_expired" || /expired/i.test(description || "")) {
    return "That reset link has expired. Request a new one and use it within the hour.";
  }
  if (description) return description.replace(/\+/g, " ");
  return "That reset link is not valid. Request a new one.";
}

export default function ResetPasswordPage() {
  const router = useRouter();

  // Lazy initialiser: this must run before detectSessionInUrl clears the hash.
  const [linkError, setLinkError] = useState(readLinkError);

  const [phase, setPhase] = useState("checking"); // checking | ready | saving | done | invalid
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (linkError) {
      setPhase("invalid");
      return;
    }

    let settled = false;
    const ready = () => {
      if (settled) return;
      settled = true;
      setPhase("ready");
    };

    const reject = () => {
      if (settled) return;
      settled = true;
      setPhase("invalid");
      setLinkError(
        "This page needs a valid password reset link. Request a new one from the sign-in screen."
      );
    };

    // Nothing recovery-shaped in the URL at all — someone navigated here
    // directly, or is already signed in. Either way this is not a recovery, so
    // stop now rather than offering a password change we haven't authenticated.
    if (!RECOVERY) {
      reject();
      return;
    }

    const fail = (message) => {
      if (settled) return;
      settled = true;
      setPhase("invalid");
      setLinkError(message);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") ready();
    });

    if (RECOVERY.kind === "fragment") {
      // Covers the case where the fragment was consumed before this mounted:
      // the token was present (checked above), so an existing session here is
      // the recovery session.
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) ready();
      });
    } else if (RECOVERY.kind === "token_hash") {
      supabase.auth
        .verifyOtp({ token_hash: RECOVERY.tokenHash, type: "recovery" })
        .then(({ error }) => {
          if (error) {
            fail(
              /expired|invalid/i.test(error.message)
                ? "That reset link has expired or has already been used. Request a new one."
                : error.message
            );
          } else {
            ready();
          }
        });
    } else {
      supabase.auth.exchangeCodeForSession(RECOVERY.code).then(({ error }) => {
        if (error) {
          fail(
            /expired|invalid/i.test(error.message)
              ? "That reset link has expired or has already been used. Request a new one."
              : error.message
          );
        } else {
          ready();
        }
      });
    }

    // The token was in the URL but Supabase never established a session from it.
    const timer = setTimeout(reject, 8000);

    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [linkError]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setPhase("saving");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      // Sign the recovery session out so the next step is a normal sign-in with
      // the new password — this also guarantees the next token is minted fresh
      // through the access-token hook.
      await supabase.auth.signOut();
      setPhase("done");
      setTimeout(() => router.replace("/login"), 2500);
    } catch (e) {
      setPhase("ready");
      setError(describeError(e, "Couldn't set that password — try again."));
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-canvas font-sans px-5 py-8 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-6">
      <div className="rise w-full max-w-sm">
        <Link href="/login" className="flex items-center gap-1.5 text-ink-soft text-[13px] mb-5">
          <ArrowLeft size={15} /> Back to sign in
        </Link>

        {phase === "checking" && (
          <div className="bg-white border border-border rounded p-6 text-center">
            <Loader2 size={24} className="animate-spin text-ink-soft mx-auto mb-3" />
            <p className="text-[13.5px] text-ink-soft">Checking your reset link…</p>
          </div>
        )}

        {phase === "invalid" && (
          <div className="bg-white border border-border rounded p-6 text-center">
            <AlertTriangle size={28} className="text-danger mx-auto mb-3" />
            <h2 className="text-lg font-bold text-ink mb-1.5">Link not valid</h2>
            <p className="text-[13.5px] text-ink-soft leading-relaxed mb-4">{linkError}</p>
            <Link
              href="/forgot-password"
              className="inline-block py-2.5 px-4 rounded bg-ink text-white font-semibold text-[13.5px]"
            >
              Request a new link
            </Link>
          </div>
        )}

        {phase === "done" && (
          <div className="bg-white border border-border rounded p-6 text-center">
            <CheckCircle2 size={28} className="text-good mx-auto mb-3" />
            <h2 className="text-lg font-bold text-ink mb-1.5">Password updated</h2>
            <p className="text-[13.5px] text-ink-soft leading-relaxed">
              Sign in with your new password. Taking you to the sign-in screen…
            </p>
          </div>
        )}

        {(phase === "ready" || phase === "saving") && (
          <>
            <h2 className="text-xl font-bold text-ink mb-1.5">Set a new password</h2>
            <p className="text-[13.5px] text-ink-soft mb-5">
              Choose something you haven't used here before — at least {MIN_LENGTH} characters.
            </p>
            {error && <ErrorBanner message={error} />}
            <form onSubmit={handleSubmit}>
              <Field label="New password" required>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Field label="Confirm new password" required>
                <PasswordInput
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </Field>
              <button
                type="submit"
                disabled={phase === "saving"}
                className="w-full py-3 rounded bg-ink text-white font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {phase === "saving" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={15} /> Update password
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
