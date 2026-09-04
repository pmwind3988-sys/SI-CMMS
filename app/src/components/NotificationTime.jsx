"use client";

import { Clock3 } from "lucide-react";
import { fmtRelative, fmtDateTimeMY, fmtTimeMY } from "../lib/datetime";

/** Where fmtRelative stops being relative and starts returning a date. */
const RELATIVE_LIMIT_MS = 7 * 86400000;

/**
 * When a notification arrived — the one field on the row that was hardest to
 * read and the one most often being looked for.
 *
 * It used to be 10.5px muted grey mono, quieter than the body text, in two
 * different formats: "5m ago" in the bell and an absolute time on the page,
 * both of which disagreed about the timezone.
 *
 * TWO READINGS, DELIBERATELY, because they answer different questions and
 * neither replaces the other. "14m ago" is what tells you whether this is
 * still happening; "04/09/2026, 2:30 PM" is what you quote to somebody, match
 * against a shift, or line up with the work order's own timeline. The relative
 * one leads because it is what a glance is for; the absolute one sits beside
 * it rather than in a tooltip, because a tooltip does not exist on a phone.
 *
 * BOTH ARE KUALA LUMPUR TIME. The page previously used
 * `toLocaleString(undefined, …)` — the device's locale and zone — so the same
 * notification read 2:30 PM on a plant laptop and 6:30 AM on a phone left on
 * UK time, with nothing on screen admitting it. The plant is in Malaysia;
 * plant time is the only correct answer. Same argument lib/datetime.js's
 * header makes, and one of the five call sites CLAUDE.md lists as still wrong.
 *
 * `compact` is the bell, where the row is narrower and the panel is a preview:
 * same two readings, stacked tighter.
 */
export default function NotificationTime({ ts, unread = false, compact = false }) {
  if (!ts) return null;
  const rel = fmtRelative(ts);
  /* Past a week fmtRelative IS the date, so the second reading drops to the
     time alone — otherwise the row prints "12/08/2026  12/08/2026 3:43 PM",
     which is the redundancy two readings were meant to avoid. */
  const aged = Date.now() - Date.parse(ts) >= RELATIVE_LIMIT_MS;
  const abs = aged ? fmtTimeMY(ts) : fmtDateTimeMY(ts);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-[2px] whitespace-nowrap ${
        unread ? "bg-navy/[0.07]" : "bg-slate-100"
      }`}
    >
      <Clock3 size={compact ? 10 : 11} className={unread ? "text-navy" : "text-ink-soft"} />
      <span className={`font-semibold ${compact ? "text-[10.5px]" : "text-[11.5px]"} ${unread ? "text-navy" : "text-ink"}`}>
        {rel}
      </span>
      {/* Hidden from screen readers on the compact row only: the bell already
          reads the relative time, and hearing both on every one of thirty rows
          is noise. The full page keeps both, since that is where somebody goes
          to find a specific one. */}
      <span
        className={`${compact ? "text-[10px]" : "text-[11px]"} text-ink-soft`}
        aria-hidden={compact ? "true" : undefined}
      >
        {abs}
      </span>
    </span>
  );
}
