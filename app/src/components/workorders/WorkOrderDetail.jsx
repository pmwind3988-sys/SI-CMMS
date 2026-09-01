"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Timer, PencilLine, Trash2, Loader2, X, AlertTriangle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenWorkOrder, deleteWorkOrder } from "../../lib/workOrders";
import { fmtDue, canEditWhileOpen, canDeleteWorkOrder } from "../../lib/constants";
import { describeError } from "../../lib/errors";
import { useReferenceData } from "../../lib/referenceData";
import { PriorityBadge, StatusBadge } from "../ui/Badges";
import { Card, ErrorBanner, ModalOverlay } from "../ui/Surfaces";
import Button from "../ui/Button";
import AssignPanel from "./AssignPanel";
import CommentsPanel from "./CommentsPanel";
import AttachmentsPanel from "./AttachmentsPanel";
import StatusTimeline from "./StatusTimeline";
import WorkflowPanel from "./WorkflowPanel";
import { nextStep } from "../../lib/nextStep";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "assignment", label: "Assignment" },
  { key: "comments", label: "Comments" },
  { key: "attachments", label: "Attachments" },
  { key: "timeline", label: "Status Timeline" },
  { key: "workflow", label: "Workflow" },
];

export default function WorkOrderDetail({ woId }) {
  const { user } = useAuth();
  const { slaForPriority, roleCan, transitions, statuses } = useReferenceData();
  const router = useRouter();
  const [wo, setWo] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const tabStripRef = useRef(null);

  /**
   * WHICH TAB THIS OPENS ON IS THE WHOLE POINT.
   *
   * Six tabs need about 700px. On a 375px phone the strip is a scrolling row
   * and Workflow — the only place Accept and Decline exist — starts at x=591,
   * entirely off-screen, with the strip at scrollLeft 0. So a technician who
   * tapped a notification saying a job was theirs landed on Overview and there
   * was nothing on the screen, and no cue anywhere on it, leading to the one
   * action they had been asked to take.
   *
   * `nextStep(...).isYours` is the same signal WorkflowPanel already uses to
   * print "Your move" — derived from `wo_status_transitions`, so it stays true
   * as the matrix changes and never becomes a second copy of the workflow.
   */
  const statusOrder = useMemo(
    () => new Map(statuses.map((st) => [st.code, st.sort_order])),
    [statuses]
  );
  const step = wo ? nextStep(wo, user, transitions, statusOrder) : null;
  const actionIsYours = !!step?.isYours;

  /* Applied once per work order rather than on every render, so it opens on
     Workflow and then lets the reader move freely — re-deriving it would drag
     them back to Workflow every time the row changed underneath them, which on
     a live subscription is often. */
  useEffect(() => {
    if (tab !== null) return;
    if (wo === undefined) return;
    setTab(actionIsYours ? "workflow" : "overview");
  }, [wo, actionIsYours, tab]);

  /* Keep the selected tab in view — it can be off-screen on a phone both when
     it is chosen for the user above and when they arrive back at one they
     picked earlier. */
  useEffect(() => {
    if (!tab || !tabStripRef.current) return;
    tabStripRef.current
      .querySelector(`[data-tab="${tab}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);

  useEffect(() => {
    const unsub = listenWorkOrder(woId, setWo, () => setError("This work order couldn't be found or you no longer have access to it."));
    return unsub;
  }, [woId]);

  if (error) {
    return (
      <div className="max-w-md">
        <ErrorBanner message={error} />
        <button onClick={() => router.push("/work-orders")} className="text-navy text-[13px] font-semibold">
          ← Back to Work Orders
        </button>
      </div>
    );
  }

  if (wo === undefined) return <div className="text-ink-soft text-[13px]">Loading…</div>;

  // No row came back. Under RLS this is the ordinary outcome of opening a link
  // to a work order outside your scope — a Supervisor following a link to
  // another department's job, say — and it is not an error, so listenWorkOrder
  // reports null rather than calling onError. Rendering nothing at all left a
  // blank page with no explanation, which read as the app being broken.
  if (wo === null) {
    return (
      <div className="max-w-md">
        <ErrorBanner message="This work order doesn't exist, or it's outside the departments and assignments your role can see." />
        <button onClick={() => router.push("/work-orders")} className="text-navy text-[13px] font-semibold">
          ← Back to Work Orders
        </button>
      </div>
    );
  }

  const createdMs = wo.created_at ? new Date(wo.created_at).getTime() : Date.now();
  const slaRow = wo.priority ? slaForPriority(wo.priority) : null;
  const remain = slaRow?.resolution_target_minutes
    ? slaRow.resolution_target_minutes * 60000 - (Date.now() - createdMs)
    : null;
  const breached = remain != null && remain < 0 && wo.status !== "closed";
  const showEdit = wo.status === "open" && canEditWhileOpen(wo, user);
  // Deliberately not limited to a status. Closing is what "finishing" a work
  // order is; deletion is for records that should never have existed — a
  // duplicate, a test row, a job raised against the wrong plant — and those turn
  // up at every stage. The database decides whether it is allowed; this only
  // decides whether to offer it.
  const showDelete = canDeleteWorkOrder(wo, user, roleCan);

  return (
    <div className="max-w-5xl">
      <button onClick={() => router.push("/work-orders")} className="-my-2 -ml-1 mb-1 inline-flex min-h-[44px] items-center gap-1.5 rounded px-1 text-[13px] font-semibold text-ink-soft">
        <ArrowLeft size={15} /> Back to Work Orders
      </button>

      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="font-mono text-[13px] text-ink-soft">{wo.wo_number || "Pending…"}</span>
            <PriorityBadge p={wo.priority} />
            <StatusBadge s={wo.status} />
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-ink mt-1.5 break-words">{wo.asset_name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {showEdit && (
            <Button variant="ghost" icon={PencilLine} onClick={() => router.push(`/work-orders/edit?id=${woId}`)}>
              Edit
            </Button>
          )}
          {showDelete && (
            <Button variant="danger" icon={Trash2} onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
          <div className="flex items-center gap-2 rounded px-3.5 py-2.5" style={{ background: breached ? "#FCE9E9" : "#F6F8FB" }}>
            <Timer size={15} className={breached ? "text-danger" : "text-ink-soft"} />
            <div>
              <div className="text-[11px] text-ink-soft">Resolution SLA</div>
              <div className="font-mono text-[13px] font-bold" style={{ color: breached ? "#EF4444" : "#101828" }}>
                {wo.status === "closed" ? "Closed" : breached ? "Breached" : remain != null ? fmtDue(remain) + " left" : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Six tabs need ~700px, so on a phone this is a scrolling strip. Three
          things make that survivable rather than a place for controls to hide:
          the selected tab is scrolled into view, the tab holding a pending
          action carries a dot, and the container fades at its right edge while
          there is more to reach — a row that is merely cut off looks like a row
          that ends. `role="tablist"` and friends are what make the selection
          something other than a colour: it was an amber underline and nothing
          else, so a screen reader heard six unrelated buttons. */}
      <div className="relative -mx-4 mb-5 mt-4 sm:mx-0">
        <div
          ref={tabStripRef}
          role="tablist"
          aria-label="Work order sections"
          className="flex gap-1 overflow-x-auto border-b border-border px-4 no-scrollbar scroll-touch sm:px-0"
          onKeyDown={(e) => {
            /* Arrow keys are what `role="tablist"` promises. Without them the
               role is a claim the widget does not honour. */
            const i = TABS.findIndex((t) => t.key === tab);
            if (i < 0) return;
            let next = null;
            if (e.key === "ArrowRight") next = TABS[(i + 1) % TABS.length];
            else if (e.key === "ArrowLeft") next = TABS[(i - 1 + TABS.length) % TABS.length];
            else if (e.key === "Home") next = TABS[0];
            else if (e.key === "End") next = TABS[TABS.length - 1];
            if (!next) return;
            e.preventDefault();
            setTab(next.key);
            tabStripRef.current?.querySelector(`[data-tab="${next.key}"]`)?.focus();
          }}
        >
          {TABS.map((t) => {
            const isActive = tab === t.key;
            const flagged = t.key === "workflow" && actionIsYours;
            return (
              <button
                key={t.key}
                data-tab={t.key}
                role="tab"
                id={`wo-tab-${t.key}`}
                aria-selected={isActive}
                aria-controls={`wo-panel-${t.key}`}
                /* Only the selected tab is a tab stop; the arrow keys reach the
                   rest. That is the tablist pattern, and it also cuts five stops
                   out of every keyboard pass over this page. */
                tabIndex={isActive ? 0 : -1}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 text-[13.5px] font-semibold ${
                  isActive ? "text-ink" : "text-ink-soft"
                }`}
                style={{ borderBottom: isActive ? "2.5px solid #F59E0B" : "2.5px solid transparent" }}
              >
                {t.label}
                {flagged && (
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent"
                    /* The dot repeats what the panel says in words, so it is
                       decoration to a screen reader rather than a stray bullet. */
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
        {/* Purely a cue that the strip continues. pointer-events-none so it
            never swallows a tap meant for the tab underneath it. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas to-transparent sm:hidden" />
      </div>

      <Card className="p-4 sm:p-6">
        {TABS.map((t) => (
          <div
            key={t.key}
            role="tabpanel"
            id={`wo-panel-${t.key}`}
            aria-labelledby={`wo-tab-${t.key}`}
            hidden={tab !== t.key}
          >
            {tab === t.key && (
              <>
                {t.key === "overview" && <OverviewTab wo={wo} />}
                {t.key === "assignment" && <AssignPanel wo={wo} />}
                {t.key === "comments" && <CommentsPanel wo={wo} />}
                {t.key === "attachments" && <AttachmentsPanel wo={wo} />}
                {t.key === "timeline" && <StatusTimeline wo={wo} />}
                {t.key === "workflow" && <WorkflowPanel wo={wo} onGotoAssign={() => setTab("assignment")} />}
              </>
            )}
          </div>
        ))}
      </Card>

      {confirmingDelete && (
        <DeleteDialog
          wo={wo}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={() => router.replace("/work-orders")}
        />
      )}
    </div>
  );
}

/**
 * Type the WO number to confirm.
 *
 * A plain "Are you sure?" is the wrong control for the only irreversible action
 * in the module: it is dismissed reflexively, and the work orders most likely to
 * be deleted by mistake are the ones sitting next to the intended one in a list.
 * Retyping the number requires having read which record this is.
 */
function DeleteDialog({ wo, onClose, onDeleted }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // wo_number is assigned by a trigger, so a record raised seconds ago may not
  // have one yet. Falling back to the literal word keeps the confirmation from
  // degrading into an empty field that matches an empty input.
  const expected = wo.wo_number || "DELETE";
  const matches = typed.trim().toUpperCase() === expected.toUpperCase();

  async function submit(e) {
    e.preventDefault();
    if (!matches) return;
    setError(null);
    setBusy(true);
    try {
      await deleteWorkOrder(wo.id);
      onDeleted();
    } catch (err) {
      setError(describeError(err, "Couldn't delete that work order."));
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose} label="Delete work order" className="p-4">
      <Card className="rise max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">Delete this work order?</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="mb-4 flex items-start gap-2 rounded border border-[#EF444455] bg-[#FCE9E9] px-3.5 py-3 text-[12.5px] text-danger-text">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            <strong className="font-mono">{wo.wo_number || "This work order"}</strong> — {wo.asset_name} —
            and its comments, attachments, notifications and status history go with it. This cannot
            be undone. A record of the deletion is kept.
          </span>
        </div>

        <form onSubmit={submit}>
          <label className="mb-1.5 block text-[12.5px] font-semibold text-ink">
            Type <span className="font-mono">{expected}</span> to confirm
          </label>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mb-4 w-full rounded border border-[#D8DEE4] bg-white px-3 py-2.5 font-mono text-[13.5px] text-ink focus:border-navy focus:outline-none"
            autoComplete="off"
            aria-label="Work order number"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              icon={busy ? Loader2 : Trash2}
              disabled={busy || !matches}
            >
              {busy ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </form>
      </Card>
    </ModalOverlay>
  );
}

function OverviewTab({ wo }) {
  const { departmentName, impactLabel, typeLabel, slaForPriority } = useReferenceData();
  const sla = wo.priority ? slaForPriority(wo.priority) : null;
  // Area is omitted rather than shown as "—" when blank: every work order
  // raised before migration 0019 has none, and a column of dashes down an
  // otherwise complete overview reads as missing data rather than as a field
  // that did not exist yet.
  const rows = [
    // Department before Equipment, matching the order the raise form now asks in.
    ["Department", departmentName(wo.department_id)],
    ["Equipment", wo.asset_name],
    ...(wo.area ? [["Area", wo.area]] : []),
    ["Type", typeLabel(wo.type)],
    ["Production impact", impactLabel(wo.impact)],
    // Estimated downtime is no longer asked for, so new work orders carry
    // nothing here — and unguarded this printed the string "null null". Shown
    // only for the work orders raised while the field existed, exactly the way
    // Area above handles pre-0019 rows.
    ...(wo.est_downtime_value != null
      ? [
          [
            "Estimated downtime",
            // Printed "1 hours": the unit is stored plural, so singularise it
            // at the point of display rather than storing a second form.
            `${wo.est_downtime_value} ${
              Number(wo.est_downtime_value) === 1
                ? String(wo.est_downtime_unit ?? "").replace(/s$/, "")
                : wo.est_downtime_unit ?? ""
            }`.trim(),
          ],
        ]
      : []),
    ["Requested by", wo.requester_name],
    ["Requester phone", wo.requester_phone || "—"],
    ["Safety risk", wo.safety_risk?.flag ? `Yes (${wo.safety_risk.severity})` : "No"],
    ["Environmental risk", wo.environmental_risk?.flag ? "Yes" : "No"],
    ["Permit / LOTO required", wo.permit_required ? "Yes" : "No"],
  ];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
      <div className="min-w-0">
        {rows.map(([label, val]) => (
          <div key={label} className="flex justify-between gap-3 py-2.5 border-b border-[#F1F3F5] text-[13.5px]">
            <span className="flex-shrink-0 text-ink-soft">{label}</span>
            <span className="min-w-0 break-words text-ink font-medium text-right">{val}</span>
          </div>
        ))}
      </div>
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-ink mb-2">Complaint</div>
        <p className="text-[13.5px] text-ink leading-relaxed mb-5">{wo.description}</p>
        <div className="bg-canvas rounded p-3.5">
          <div className="text-[12px] font-bold text-ink mb-2.5">SLA targets ({wo.priority})</div>
          {sla &&
            [
              ["Acknowledge", sla.ack_target_label],
              ["Response", sla.response_target_label],
              ["Resolution", sla.resolution_target_label],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between text-[12.5px] py-1">
                <span className="text-ink-soft">{l}</span>
                <span className="font-mono font-semibold text-ink">{v}</span>
              </div>
            ))}
        </div>
        {wo.resolution_notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-[12px] font-bold text-good-text mb-1.5">Resolution notes</div>
            <div className="text-[13px] text-ink leading-relaxed">{wo.resolution_notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
