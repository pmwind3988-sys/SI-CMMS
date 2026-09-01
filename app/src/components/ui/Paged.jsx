"use client";

/**
 * SI — Service Inside · List pagination
 *
 * Two rules, and the second is the one that is easy to get backwards.
 *
 * 1. The page count must never be keyed on the row array's IDENTITY. Every long
 *    list here is fed by `liveQuery`, which re-runs its query and hands back a
 *    brand new array on any relevant postgres_changes event rather than patching
 *    a cache. Reset on identity and someone reading the fourth page of the work
 *    order list is thrown back to the first the moment anyone, anywhere, accepts
 *    a job. It resets on `resetKey` — built from the filter controls — and on
 *    nothing else.
 *
 * 2. FILTER FIRST, SLICE SECOND. Every caller passes rows that are already
 *    searched and filtered, so a search reaches every row the screen has loaded
 *    and pagination then applies to the matches. Slicing before searching would
 *    make the search box mean "find it among the 25 rows currently on screen",
 *    which is a search that cannot find anything you could not already see. The
 *    search term belongs in `resetKey` so a new search starts at its first page.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import Button from "./Button";

export const PAGE_SIZE = 25;

export function usePaged(rows, { pageSize = PAGE_SIZE, resetKey = "" } = {}) {
  const [shown, setShown] = useState(pageSize);

  useEffect(() => {
    setShown(pageSize);
  }, [resetKey, pageSize]);

  const all = rows ?? [];
  const total = all.length;
  const limit = Math.min(shown, total);
  const visible = useMemo(() => (limit >= total ? all : all.slice(0, limit)), [all, limit, total]);

  return {
    visible,
    shown: limit,
    total,
    pageSize,
    hasMore: limit < total,
    showMore: () => setShown((n) => n + pageSize),
    showEverything: () => setShown(Number.MAX_SAFE_INTEGER),
  };
}

/**
 * The strip under a paged list. Renders nothing once everything is on screen —
 * a footer reading "showing all 9 of 9" is a control with nothing to control.
 *
 * `standalone` is for the two screens that render a desktop table and a mobile
 * card stack from the same slice: one footer sits below both rather than being
 * duplicated inside each, so it needs its own border instead of joining one.
 */
export function PagerFooter({ pager, noun = "rows", standalone = false, className = "" }) {
  if (!pager.hasMore) return null;
  const remaining = pager.total - pager.shown;
  const next = Math.min(pager.pageSize, remaining);
  return (
    <div
      className={`flex flex-col items-center gap-2 bg-canvas px-4 py-3 text-center sm:flex-row sm:justify-between sm:text-left ${
        standalone ? "mt-2 rounded border border-border" : "border-t border-[#F1F3F5]"
      } ${className}`}
    >
      <span className="text-[12.5px] text-ink-soft">
        Showing {pager.shown} of {pager.total} {noun}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" icon={ChevronDown} onClick={pager.showMore}>
          Show {next} more
        </Button>
        <Button variant="subtle" size="sm" onClick={pager.showEverything}>
          Show all {pager.total}
        </Button>
      </div>
    </div>
  );
}
