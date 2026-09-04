"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { CHART_PERIODS } from "../../lib/chartPeriods";

/**
 * The one control the four charts share.
 *
 * DELIBERATELY QUIET. It is a line of muted text with a chevron, sitting where
 * a caption would, not a segmented bar across the top of the page. Two reasons
 * beyond taste: the dashboard's loudest elements should be the eleven figures
 * and the charts themselves, and a control that is always expanded costs a
 * phone a whole row of vertical space before a single chart begins.
 *
 * Quiet is not hidden, and the difference is load-bearing: it always states the
 * period currently applied, in words. A chart whose scope can be changed but
 * does not say what its scope IS is worse than one that cannot be changed at
 * all — the reader has no way to know they are looking at March.
 *
 * The panel is a plain absolutely-positioned div rather than a <dialog> or a
 * portal: it lives inside a card that already establishes its own stacking
 * context, and the app has no popover primitive to reuse. It closes on outside
 * pointerdown and on Escape, both of which people try.
 */
export default function ChartPeriodControl({ period, periodKey, custom, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(custom || { from: "", to: "" });
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(key) {
    if (key === "custom") {
      // Staying open is the point: a custom range needs two more answers, and
      // closing here would make the option look broken.
      onChange(key, draft);
      return;
    }
    onChange(key, null);
    setOpen(false);
  }

  function applyCustom() {
    if (!draft.from || !draft.to) return;
    onChange("custom", draft);
    setOpen(false);
  }

  return (
    <div className="relative" ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-[32px] items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ink-soft transition-colors hover:bg-slate-50 hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy"
      >
        <span className="truncate max-w-[190px]">{period?.label || "Choose a period"}</span>
        <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-border bg-white p-1.5 shadow-card"
        >
          {CHART_PERIODS.map((p) => {
            const active = periodKey === p.key;
            return (
              <button
                key={p.key}
                role="menuitem"
                type="button"
                onClick={() => pick(p.key)}
                className={`flex w-full min-h-[36px] items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${
                  active ? "bg-slate-50 font-semibold text-navy" : "text-ink hover:bg-slate-50"
                }`}
              >
                <span>{p.label}</span>
                {active && <Check size={13} className="shrink-0 text-navy" />}
              </button>
            );
          })}

          {periodKey === "custom" && (
            <div className="mt-1 border-t border-border px-2.5 pb-1 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">
                  From
                  <input
                    type="date"
                    value={draft.from}
                    onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                    className="mt-0.5 w-full rounded-md border border-border px-1.5 py-1 text-[12px] font-normal normal-case tracking-normal text-ink"
                  />
                </label>
                <label className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">
                  To
                  <input
                    type="date"
                    value={draft.to}
                    onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                    className="mt-0.5 w-full rounded-md border border-border px-1.5 py-1 text-[12px] font-normal normal-case tracking-normal text-ink"
                  />
                </label>
              </div>
              {/* Both ends are required, unlike the work order list's filter,
                  because a chart has to bucket between two edges — see
                  resolveChartPeriod(). Saying so is cheaper than a disabled
                  button nobody can explain. */}
              <p className="mt-1.5 text-[10.5px] leading-snug text-ink-soft">
                Both dates are needed. The granularity follows the span.
              </p>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!draft.from || !draft.to}
                className="mt-1.5 w-full min-h-[34px] rounded-lg bg-navy px-2 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                Apply range
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
