"use client";

/**
 * SI — Service Inside · A password box with a reveal toggle.
 *
 * Every password field in the app should have the eye. Typing a password you
 * cannot see, twice, on a phone, in a workshop, is how people end up locked out
 * of an account somebody else then has to reset — and on this schema only the
 * Superuser can do that resetting, so a typo is expensive.
 *
 * Extracted rather than copied a sixth time: the sign-in screen, the recovery
 * screen and /change-password each had their own `showPw` state and their own
 * copy of the button. Three copies is where they start to drift.
 *
 * The toggle is deliberately per-field rather than one control for a whole form.
 * "New" and "Confirm" are usually checked one at a time, and a single switch
 * revealing both at once shows more than was asked for.
 */
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { inputClass } from "./Field";

export default function PasswordInput({
  value,
  onChange,
  autoComplete = "new-password",
  required = false,
  className = "",
  ...props
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        className={`${inputClass} pr-10 ${className}`}
        autoComplete={autoComplete}
        required={required}
        {...props}
      />
      {/* type="button" is load-bearing: inside a form a button without it
          submits, so tapping the eye would try to sign you in. */}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        /* The eye glyph stays 17px and stays where it was drawn; the button
           around it becomes a 44px square. It was a 17x17 target — under even
           the 24px floor — on a control that exists precisely for people who
           are struggling to type the field correctly. */
        className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-ink-soft"
        // The label says what the button will DO, not what the state is — a
        // screen reader announcing "hide password" on a hidden field is the
        // usual way to get this backwards.
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}
