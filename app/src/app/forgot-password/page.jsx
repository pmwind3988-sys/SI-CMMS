"use client";

/**
 * SI — Service Inside · Authentication Module
 * Forgot Password. Deliberately shows the same success state whether or
 * not the email actually exists in the system — confirming/denying an
 * email's existence to an unauthenticated visitor is an account
 * enumeration risk, not a helpful error message.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import Field, { inputClass } from "../../components/ui/Field";
import { ErrorBanner } from "../../components/ui/Surfaces";

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState(null);

  /**
   * Which failures are safe to show.
   *
   * "This address has no account" is not, and never appears here — that is the
   * enumeration risk the whole screen is shaped around, and Supabase does not
   * report it for this endpoint anyway.
   *
   * Everything else is. Swallowing them all was the more dangerous default: an
   * unconfigured SMTP sender, a rate limit, an unreachable project and a
   * perfectly delivered email were reported identically as "check your inbox",
   * so the one failure this screen exists to prevent — a user waiting for a mail
   * that is never coming — looked exactly like success. None of these say
   * anything about whether the account exists.
   */
  function surfacableError(e) {
    if (e?.code === "validation_failed" || e?.status === 422) {
      return "That doesn't look like a valid email address.";
    }
    if (e?.name === "AuthRetryableFetchError") {
      return "Can't reach the authentication server. Check your connection and try again.";
    }
    if (e?.code === "over_email_send_rate_limit" || e?.status === 429) {
      return "Too many reset requests. Wait a few minutes and try again.";
    }
    // A 500 from this endpoint is almost always the project's email sender:
    // Supabase's built-in SMTP is rate-limited to a handful of messages an hour
    // and is disabled outright on some projects.
    if (e?.status >= 500 || /sending.*email/i.test(e?.message || "")) {
      return (
        "The server couldn't send the email. This is a configuration problem, not a " +
        "problem with your address — tell your administrator to check the project's " +
        "SMTP settings."
      );
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    try {
      await resetPassword(email);
    } catch (e) {
      const message = surfacableError(e);
      if (message) {
        setStatus("idle");
        setError(message);
        return;
      }
      // Anything unrecognised is treated as success, deliberately: an
      // unfamiliar error is more likely to leak whether the account exists than
      // to be useful.
    }
    setStatus("sent");
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-canvas font-sans px-5 py-8 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] sm:p-6">
      <div className="rise w-full max-w-sm">
        <Link href="/login" className="flex items-center gap-1.5 text-ink-soft text-[13px] mb-5">
          <ArrowLeft size={15} /> Back to sign in
        </Link>

        {status === "sent" ? (
          <div className="bg-white border border-border rounded p-6 text-center">
            <CheckCircle2 size={28} className="text-good mx-auto mb-3" />
            <h2 className="text-lg font-bold text-ink mb-1.5">Check your email</h2>
            <p className="text-[13.5px] text-ink-soft leading-relaxed">
              If an account exists for <strong>{email}</strong>, a password reset link is on its way.
              It may take a few minutes to arrive.
            </p>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-ink mb-1.5">Reset your password</h2>
            <p className="text-[13.5px] text-ink-soft mb-5">
              Enter your company email and we'll send you a link to reset your password.
            </p>
            {error && <ErrorBanner message={error} />}
            <form onSubmit={handleSubmit}>
              <Field label="Company email" required>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  autoComplete="username"
                  required
                />
              </Field>
              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full py-3 rounded bg-ink text-white font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {status === "sending" ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send size={15} /> Send reset link
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
