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

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    try {
      await resetPassword(email);
    } catch (e) {
      // Only a malformed email is surfaced — "user not found" is treated
      // identically to success, for the enumeration reason noted above.
      if (e.code === "auth/invalid-email") {
        setStatus("idle");
        setError("That doesn't look like a valid email address.");
        return;
      }
    }
    setStatus("sent");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas font-sans p-6">
      <div className="w-full max-w-sm">
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
                  placeholder="you@company.com"
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
