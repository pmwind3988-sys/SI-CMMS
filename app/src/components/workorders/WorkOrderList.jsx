"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Download, AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenWorkOrderList, fetchWorkOrdersForExport } from "../../lib/workOrders";
import { fmtDue } from "../../lib/constants";
import { describeError } from "../../lib/errors";
import {
  DATE_PRESETS,
  dateRangePreset,
  dateRangeCustom,
  describeRange,
  fmtDateMY,
  fmtTimeMY,
  isoDateMY,
} from "../../lib/datetime";
import { downloadWorkOrderExport } from "../../lib/exportWorkOrders";
import { useReferenceData } from "../../lib/referenceData";
import { ROLES, hasRole, hasAnyRole } from "../../lib/roles";
import { PriorityBadge, StatusBadge } from "../ui/Badges";
import Button from "../ui/Button";
import { Card, ErrorBanner, EmptyState } from "../ui/Surfaces";
import { usePaged, PagerFooter } from "../ui/Paged";
import { inputClass } from "../ui/Field";

const TITLES = {
  [ROLES.REQUESTER]: "My Work Orders",
  [ROLES.TECHNICIAN]: "My Tasks",
  // Not "My Department" since migration 0019 — a Supervisor now gets the same
  // system-wide list a Manager does.
  [ROLES.SUPERVISOR]: "Work Orders",
  [ROLES.MANAGER]: "Work Orders",
  [ROLES.ADMIN]: "Work Orders — All",
};

const EMPTY_MESSAGES = {
  [ROLES.REQUESTER]: "You haven't raised any work orders yet.",
  [ROLES.TECHNICIAN]: "No tasks assigned to you right now.",
  // Not "in your department" any more — migration 0019 gave Supervisors the
  // whole plant, and an empty state that names a scope the policy no longer
  // applies sends someone looking for a filter that is not there.
  [ROLES.SUPERVISOR]: "No work orders match these filters.",
  [ROLES.MANAGER]: "No work orders match these filters.",
  [ROLES.ADMIN]: "No work orders match these filters.",
};

/** Matches LIST_DISPLAY_LIMIT in lib/workOrders — see the note by the banner. */
const DISPLAY_LIMIT = 300;

/**
 * Button renders its icon as `<Icon size={14} />` and passes no className, so a
 * bare Loader2 would sit there perfectly still and read as a broken icon rather
 * than as work in progress. Wrapping it is what gets the spin.
 */
const Spinner = () => <Loader2 size={14} className="animate-spin" />;

