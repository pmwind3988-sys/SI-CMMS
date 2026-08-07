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
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded bg-navy text-white px-4 py-3 text-[13px] shadow-lg">
      <CheckCircle2 size={15} className="text-accent" />
      {message}
    </div>
  );
}

/** Consistent inline error state — used identically across every screen per the UI/UX spec. */
export function ErrorBanner({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded bg-[#FCE9E9] border border-[#EF444455] px-4 py-3 text-[13px] text-danger mb-4">
      <span className="flex items-center gap-2">
        <AlertTriangle size={15} /> {message}
      </span>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1 font-semibold text-danger hover:underline">
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="text-center text-ink-soft text-[13px] py-10">{children}</div>;
}
