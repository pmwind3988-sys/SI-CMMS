"use client";

/**
 * SI — Service Inside · Administration · Settings · Plant assignment
 *
 * Moving a work order to the plant it actually happened at, for the Superuser
 * alone (migration 0064).
 *
 * WHY THIS SCREEN EXISTS. Every work order raised before migration 0049 says
 * PLT001 — "Main Plant". That was true when it was written: there was one plant
 * and createWorkOrder() hardcoded it. It is simply no longer useful, because
 * PLT001 is retired, there are four real sites, and any filter, chart or export
 * grouped by plant puts the entire history in a bucket that names nowhere.
 *
 * WHY IT IS A SCREEN AND NOT A MIGRATION. The obvious repair is a rule — read
 * the plant off the department, "Production F1" is at F1 — and it was designed
 * and then dropped, because a department here may span more than one plant. The
 * rule would have written a confident wrong answer into rows nobody would ever
 * re-check, and a wrong plant is worse than the honest PLT001 it replaced, which
 * at least reads as "from before we had plants". departments.plant_id cannot
 * stand in either: createDepartment() writes 'PLT001' for every department ever
 * added and the raise form passes no plant, so that column holds no information
 * at all. Each of these is a judgement, so the screen makes judgements cheap
 * rather than making them for you.
 *
 * Four decisions worth not undoing:
 *
 *   NOTHING IS EVER PRE-SELECTED. The department filter and the bulk apply exist
 *   because you will often be able to see at a glance that these eleven are all
 *   F3 — not because the department implies the plant. A checkbox ticked on your
 *   behalf would smuggle the rejected rule back in wearing a suggestion's
 *   clothes.
 *
 *   THE EQUIPMENT NAME IS ON EVERY ROW. On most of these it is the strongest
 *   clue about which site the job was at, and it is read from `asset_name`
 *   rather than resolved through `asset_id` — the same reason the export does
 *   it: an "Other (specify)" work order resolves to the plant's shared Other row
 *   and would print "Other (specify)" instead of what somebody typed.
 *
 *   ROWS ALREADY ON A REAL PLANT CAN BE SHOWN. A repair screen that only ever
 *   lists the unrepaired is one-way: the first mis-assignment becomes permanent
 *   and invisible. The plant selector at the top is what makes it correctable.
 *
 *   ONLY THE PLANT MOVES. setWorkOrderPlant() names one column and the guard
 *   enforces it; the status-unchanged early returns in si_stamp_work_order and
 *   si_notify_work_order_update mean a records fix stamps no timestamps, writes
 *   no history row and notifies nobody. That is deliberate — a correction to
 *   what a record says about itself is not an event in the work order's life.
 */
import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Loader2, MapPin } from "lucide-react";
import { listenWorkOrdersOnPlant, setWorkOrderPlant } from "../../lib/workOrders";
import { useReferenceData } from "../../lib/referenceData";
import { describeError } from "../../lib/errors";
import { fmtDateMY } from "../../lib/datetime";
import Button from "../ui/Button";
import { Card, EmptyState, ErrorBanner } from "../ui/Surfaces";

/* The plant every pre-0049 work order carries. Retired rather than deleted, so
   it still resolves to a label everywhere it is displayed. */
const LEGACY_PLANT = "PLT001";

