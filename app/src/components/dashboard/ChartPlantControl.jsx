"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useReferenceData } from "../../lib/referenceData";

/**
 * Which plant the four charts are about — F1, F2, F3, Facility, or all of them.
 *
 * Built to match ChartPeriodControl exactly, and sitting immediately beside it:
 * the same muted text-and-chevron trigger, the same outside-pointerdown and
 * Escape dismissal, the same absolutely-positioned panel. Two controls that
 * scope the same four charts should not look like two different kinds of thing,
 * and the reasoning in that file for being quiet rather than a segmented bar
 * applies twice as hard now that there are two of them.
 *
 * It states the applied filter in words for the same reason the period control
 * does: a chart whose scope can be changed but does not say what its scope IS
 * is worse than one that cannot be changed at all. "All plants" is a real label
 * here, not an empty state.
 *
 * ROWS COME FROM `activePlants`, so a retired plant is not offered — the same
 * source the raise form's picker uses (migration 0049, and 0031 for why
 * retirement has to decide something rather than only filter a dropdown). A
 * plant retired while somebody had it selected keeps drawing its charts until
 * they change it, which is correct: those work orders happened.
 */
export default function ChartPlantControl({ plantId, onChange }) {
  const { activePlants, plantName } = useReferenceData();
  const [open, setOpen] = useState(false);
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

  // null is the value the RPC takes for "every plant", so it is the value the
  // control holds too rather than a sentinel translated at the call site.
  const options = [{ id: null, name: "All plants" }, ...(activePlants ?? [])];
  const label = plantId ? plantName(plantId) : "All plants";

  function pick(id) {
    onChange(id);
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
        <span className="truncate max-w-[140px]">{label}</span>
        <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-border bg-white p-1.5 shadow-card"
        >
          {options.map((p) => {
            const active = (plantId ?? null) === (p.id ?? null);
            return (
              <button
                key={p.id ?? "__all"}
                role="menuitem"
                type="button"
                onClick={() => pick(p.id ?? null)}
                className={`flex w-full min-h-[36px] items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${
                  active ? "bg-slate-50 font-semibold text-navy" : "text-ink hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{p.name}</span>
                {active && <Check size={13} className="shrink-0 text-navy" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
