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
      {/* `break-words`: the longest label ("Total Open Work Orders") is wider
          than a 150px card on a 360px phone, and without it the label decided
          the card's width instead of the grid doing it. */}
      <div className="mb-2 flex items-start justify-between gap-1.5">
        <span className="min-w-0 break-words text-left text-[11px] font-semibold leading-[1.35] text-ink-soft sm:text-[11.5px]">
          {label}
        </span>
        {Icon && <Icon size={15} className="mt-px flex-shrink-0" style={{ color }} />}
      </div>
      {/* `mt-auto` is the whole point of the flex column: labels wrap to one,
          two or three lines depending on the width, and without it the numbers
          in a row of cards sat at three different heights — the cards stretch
          to a common height but their contents used to start from the top. */}
      {loading ? (
        <div className="mt-auto h-7 w-16 animate-pulse rounded bg-canvas" />
      ) : (
        <div className="mt-auto flex items-baseline justify-between gap-1">
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="font-mono text-[21px] font-bold leading-none text-ink sm:text-[24px]">{value}</span>
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

  const base = `flex flex-col rounded-xl border p-3 sm:p-4 shadow-card ${
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
