"use client";

import { CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

export function Card({ children, className = "", ...rest }) {
  return (
    <div className={`bg-white rounded border border-border shadow-card ${className}`} {...rest}>
      {children}
    </div>
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
