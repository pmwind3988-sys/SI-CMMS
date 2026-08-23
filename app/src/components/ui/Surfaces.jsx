"use client";

import { useEffect, useState } from "react";
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
export function ModalOverlay({ children, onClose, className = "" }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6 ${className}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {children}
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
      <CheckCircle2 size={15} className="text-accent" />
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

/** Consistent inline error state — used identically across every screen per the UI/UX spec. */
export function ErrorBanner({ message, onRetry }) {
  return (
    // Wraps rather than squashing: these messages are full sentences, and on a
    // phone the Retry button was compressed to an unreadable sliver beside them.
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded border border-[#EF444455] bg-[#FCE9E9] px-4 py-3 text-[13px] text-danger">
      <span className="flex min-w-0 items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" /> <span className="min-w-0">{message}</span>
      </span>
      {onRetry && (
        <button onClick={onRetry} className="flex flex-shrink-0 items-center gap-1 font-semibold text-danger hover:underline">
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="text-center text-ink-soft text-[13px] py-10">{children}</div>;
}