export default function PlantAssignmentPanel({ onFlash, onError }) {
  const ref = useReferenceData();
  const [viewing, setViewing] = useState(LEGACY_PLANT);
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [dept, setDept] = useState("all");
  const [picked, setPicked] = useState(() => new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(null);
    setPicked(new Set());
    /* Reset alongside the rows: a department present at one plant may not exist
       at the next, which would show an empty list under a filter the reader did
       not set for this plant. */
    setDept("all");
    setLoadError(null);
    return listenWorkOrdersOnPlant(
      viewing,
      (list) => {
        setRows(list ?? []);
        /* A row that has just been moved leaves this query. Dropping it from the
           selection here rather than leaving a tick behind on nothing is what
           stops the count reading "12 selected" over eleven visible rows. */
        setPicked((prev) => {
          const live = new Set((list ?? []).map((r) => r.id));
          const next = new Set();
          prev.forEach((id) => live.has(id) && next.add(id));
          return next;
        });
      },
      (e) => setLoadError(describeError(e, "Could not load the work orders."))
    );
  }, [viewing]);

  /* Departments that actually appear in the loaded rows, not every department on
     the site. A filter offering forty options of which three match anything is a
     list to read rather than a control to use. */
  const departments = useMemo(() => {
    const seen = new Map();
    (rows ?? []).forEach((r) => {
      if (!r.department_id) return;
      seen.set(r.department_id, ref.departmentById?.(r.department_id)?.name ?? r.department_id);
    });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows, ref]);

  const shown = useMemo(
    () => (rows ?? []).filter((r) => dept === "all" || r.department_id === dept),
    [rows, dept]
  );

  /* Narrowing the department clears the selection, exactly as switching plant
     does. Carrying it over reads "1 selected of 20 shown" with the selected row
     filtered out of the twenty — and Move would then move a work order that is
     not on screen and cannot be checked. A selection is made in the context you
     are looking at; it should not survive leaving it. */
  useEffect(() => {
    setPicked(new Set());
  }, [dept]);

  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));

  function toggle(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setPicked((prev) => {
      const next = new Set(prev);
      shown.forEach((r) => (allShownPicked ? next.delete(r.id) : next.add(r.id)));
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    try {
      const n = await setWorkOrderPlant([...picked], target);
      const label = ref.plantById?.(target)?.name ?? target;
      onFlash?.(`Moved ${n} work order${n === 1 ? "" : "s"} to ${label}.`);
      setPicked(new Set());
      setTarget("");
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy(false);
    }
  }

  const plantOptions = ref.activePlants ?? [];
  /* Every plant, not just the active ones, so PLT001 can be looked at — it is
     the whole point of the screen and it is retired by definition. */
  const viewOptions = ref.plants ?? [];

  return (
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <MapPin size={16} className="mt-0.5 flex-shrink-0 text-[#64748B]" />
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Plant assignment</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#5A6572]">
            Work orders raised before the plant field existed all say{" "}
            <strong>Main Plant</strong>, because that is what there was at the time. Move
            them to the site the job was actually at. A department can cover more than one
            plant, so nothing is decided for you — this changes the plant and nothing else.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-[12px] font-semibold text-[#5A6572]">
          Showing work orders at
          <select
            value={viewing}
            onChange={(e) => setViewing(e.target.value)}
            className="mt-1 block min-h-[40px] w-[220px] rounded border border-[#D8DEE4] bg-white px-2 text-[13px] font-normal text-ink"
          >
            {viewOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {departments.length > 1 && (
          <label className="text-[12px] font-semibold text-[#5A6572]">
            Department
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="mt-1 block min-h-[40px] w-[220px] rounded border border-[#D8DEE4] bg-white px-2 text-[13px] font-normal text-ink"
            >
              <option value="all">All departments</option>
              {departments.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loadError && <ErrorBanner message={loadError} />}

      {rows === null && !loadError && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-[#5A6572]">
          <Loader2 size={14} className="animate-spin" />
          Loading work orders…
        </p>
      )}

      {rows !== null && shown.length === 0 && (
        <div className="mt-4">
          <EmptyState>
            {rows.length === 0
              ? "No work orders are at this plant."
              : "No work orders in that department are at this plant."}
          </EmptyState>
        </div>
      )}

      {shown.length > 0 && (
        <>
          {/* The apply bar is sticky and sits ABOVE the list, because on a phone
              a selection made at row forty would otherwise be applied by a
              control the reader has to scroll past everything to reach. */}
          <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-2 rounded border border-[#D8DEE4] bg-[#F7F9FB] px-3 py-2">
            <span className="text-[13px] font-semibold text-ink">{picked.size} selected</span>
            <span className="text-[13px] text-[#5A6572]">of {shown.length} shown</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={picked.size === 0}
                className="min-h-[40px] rounded border border-[#D8DEE4] bg-white px-2 text-[13px] text-ink disabled:opacity-50"
              >
                <option value="">Move to…</option>
                {plantOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button
                icon={Check}
                loading={busy}
                disabled={picked.size === 0 || !target || target === viewing}
                onClick={apply}
              >
                Move
              </Button>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#D8DEE4] text-left text-[12px] font-semibold text-[#5A6572]">
                  <th className="w-10 py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={allShownPicked}
                      onChange={toggleAllShown}
                      aria-label="Select every work order shown"
                      className="h-4 w-4"
                    />
                  </th>
                  <th className="py-2 pr-3">Work order</th>
                  <th className="py-2 pr-3">Raised</th>
                  <th className="py-2 pr-3">Department</th>
                  <th className="py-2 pr-3">Equipment</th>
                  <th className="py-2 pr-3">Raised by</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-[#EDF1F5] ${picked.has(r.id) ? "bg-[#F2F7FF]" : ""}`}
                  >
                    <td className="py-2 pr-2 align-top">
                      <input
                        type="checkbox"
                        checked={picked.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Select ${r.wo_number}`}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="py-2 pr-3 align-top font-semibold text-ink">{r.wo_number}</td>
                    <td className="py-2 pr-3 align-top text-[#5A6572]">{fmtDateMY(r.created_at)}</td>
                    <td className="py-2 pr-3 align-top text-[#5A6572]">
                      {ref.departmentById?.(r.department_id)?.name ?? r.department_id ?? "—"}
                    </td>
                    <td className="py-2 pr-3 align-top text-[#5A6572]">
                      <span className="inline-flex items-center gap-1">
                        <Building2 size={12} className="flex-shrink-0" />
                        {r.asset_name || "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top text-[#5A6572]">{r.requester_name || "—"}</td>
                    <td className="py-2 pr-3 align-top text-[#5A6572]">
                      {ref.statusLabel?.(r.status) ?? r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