export default function WorkOrderList() {
  const { user } = useAuth();
  const reference = useReferenceData();
  const { priorities, statuses } = reference;
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState(null);
  const [error, setError] = useState(null);
  const [fPriority, setFPriority] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [q, setQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Date filtering. The preset is the control; `custom` reveals the two inputs.
  const [preset, setPreset] = useState("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState(null);

  /**
   * The range, in Kuala Lumpur terms. Recomputed on every render for the presets
   * so "Today" is still today in a session left open overnight.
   *
   * Serialised into the effect's dependency list rather than passed by identity:
   * a fresh object each render would resubscribe on every keystroke.
   */
  const range = useMemo(
    () => (preset === "custom" ? dateRangeCustom(customFrom, customTo) : dateRangePreset(preset)),
    [preset, customFrom, customTo]
  );
  const rangeKey = range ? `${range.from ?? ""}|${range.to ?? ""}` : "";

  useEffect(() => {
    if (!user) return;
    setError(null);
    setWorkOrders(null);
    const unsub = listenWorkOrderList(
      user,
      setWorkOrders,
      (err) => setError(err?.message || "Couldn't load work orders."),
      range
    );
    return unsub;
    // `range` is intentionally absent and `rangeKey` present: the object is
    // rebuilt every render, so depending on it would resubscribe on every
    // keystroke. rangeKey changes exactly when the range's contents do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, reloadKey, rangeKey]);

  /**
   * The priority / status / search predicate, defined once.
   *
   * Export reuses it, so the workbook contains exactly the rows on screen. Two
   * copies of this — one for the table, one for the file — is how an export
   * starts quietly disagreeing with the list it was taken from.
   */
  const matches = useCallback(
    (w) => {
      if (fPriority !== "All" && w.priority !== fPriority) return false;
      if (fStatus !== "All" && w.status !== fStatus) return false;
      if (q) {
        const needle = q.toLowerCase();
        // area joins WO# and equipment rather than getting its own filter: it is
        // free text, so a dropdown of every value anyone ever typed is not a
        // control worth having.
        const haystack = [w.asset_name, w.wo_number, w.area];
        if (!haystack.some((v) => v?.toLowerCase().includes(needle))) return false;
      }
      return true;
    },
    [fPriority, fStatus, q]
  );

  const filtered = useMemo(() => (workOrders ? workOrders.filter(matches) : []), [workOrders, matches]);

  /* Paginated AFTER the filter, never before: `matches` has already run over
     every row loaded for this date range, so searching a WO number finds it
     wherever it sits and the pager then walks the matches. Reset is keyed on
     the controls rather than on `filtered`, which is a new array on every live
     update. */
  const pager = usePaged(filtered, {
    resetKey: `${fPriority}|${fStatus}|${rangeKey}|${q}`,
  });

  const needsAssignment = (workOrders || []).filter((w) => w.status === "open").length;
  // Assigned to THIS person, not merely assigned. A Supervisor+Technician sees
  // every work order in the plant (migration 0019), so counting every row at
  // status "assigned" would report the whole plant's backlog as waiting on them.
  const needsMyResponse = hasRole(user, ROLES.TECHNICIAN)
    ? (workOrders || []).filter((w) => w.status === "assigned" && w.assigned_to_id === user.uid).length
    : 0;
  const canTriage = hasAnyRole(user, [ROLES.SUPERVISOR, ROLES.MANAGER, ROLES.ADMIN]);

  /** Human description of what is filtered, for the workbook's Export Info sheet. */
  const filterSummary = useMemo(() => {
    const bits = [];
    if (fStatus !== "All") bits.push(`Status: ${reference.statusLabel(fStatus)}`);
    if (fPriority !== "All") bits.push(`Priority: ${fPriority}`);
    if (q) bits.push(`Search: "${q}"`);
    return bits.length ? bits.join(" · ") : "None";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fStatus, fPriority, q, reference.ready]);

  async function handleExport() {
    setExporting(true);
    setExportNote(null);
    try {
      // Its own fetch, uncapped and paginated — not the 300 rows on screen. See
      // fetchWorkOrdersForExport.
      const data = await fetchWorkOrdersForExport(user, range);
      const rows = data.workOrders.filter(matches);
      const keep = new Set(rows.map((w) => w.id));

      const result = await downloadWorkOrderExport({
        workOrders: rows,
        history: data.history.filter((h) => keep.has(h.work_order_id)),
        comments: data.comments.filter((c) => keep.has(c.entity_id)),
        attachments: data.attachments.filter((a) => keep.has(a.entity_id)),
        labels: {
          statusLabel: reference.statusLabel,
          priorityLabel: reference.priorityLabel,
          departmentName: reference.departmentName,
          impactLabel: reference.impactLabel,
          typeLabel: reference.typeLabel,
          severityByCode: reference.severityByCode,
          assetById: reference.assetById,
          assetName: reference.assetName,
        },
        range,
        filterSummary,
        scopeNote:
          "Only work orders your role is permitted to see are included — the same rows the app shows you.",
      });

      setExportNote(
        rows.length === 0
          ? { kind: "warn", text: "Nothing matched those filters, so the workbook is empty apart from its headings." }
          : { kind: "ok", text: `${result.rows} work order${result.rows === 1 ? "" : "s"} exported to ${result.fileName}` }
      );
    } catch (e) {
      setExportNote({ kind: "error", text: describeError(e, "Couldn't build the export.") });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink">{TITLES[user.role]}</h1>
          <p className="text-[13px] text-ink-soft">
            {workOrders
              ? `${filtered.length} of ${workOrders.length} work orders · ${describeRange(range)}`
              : "Loading…"}
          </p>
        </div>
        {/* A technician-only account does not raise work orders; anyone holding
            any other role does. */}
        {hasAnyRole(user, [ROLES.REQUESTER, ROLES.SUPERVISOR, ROLES.MANAGER, ROLES.ADMIN]) && (
          <Button variant="amber" icon={Plus} onClick={() => router.push("/work-orders/new")}>
            Raise Work Order
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {canTriage && needsAssignment > 0 && (
        <div className="flex items-center gap-2 rounded bg-accent-soft border border-accent/40 px-3.5 py-2.5 mb-3.5 text-[13px] text-[#8A5A0A]">
          <AlertTriangle size={15} />
          <strong>{needsAssignment}</strong> work order{needsAssignment !== 1 ? "s" : ""} need{needsAssignment === 1 ? "s" : ""} a technician assigned.
        </div>
      )}
      {hasRole(user, ROLES.TECHNICIAN) && needsMyResponse > 0 && (
        <div className="flex items-center gap-2 rounded bg-accent-soft border border-accent/40 px-3.5 py-2.5 mb-3.5 text-[13px] text-[#8A5A0A]">
          <AlertTriangle size={15} />
          <strong>{needsMyResponse}</strong> new assignment{needsMyResponse !== 1 ? "s" : ""} awaiting your response.
        </div>
      )}

      {/* A two-column grid on a phone (search spanning both) rather than a row of
          fixed 16rem/9rem/13rem controls, which together needed 640px and forced
          the whole page sideways on a 360px screen. From `sm` up it's a single
          wrapping row. */}
      <div className="mb-3.5 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap sm:gap-3">
        <div className="col-span-2 flex items-center gap-2 rounded border border-border bg-white px-3 py-1.5 sm:w-64">
          <Search size={14} className="flex-shrink-0 text-ink-soft" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={"Search WO#, equipment or area…"} className="w-full min-w-0 outline-none text-[13px]" />
        </div>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={`${inputClass} min-w-0 sm:w-36`}>
          <option>All</option>
          {priorities.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} — {p.label}
            </option>
          ))}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inputClass} min-w-0 sm:w-52`}>
          <option value="All">All</option>
          {statuses.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          aria-label="Date raised"
          className={`${inputClass} min-w-0 sm:w-44`}
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>

        {preset === "custom" && (
          <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
            <input
              type="date"
              value={customFrom}
              max={customTo || isoDateMY()}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="Raised from"
              className={`${inputClass} min-w-0 flex-1 sm:w-36 sm:flex-none`}
            />
            <span className="text-[12px] text-ink-soft">to</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="Raised to"
              className={`${inputClass} min-w-0 flex-1 sm:w-36 sm:flex-none`}
            />
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          icon={exporting ? Spinner : Download}
          onClick={handleExport}
          disabled={exporting || !workOrders}
          className="col-span-2 justify-center sm:col-span-1"
        >
          {exporting ? "Building…" : "Export"}
        </Button>
      </div>

      {exportNote && (
        <div
          className={`mb-3.5 flex items-start justify-between gap-3 rounded border px-3.5 py-2.5 text-[13px] ${
            exportNote.kind === "error"
              ? "border-danger/40 bg-[#FCE9E9] text-danger"
              : exportNote.kind === "warn"
                ? "border-accent/40 bg-accent-soft text-[#8A5A0A]"
                : "border-good/40 bg-[#E7F5EE] text-[#166534]"
          }`}
        >
          <span>{exportNote.text}</span>
          <button onClick={() => setExportNote(null)} className="flex-shrink-0 font-bold opacity-60 hover:opacity-100" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {/* The display cap is real and worth saying out loud: the query asks for
          DISPLAY_LIMIT rows of newest-first within the range. Export is not
          capped, which is exactly why this mentions it. */}
      {workOrders?.length >= DISPLAY_LIMIT && (
        <div className="mb-3.5 rounded border border-border bg-canvas px-3.5 py-2.5 text-[12.5px] text-ink-soft">
          Showing the {DISPLAY_LIMIT} most recent work orders in this range. Narrow the dates to see
          earlier ones — <strong>Export includes every one</strong>, not just these.
        </div>
      )}

      <Card className="overflow-hidden hidden md:block">
        <div className="flex items-center px-4 py-2.5 bg-canvas text-[11.5px] font-bold text-ink-soft uppercase tracking-wide">
          <div className="flex-[2]">Work Order</div>
          {/* Department gives way to Raised below lg — the equipment name in the
              first column already identifies the row, and seven columns on a
              768px tablet forced the page sideways. */}
          <div className="hidden lg:block lg:flex-[1.3]">Department</div>
          <div className="w-16">Priority</div>
          <div className="flex-[1.3]">Status</div>
          <div className="flex-[1.2]">Raised</div>
          <div className="flex-[1.2]">Assigned</div>
          <div className="w-24 text-right">SLA</div>
        </div>
        {pager.visible.map((w, i) => (
          <WorkOrderRow key={w.id} w={w} first={i === 0} onClick={() => router.push(`/work-orders/view?id=${w.id}`)} />
        ))}
        {workOrders && filtered.length === 0 && <EmptyState>{EMPTY_MESSAGES[user.role]}</EmptyState>}
      </Card>

      <div className="md:hidden flex flex-col gap-2">
        {pager.visible.map((w) => (
          <WorkOrderCard key={w.id} w={w} onClick={() => router.push(`/work-orders/view?id=${w.id}`)} />
        ))}
        {workOrders && filtered.length === 0 && <EmptyState>{EMPTY_MESSAGES[user.role]}</EmptyState>}
      </div>

      {/* One footer below both, because the table and the card stack are the
          same slice rendered twice at different breakpoints. */}
      <PagerFooter pager={pager} noun="work orders" standalone />
    </div>
  );
}

// Resolution target comes from the sla table now, in minutes, so an admin
// changing P2's target changes every countdown in the app.
function slaRemain(w, slaForPriority) {
  if (!w.created_at || !w.priority) return null;
  const sla = slaForPriority(w.priority);
  if (!sla?.resolution_target_minutes) return null;
  const createdMs = new Date(w.created_at).getTime();
  return sla.resolution_target_minutes * 60000 - (Date.now() - createdMs);
}

/**
 * "Demo" on a work order raised by a test fixture (migration 0034).
 *
 * The list deliberately still SHOWS these — one that vanished would be one
 * nobody could find to delete. But the dashboard excludes them from every
 * statistic, so without the tag a card reading 4 beside a list of 5 looks like a
 * bug rather than a rule.
 */
function DemoTag() {
  return (
    <span
      title="Raised by a test account — excluded from dashboard statistics"
      className="ml-1.5 rounded bg-canvas border border-border px-1.5 py-px align-middle text-[10px] font-bold uppercase tracking-wide text-ink-soft"
    >
      Demo
    </span>
  );
}

function RaisedCell({ ts }) {
  return (
    <>
      <div className="text-[13px] text-ink">{fmtDateMY(ts)}</div>
      <div className="text-[11.5px] text-ink-soft">{fmtTimeMY(ts)}</div>
    </>
  );
}

function WorkOrderRow({ w, first, onClick }) {
  const { slaForPriority, departmentName } = useReferenceData();
  const remain = slaRemain(w, slaForPriority);
  return (
    <div onClick={onClick} className={`flex items-center px-4 py-3 cursor-pointer hover:bg-canvas ${first ? "" : "border-t border-[#F1F3F5]"}`}>
      <div className="flex-[2] min-w-0">
        <div className="font-mono text-[11.5px] text-ink-soft">
          {w.wo_number || "Pending…"}
          {w.is_test_data && <DemoTag />}
        </div>
        <div className="text-[13.5px] text-ink font-medium">{w.asset_name}</div>
      </div>
      <div className="hidden lg:block lg:flex-[1.3] text-[13px] text-ink-soft">{departmentName(w.department_id)}</div>
      <div className="w-16">
        <PriorityBadge p={w.priority} size="sm" />
      </div>
      <div className="flex-[1.3]">
        <StatusBadge s={w.status} />
      </div>
      <div className="flex-[1.2] min-w-0">
        <RaisedCell ts={w.created_at} />
      </div>
      <div className="flex-[1.2] text-[13px] text-ink">{w.assigned_to_name || <span className="text-ink-soft">Unassigned</span>}</div>
      <div className="w-24 text-right font-mono text-[11.5px]" style={{ color: remain != null && remain < 0 ? "#EF4444" : "#64748B", fontWeight: remain < 0 ? 700 : 400 }}>
        {w.status === "closed" ? "—" : remain != null ? (remain < 0 ? "Breached" : fmtDue(remain) + " left") : "—"}
      </div>
    </div>
  );
}

function WorkOrderCard({ w, onClick }) {
  const { slaForPriority, departmentName } = useReferenceData();
  const remain = slaRemain(w, slaForPriority);
  return (
    <Card className="p-3.5" onClick={onClick}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[11px] text-ink-soft">
            {w.wo_number || "Pending…"}
            {w.is_test_data && <DemoTag />}
          </div>
          <div className="text-[14px] text-ink font-semibold mt-0.5">{w.asset_name}</div>
          <div className="text-[12px] text-ink-soft mt-0.5">{departmentName(w.department_id)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PriorityBadge p={w.priority} size="sm" />
          <StatusBadge s={w.status} />
        </div>
      </div>
      <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-[#F1F3F5]">
        <span className="text-[12px] text-ink-soft">{w.assigned_to_name || "Unassigned"}</span>
        <span className="font-mono text-[11px]" style={{ color: remain < 0 ? "#EF4444" : "#64748B" }}>
          {w.status === "closed" ? "—" : remain != null ? (remain < 0 ? "Breached" : fmtDue(remain) + " left") : "—"}
        </span>
      </div>
      <div className="mt-1.5 text-[11.5px] text-ink-soft">Raised {fmtDateMY(w.created_at)} · {fmtTimeMY(w.created_at)}</div>
    </Card>
  );
}
