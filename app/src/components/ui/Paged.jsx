"use client";

/**
 * SI - Service Inside - List pagination
 *
 * Numbered pages: one page of rows at a time, with 1 2 3 4 controls underneath.
 * Deliberately NOT an accumulating "show more" - on a list of a few hundred that
 * turns reaching the end into one long scroll with no way back, and no way to
 * say where you are.
 *
 * Two rules, and the second is the one that is easy to get backwards.
 *
 * 1. The page must never be keyed on the row array's IDENTITY. Every long list
 *    here is fed by `liveQuery`, which re-runs its query and hands back a brand
 *    new array on any relevant postgres_changes event rather than patching a
 *    cache. Reset on identity and someone reading page 3 is thrown back to page
 *    1 the moment anyone, anywhere, accepts a job - and because these lists also
 *    rebuild their filtered array every render, the page controls stop working
 *    altogether. Measured, both. It resets on `resetKey` - built from the filter
 *    controls - and on nothing else.
 *
 * 2. FILTER FIRST, SLICE SECOND. Every caller passes rows that are already
 *    searched and filtered, so a search reaches every row the screen has loaded
 *    and the pages are then cut from the matches. Slicing first would make the
 *    search box mean "find it among the 25 rows currently on screen", which is a
 *    search that cannot find anything you could not already see. The search term
 *    belongs in `resetKey` so a new search starts at page 1.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE = 25;

/* The rendered height of PagerFooter, for the one moment it cannot be measured
   because it does not exist yet. Kept beside the component it describes. */
const FOOTER_HEIGHT = 56;

export function usePaged(rows, { pageSize = PAGE_SIZE, resetKey = "" } = {}) {
  const [wanted, setWanted] = useState(1);

  /* pageSize is deliberately NOT a dependency. It changes when the window is
     resized or a phone is rotated, and losing your place because you turned the
     device sideways is worse than landing on a page whose contents shifted. The
     clamp below handles a size that no longer reaches. */
  useEffect(() => {
    setWanted(1);
  }, [resetKey]);

  const all = rows ?? [];
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  /* Clamped on the way out rather than corrected in an effect. Rows disappear
     under you - a work order is closed out of the range, an account is deleted -
     and a page number past the end would otherwise render an empty list for one
     paint before an effect could fix it. */
  const page = Math.min(Math.max(1, wanted), pageCount);

  const start = (page - 1) * pageSize;
  const visible = useMemo(
    () => (total <= pageSize ? all : all.slice(start, start + pageSize)),
    [all, start, pageSize, total]
  );

  return {
    visible,
    page,
    pageCount,
    total,
    pageSize,
    // 1-based and inclusive, for "Showing 26-44 of 44".
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    hasPages: pageCount > 1,
    setPage: (n) => setWanted(Math.min(Math.max(1, n), pageCount)),
  };
}

/**
 * How many rows fit between the top of the list and the bottom of the screen.
 *
 * The point of numbered pages is that a page is a page: you see all of it, press
 * 2, and see all of that. A fixed 25 breaks that promise on every layout at
 * once - 25 table rows overflow a laptop, and 25 stacked cards overflow a phone
 * several times over. So the size is measured rather than chosen.
 *
 * Pass one ref per layout; the visible one is measured and the others ignored,
 * which is what makes the desktop table and the mobile card stack come out at
 * different sizes from the same call.
 *
 * Three things this gets right that the obvious version does not:
 *
 * - The list's DOCUMENT offset, not its viewport offset. `getBoundingClientRect`
 *   moves as you scroll, so measuring mid-page reports a list that starts above
 *   the fold and computes a page far taller than the screen.
 * - The TALLEST row plus the measured gap, not the average row. These lists are
 *   not uniform - a user row carrying demo-account flags is half again the
 *   height of one without - and an average-sized page overflows by exactly the
 *   rows that are taller than average.
 * - The nearest scrolling ancestor, not always the window. The dashboard
 *   drill-down is a sheet that scrolls inside itself and is shorter than the
 *   viewport it sits in.
 * - Everything BELOW the list is measured, not reserved for with a constant. The
 *   settings tables carry a retired block and a second pager under the live
 *   rows; the work order list carries nothing. `reserve` is breathing room now,
 *   not a stand-in for content nobody counted.
 *
 * It measures on mount, after the next paint, once more when the layout has
 * settled, on resize, and whenever `signature` changes (pass the row count, so
 * late-arriving data is re-measured) - never in response to its own result, so
 * there is no loop between "fewer rows" and "more room".
 */
