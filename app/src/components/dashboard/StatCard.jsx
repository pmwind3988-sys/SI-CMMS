"use client";

import { ChevronRight } from "lucide-react";

/**
 * A stat card. Pass `onClick` and it becomes the button that opens the rows
 * behind the number — a figure with no way to ask "which ones?" is the one
 * complaint every dashboard in this module attracted.
 *
 * Still renders as a plain div when there is nothing to drill into, so a card
 * never advertises an affordance it does not have.
 */
export default function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  color = "#0F3D91",
  loading,
  onClick,
  emphasis = false,
}) {
  const interactive = typeof onClick === "function";

  const body = (
    <>
      <div className="flex items-start justify-between gap-1.5 mb-2">
        <span className="text-[11.5px] font-semibold text-ink-soft text-left">{label}</span>
        {Icon && <Icon size={15} className="flex-shrink-0 mt-px" style={{ color }} />}
      </div>
      {loading ? (
        <div className="h-7 w-16 bg-canvas rounded animate-pulse" />
      ) : (
        <div className="flex items-baseline justify-between gap-1">
          <span className="flex items-baseline gap-1">
            <span className="font-mono text-[21px] sm:text-[24px] font-bold text-ink">{value}</span>
            {unit && <span className="text-[12px] text-ink-soft">{unit}</span>}
          </span>
          {interactive && (
            <ChevronRight
              size={15}
              className="flex-shrink-0 self-center text-ink-soft transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          )}
        </div>
      )}
    </>
  );

  const base = `rounded-xl border p-3 sm:p-4 shadow-card ${
    emphasis ? "border-[#F59E0B77] bg-[#FFFBEB]" : "border-border bg-white"
  }`;

  if (!interactive) return <div className={base}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      // The label already names the figure; the count is read out by the value.
      aria-label={`${label}: ${loading ? "loading" : value}${unit ? ` ${unit}` : ""}. Show the records behind this.`}
      className={`${base} group w-full text-left transition-colors hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-navy`}
    >
      {body}
    </button>
  );
}
