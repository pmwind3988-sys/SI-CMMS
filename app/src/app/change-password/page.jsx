"use client";

/**
 * SI — Service Inside · Authentication Module
 *
 * Change your own password. Two audiences, one form:
 *
 *   - an account whose password was issued by somebody else
 *     (users.must_change_password), which is sent here and can reach nothing
 *     else until it obliges;
 *   - anyone who simply wants to change their password.
 *
 * IT MUST NOT SIT BEHIND RequireRole. A flagged account is issued a token with
 * no role claims at all (migration 0026), so every role gate rejects it —
 * including a gate on the one page it has to reach, which would lock it out of
 * the only action available to it. A signed-in check is the whole requirement.
 *
 * Its own profile still reads: users_select permits `id = auth.uid()`
 * independently of any role, so the name and address render normally. Measured:
 * on a roleless token, `users` returns exactly one row — its own.
 *
 * The redirect here is a courtesy, not the enforcement. The enforcement is that
 * the token carries no roles, so the rest of the app is empty regardless.
 * Getting past the redirect gains nothing — before this page existed, a flagged
 * account landed on /work-orders/ and saw "0 of 0 work orders" with no
 * explanation anywhere. That is what this replaces.
 *
 * Not /reset-password. That page is reached from an emailed link and refuses to
 * unlock on an ordinary signed-in session, deliberately — otherwise an
 * unattended browser is a password change. This page is the opposite case: it
 * requires a session and nothing else.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, KeyRound, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { dashboardPathForRole, highestRole } from "../../lib/roles";
import { describeError } from "../../lib/errors";
import RequireAuth from "../../components/RequireAuth";
import Field, { inputClass } from "../../components/ui/Field";
import { ErrorBanner } from "../../components/ui/Surfaces";
import Button from "../../components/ui/Button";

const MIN_LENGTH = 8;

/** The claims of a session token. Same decode as AuthContext's. */
function claimsOf(session) {
  const token = session?.access_token;
  if (!token) return {};
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

function ChangePasswordForm() {
  const { user } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const forced = user?.mustChangePassword === true;

  async function submit(e) {
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
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      /**
       * si_sync_auth_user_activity has just cleared must_change_password, but the
       * token in hand was minted before that write — claims only change when a
       * token is issued. refreshSession mints one now, so the roles come back
       * immediately rather than at the next hourly refresh, and
       * onAuthStateChange hands AuthContext the new claims on the way past.
       */
      const { data: fresh, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      const claims = claimsOf(fresh?.session);
      const roles = claims.user_roles ?? (claims.user_role ? [claims.user_role] : []);
      const landing = highestRole(roles);

      if (!landing) {
        /**
         * The password changed but the roles did not come back. The flag is not
         * the only thing that withholds them — an inactive account is denied by
         * the same branch of the hook — so say what is actually true rather than
         * bouncing to a dashboard that would be empty.
         */
        setBusy(false);
        setError(
          "Your password was changed, but this account still has no access. " +
            "It may have been deactivated — contact your administrator.",
        );
        return;
      }
      router.replace(dashboardPathForRole(landing));
    } catch (e) {
      setError(describeError(e, "Couldn't change your password."));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-ink">
        <KeyRound size={18} /> Change your password
      </h1>
      <p className="mb-5 text-[13px] text-ink-soft">
        {forced
          ? "This password was set for you by an administrator. Choose your own before you can use the rest of the app."
          : "Choose a new password for your account."}
      </p>

      {error && <ErrorBanner message={error} />}

      <form onSubmit={submit}>
        <Field label="New password" required>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} pr-10`}
              autoComplete="new-password"
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
        <Field label="Confirm new password" required>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            required
          />
        </Field>
        <p className="mb-4 text-[12px] text-ink-soft">
          At least {MIN_LENGTH} characters. Nobody else can see it, your administrator included —
          if you forget it, it has to be reset.
        </p>
        <Button type="submit" icon={busy ? Loader2 : Check} disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <RequireAuth>
      <ChangePasswordForm />
    </RequireAuth>
  );
}