export function useAutoPageSize(refs, { min = 3, max = PAGE_SIZE, reserve = 16, ready = true, signature = 0 } = {}) {
  const [size, setSize] = useState(max);
  const list = Array.isArray(refs) ? refs : [refs];

  const measure = useCallback(() => {
    const el = list.map((r) => r?.current).find((n) => n && n.offsetParent !== null && n.children.length);
    if (!el) return;

    const rows = [...el.children].filter((c) => c.getBoundingClientRect().height > 0);
    if (!rows.length) return;

    /* The TALLEST row plus the gap, not the average. These lists are not uniform:
       a user carrying three demo-account flags is half again the height of one
       that carries none, and an average sized page overflows by exactly the
       rows that are taller than average. Erring the other way leaves a row's
       worth of white space, which nobody notices. The gap is derived rather
       than assumed, since the card stacks are flex containers with one. */
    const heights = rows.map((r) => r.getBoundingClientRect().height);
    const span =
      rows[rows.length - 1].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top;
    const gap =
      rows.length > 1 ? Math.max(0, (span - heights.reduce((a, b) => a + b, 0)) / (rows.length - 1)) : 0;
    const pitch = Math.max(...heights) + gap;
    if (!(pitch > 0)) return;

    /* What is BELOW the list is measured, not guessed at. A reserve constant has
       to be re-tuned for every screen - the settings tables put a retired block
       and a second pager under the live rows, the work order list puts nothing -
       and a constant that is wrong by 90px is a page that still scrolls. The
       height of everything under the list does not depend on how many rows the
       list has, so this is stable to measure while the first guess is rendered. */
    const scroller = scrollParent(el);
    const rect = el.getBoundingClientRect();
    let available;
    if (scroller === window) {
      const top = rect.top + window.scrollY;
      const below = document.documentElement.scrollHeight - (rect.bottom + window.scrollY);
      available = window.innerHeight - top - below - reserve;
    } else {
      const box = scroller.getBoundingClientRect();
      const top = rect.top - box.top + scroller.scrollTop;
      const below = scroller.scrollHeight - (rect.bottom - box.top + scroller.scrollTop);
      available = scroller.clientHeight - top - below - reserve;
    }

    /* The pager footer is measured as part of "below" only if it is ALREADY
       there - and on the first pass it often is not, because the starting page
       size covers the whole list and PagerFooter renders nothing until there is
       more than one page. Left uncounted, every list short enough to fit at the
       starting size came out exactly one footer too tall: measured on Admin ->
       Users, 110px over. So its height is added when it is about to appear. */
    const footerAlready = hasPagerBelow(el);
    if (!footerAlready) available -= FOOTER_HEIGHT;

    const fits = Math.floor(available / pitch);
    setSize(Math.min(Math.max(fits, min), max));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [min, max, reserve]);

  /* Measured three times on the way in, and this is not belt-and-braces - it is
     the difference between right and wrong. The first pass runs the instant the
     rows exist, before the layout around them has settled: on Admin -> Users the
     demo-accounts banner had not yet taken its height, so the list looked to
     start 200px higher than it does and the page came out 5 rows where 3 fit.
     Measured, and confirmed by hand: one synthetic `resize` corrected 5 to 3 and
     the overflow to zero. So it re-measures after the next paint and once more
     when everything has certainly landed.

     These are timed passes, not reactive ones - nothing here re-runs in response
     to its own result, so a smaller page cannot feed back into a larger one. */
  useLayoutEffect(() => {
    if (!ready) return undefined;
    measure();
    const frame = requestAnimationFrame(measure);
    const settled = setTimeout(measure, 300);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [measure, ready, signature]);

  return size;
}

/**
 * "Showing 1-25 of 44" plus the page buttons.
 *
 * Renders nothing on a single page - a row of controls reading "1" is a control
 * with nothing to control.
 */
export function PagerFooter({ pager, noun = "rows", standalone = false, className = "" }) {
  const anchor = useRef(null);
  if (!pager.hasPages) return null;

  /* Landing halfway down page 2 is the thing that makes numbered pages feel
     broken, so changing page returns to the top of the list. The nearest
     scrolling ancestor, not the window: the dashboard drill-down is a sheet that
     scrolls inside itself, and scrolling the window there moves nothing. */
  function go(n) {
    pager.setPage(n);
    const scroller = scrollParent(anchor.current);
    if (scroller === window) window.scrollTo({ top: 0, behavior: "smooth" });
    else scroller?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div
      ref={anchor}
      className={`flex flex-col items-center gap-2.5 bg-canvas px-4 py-3 sm:flex-row sm:justify-between ${
        standalone ? "mt-2 rounded border border-border" : "border-t border-[#F1F3F5]"
      } ${className}`}
    >
      <span className="text-[12.5px] text-ink-soft">
        Showing {pager.from}&ndash;{pager.to} of {pager.total} {noun}
      </span>

      <nav className="flex items-center gap-1" aria-label="Pagination">
        <Step
          icon={ChevronLeft}
          label="Previous page"
          disabled={pager.page === 1}
          onClick={() => go(pager.page - 1)}
        />
        {pageItems(pager.page, pager.pageCount).map((item, i) =>
          item === "gap" ? (
            <span key={`gap${i}`} className="px-1 text-[12.5px] text-ink-soft" aria-hidden="true">
              &hellip;
            </span>
          ) : (
            <button
              key={item}
              onClick={() => go(item)}
              aria-label={`Page ${item}`}
              aria-current={item === pager.page ? "page" : undefined}
              className={`min-w-[30px] rounded px-2 py-1 text-[12.5px] font-semibold transition-colors ${
                item === pager.page
                  ? "bg-navy text-white"
                  : "border border-[#D8DEE4] bg-white text-ink hover:bg-canvas"
              }`}
            >
              {item}
            </button>
          )
        )}
        <Step
          icon={ChevronRight}
          label="Next page"
          disabled={pager.page === pager.pageCount}
          onClick={() => go(pager.page + 1)}
        />
      </nav>
    </div>
  );
}

function Step({ icon: Icon, label, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded border border-[#D8DEE4] bg-white px-1.5 py-1 text-ink hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon size={15} />
    </button>
  );
}

/**
 * The numbers to draw. First and last always present so the ends stay reachable
 * in one tap; a window around the current page in between; "gap" where numbers
 * were dropped.
 *
 * Seven or fewer pages are drawn in full - the windowed form of 1..7 is 1..7
 * plus the cost of thinking about it.
 */
export function pageItems(page, pageCount) {
  if (pageCount <= 7) return range(1, pageCount);

  const items = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pageCount - 1, page + 1);

  // A gap hiding exactly one number is wider than the number it hides.
  if (from > 2) items.push(from === 3 ? 2 : "gap");
  items.push(...range(from, to));
  if (to < pageCount - 1) items.push(to === pageCount - 2 ? pageCount - 1 : "gap");
  items.push(pageCount);
  return items;
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Is a pager already rendered near this list, and therefore already measured? */
function hasPagerBelow(el) {
  let n = el;
  for (let i = 0; n && i < 3; i++, n = n.parentElement) {
    if (n.querySelector('nav[aria-label="Pagination"]')) return true;
  }
  return false;
}

/** Nearest ancestor that actually scrolls, or `window`. */
function scrollParent(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const { overflowY } = getComputedStyle(n);
    if ((overflowY === "auto" || overflowY === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return window;
}
