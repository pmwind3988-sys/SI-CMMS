"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * SI — Service Inside · "What am I looking at?" for one chart
 *
 * Collapsed by default, and that is the whole reason this exists rather than
 * recharts' own `<Legend>`. Department Breakdown was the only chart carrying
 * one, and on a phone it took a third of the card's height off the pie. A chart
 * is read at a glance and its key is read once, so the key is the half that
 * should cost nothing until it is asked for.
 *
 * `items` is `{ color?, label, note? }[]`:
 *
 *   - with a colour, it is a swatch — what red or amber or this slice means;
 *   - without one, it is a plain line — what the bar measures, what the axis
 *     counts, what the chart leaves out.
 *
 * The second kind is why this is not just a colour key. Two of the four charts
 * are single-series and have no colours to explain, but they do have a
 * vertical axis nobody labelled and a test-data exclusion that makes them
 * disagree with the work order list.
 */
export default function ChartLegend({ items }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (!items?.length) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        /* -my-2 keeps the row height it had; the button itself is now a 44px
           target rather than a 17px one. */
        className="-my-2 inline-flex min-h-[44px] items-center gap-1 rounded text-[11.5px] font-semibold text-ink-soft hover:text-ink"
      >
        Legend
        <ChevronDown
          size={13}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul id={panelId} className="mt-1.5 flex flex-col gap-1 rounded bg-canvas px-2.5 py-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-[11.5px] leading-snug">
              {/* The swatch is aligned to the first line rather than centred on
                  the whole item, so a two-line note does not float its colour
                  chip into the middle of the text. */}
              {item.color ? (
                <span
                  className="mt-[3px] h-2.5 w-2.5 flex-shrink-0 rounded-full border border-black/10"
                  style={{ background: item.color }}
                  aria-hidden="true"
                />
              ) : (
                <span className="mt-[3px] h-2.5 w-2.5 flex-shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="font-semibold text-ink">{item.label}</span>
                {item.note && <span className="text-ink-soft"> — {item.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Every chart on this dashboard is built from `si_compute_dashboard_stats`,
 * which excludes work raised by a test account (migrations 0033, 0034). The
 * work order LIST does not — it shows those rows tagged "Demo". So a chart and
 * the list can legitimately disagree, and someone comparing the two deserves
 * to be told why rather than left to find it.
 */
export const EXCLUDES_TEST_DATA = {
  label: "Demo work orders are left out",
  note: "the list shows them tagged Demo; the charts do not count them",
};
