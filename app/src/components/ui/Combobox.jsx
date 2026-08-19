"use client";

/**
 * SI — Service Inside · Type-to-search picker
 *
 * A `<select>` was fine while the equipment list was one department's worth.
 * Migration 0019 unfiltered it, so the picker now holds every asset on site and
 * scrolling a native dropdown to find one is not a real option on a phone.
 *
 * Deliberately not a native `<select>` and not a library:
 *
 *  - The list is filtered as you type, which `<select>` cannot do.
 *  - `onCreate` puts "add the thing you just typed" at the bottom of the list,
 *    which is where the raise form offers a new department.
 *
 * Keyboard and pointer both work: arrows move, Enter takes the highlighted row,
 * Escape closes without changing anything, and a click outside is a cancel. The
 * highlighted row is tracked by index into the *filtered* list, so it stays
 * meaningful while the query narrows.
 *
 * The panel is positioned absolutely inside a `relative` wrapper rather than
 * portalled: it is a dropdown attached to its field, and unlike ModalOverlay it
 * has no reason to escape an ancestor's transform.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { inputClass } from "./Field";

export default function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  loadingLabel = "Loading…",
  emptyLabel = "Nothing to choose from",
  noMatchLabel = "No matches",
  disabled = false,
  loading = false,
  onCreate,
  createLabel = "Add",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        String(o.hint ?? "").toLowerCase().includes(q) ||
        String(o.value ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  // A create row only earns its place once there is something to name it with,
  // and not when the query already matches an option exactly — offering "Add
  // Machining" underneath the existing Machining is how duplicates get made.
  const trimmed = query.trim();
  const canCreate =
    typeof onCreate === "function" &&
    trimmed.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase());

  const rowCount = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function openPanel() {
    if (disabled) return;
    setOpen(true);
    // Focus after the panel exists, or the input is not in the document yet.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function pick(option) {
    onChange(option.value);
    close();
  }

  function commitActive() {
    if (canCreate && active === filtered.length) {
      onCreate(trimmed);
      close();
      return;
    }
    const option = filtered[active];
    if (option) pick(option);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rowCount === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % rowCount : (i - 1 + rowCount) % rowCount));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      {!open && (
        <button
          type="button"
          disabled={disabled}
          onClick={openPanel}
          className={`${inputClass} flex items-center justify-between gap-2 text-left disabled:bg-canvas disabled:text-ink-soft`}
        >
          <span className={`min-w-0 truncate ${selected ? "text-ink" : "text-ink-soft"}`}>
            {loading ? loadingLabel : selected ? selected.label : options.length === 0 ? emptyLabel : placeholder}
          </span>
          <ChevronDown size={15} className="flex-shrink-0 text-ink-soft" />
        </button>
      )}

      {open && (
        <>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-3 text-ink-soft" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={selected ? selected.label : placeholder}
              className={`${inputClass} pl-9`}
              autoComplete="off"
            />
          </div>

          <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded border border-[#D8DEE4] bg-white shadow-card scroll-touch">
            {filtered.map((o, i) => (
              <button
                key={o.value}
                type="button"
                // pointerdown, not click: the outside-click listener above also
                // runs on pointerdown, and a blur-then-click ordering would close
                // the panel before the click landed.
                onPointerDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13.5px] ${
                  i === active ? "bg-canvas" : "bg-white"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{o.label}</span>
                  {o.hint && <span className="block truncate text-[11.5px] text-ink-soft">{o.hint}</span>}
                </span>
                {o.value === value && <Check size={15} className="flex-shrink-0 text-accent" />}
              </button>
            ))}

            {filtered.length === 0 && !canCreate && (
              <div className="px-3 py-3 text-[13px] text-ink-soft">
                {options.length === 0 ? emptyLabel : noMatchLabel}
              </div>
            )}

            {canCreate && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onCreate(trimmed);
                  close();
                }}
                onMouseEnter={() => setActive(filtered.length)}
                className={`flex w-full items-center gap-2 border-t border-[#E5E9F0] px-3 py-2.5 text-left text-[13.5px] font-semibold text-navy ${
                  active === filtered.length ? "bg-canvas" : "bg-white"
                }`}
              >
                <Plus size={15} className="flex-shrink-0" />
                <span className="min-w-0 truncate">
                  {createLabel} “{trimmed}”
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
