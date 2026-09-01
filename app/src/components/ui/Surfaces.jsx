"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2, WifiOff } from "lucide-react";

export function Card({ children, className = "", ...rest }) {
  return (
    <div className={`bg-white rounded border border-border shadow-card ${className}`} {...rest}>
      {children}
    </div>
  );
}

/**
 * A full-viewport modal backdrop, rendered into `<body>` instead of in place.
 *
 * `position: fixed` resolves against the nearest transformed ancestor, and
 * `<main>` in AppShell carries `.rise`, whose `animation-fill-mode: both`
 * leaves `transform: translateY(0)` on it permanently. Inside that box
 * `inset-0` is the *page*, not the screen: on desktop the dialog centred
 * against the whole scroll height and hung off the bottom of the window, and
 * on a phone — where the panel aligns to the end — it landed below the fold
 * entirely, leaving a dimmed screen with no visible dialog. Portalling out is
 * the only fix that does not depend on every future ancestor staying
 * transform-free.
 *
 * The tree is prerendered by the static export, so the portal waits for mount.
 */
export function ModalOverlay({ children, onClose, label, className = "" }) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef(null);
  useEffect(() => setMounted(true), []);

  /**
   * Announced, dismissable and focused — it was none of the three.
   *
   * The overlay covered the page and locked its scroll, so to a sighted user it
   * was unmistakably a dialog. To a screen reader it was an anonymous div:
   * measured on the dashboard drill-down, no `role`, no `aria-modal`, no
   * accessible name, and focus left behind on the card that opened it — so the
   * announcement for opening it was silence.
   *
   * Escape is handled here rather than at each call site, because "the drill-down
   * closes on Escape but the delete dialog does not" is precisely the kind of
   * inconsistency a shared component exists to prevent.
   */
  useEffect(() => {
    if (!mounted) return;
    const returnTo = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    /* Focus the panel itself rather than hunting for the first control: these
       dialogs open with text that has to be read before a button is pressed,
       and landing on "Delete" is how somebody presses it by reflex.

       The wrapper is `display: contents` so it does not disturb the flex
       centring, and an element with `display: contents` generates no box and
       cannot take focus — measured, the focus call was a silent no-op. So the
       focus goes to its first real child, which is the dialog's own panel. */
    const target = panelRef.current?.firstElementChild ?? panelRef.current;
    if (target instanceof HTMLElement) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus();
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus();
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6 ${className}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="contents"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Toast({ message }) {
  if (!message) return null;
  return (
    /* Pinned to the corner on desktop, but a full-width strip on a phone —
       at 320px a corner toast either wrapped to three lines or ran off the
       edge. The bottom offset clears Android's gesture pill. */
    <div className="fixed inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-50 flex items-center gap-2 rounded bg-navy px-4 py-3 text-[13px] text-white shadow-lg sm:inset-x-auto sm:right-6">
      <CheckCircle2 size={15} className="text-accent" aria-hidden="true" />
      {message}
    </div>
  );
}

/**
 * The strip that appears while a stale session is being renewed.
 *
 * Deliberately NOT a modal. The page underneath is still mounted and still
 * readable, and the whole design goal is that a recovery costs the user
 * nothing — dimming the screen would interrupt somebody who was only reading,
 * and hide the half-filled form they are worried about.
 *
 * `sticky top-0` rather than `fixed`: it takes part in the layout, so it pushes
 * the header down for the few seconds it exists instead of covering it. A fixed
 * strip sat on top of the work order title and read as a rendering fault.
 *
 * `role="status"` with aria-live polite — announced to a screen reader, but not
 * interrupting whatever it was already reading.
 */
export function SessionRecoveryBanner({ reason = "expired" }) {
  const offline = reason === "offline";
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 flex items-center justify-center gap-2 bg-[#FEF3C7] px-4 py-2 text-[12.5px] font-medium text-[#78350F] shadow-sm"
    >
      {offline ? (
        <WifiOff size={14} className="flex-shrink-0" />
      ) : (
        <Loader2 size={14} className="flex-shrink-0 animate-spin" />
      )}
      <span className="min-w-0">
        {offline
          ? "Can’t reach the server — retrying. Your work is safe."
          : "Session expired — signing you back in…"}
      </span>
    </div>
  );
}

/**
 * Consistent inline error state — used identically across every screen per the
 * UI/UX spec, which is exactly why the missing `role="alert"` mattered: this one
 * component is every error surface in the product, so until it was added there
 * were zero live regions on any screen. A screen reader user pressed Sign in,
 * or Save, and heard nothing at all — the banner rendered above the fields, out
 * of the reading position, with focus left on the button they had just pressed.
 *
 * `alert` rather than `status`: these are refusals and failures that interrupt
 * what the user was doing, and they are rendered in response to a deliberate
 * action, so interrupting the reader is the correct behaviour. The polite
 * `status` role stays on the session-recovery banner, which appears
 * unprompted and must not cut across whatever is being read.
 *
 * The text colour is darkened from the raw `--danger` token, which measured
 * 3.22:1 on this pale ground.
 */
export function ErrorBanner({ message, onRetry }) {
  return (
    // Wraps rather than squashing: these messages are full sentences, and on a
    // phone the Retry button was compressed to an unreadable sliver beside them.
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded border border-[#EF444455] bg-[#FCE9E9] px-4 py-3 text-[13px] text-[#A81E14]">
      <span className="flex min-w-0 items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /> <span className="min-w-0">{message}</span>
      </span>
      {onRetry && (
        <button onClick={onRetry} className="flex flex-shrink-0 items-center gap-1 font-semibold text-[#A81E14] hover:underline">
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="text-center text-ink-soft text-[13px] py-10">{children}</div>;
}
