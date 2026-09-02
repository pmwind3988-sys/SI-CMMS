"use client";

/**
 * SI — Service Inside · Requester / Technician / Supervisor dashboard
 *
 * Replaces DashboardPlaceholder, which only ever confirmed that the role-based
 * redirect worked.
 *
 * Deliberately built on listenWorkOrderList(user, …) rather than the precomputed
 * stats rows the Manager and Admin dashboards read. Those rows are plant-wide
 * aggregates refreshed by pg_cron every fifteen minutes — the wrong shape and the
 * wrong freshness for "what do I need to do right now". The same listener already
 * scopes itself per role (requester -> their own, technician -> assigned to them,
 * supervisor -> their department), and RLS enforces the same thing server-side, so
 * these counts are exact, live, and cost one indexed query.
 *
 * The "needs you" queue is the point of the screen: each role has exactly one
 * status where work is waiting on them specifically.
 */
import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  CheckCircle2,
  UserCheck,
  ArrowRight,
  Inbox,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useReferenceData } from "../../lib/referenceData";
import { listenWorkOrderList } from "../../lib/workOrders";
import { fmtDue, slaRemainMs, slaWindowMs } from "../../lib/constants";
import { fmtDateTimeMY } from "../../lib/datetime";
import { ROLES, ROLE_LABELS } from "../../lib/roles";
import RoleSwitcher from "./RoleSwitcher";
import { PriorityBadge, StatusBadge } from "../ui/Badges";
import { Card, ErrorBanner, EmptyState } from "../ui/Surfaces";
import { usePaged, useAutoPageSize, PagerFooter } from "../ui/Paged";
import { describeError } from "../../lib/errors";
import StatCard from "./StatCard";
import CardDetail, { rowFromWorkOrder } from "./CardDetail";

/**
 * The one status where work is sitting on this role's desk, and `scope` — which
 * rows count as this role's at all.
 *
 * `scope` is not optional, and it applies to the whole dashboard rather than
 * only the attention card. It was implicit while RLS did the narrowing: a
 * Technician received only their own rows, so "status === assigned" could not
 * have matched anyone else's job and "Open" could not have counted anyone else's
 * work. A multi-role account (migration 0020) breaks that — listenWorkOrderList
 * gives a Supervisor+Technician the whole plant — so the Technician view
 * reported every unaccepted job in the plant as waiting on them personally and
 * every card under "Jobs assigned to you" counted jobs that were not.
 *
 * This narrows what is *displayed* and nothing else. The account still holds the
 * union server-side; scoping a view is not a permission, which is the line the
 * switcher must never cross.
 *
 * Supervisor scopes to everything on purpose. The unassigned queue is owned by
 * nobody yet — having no technician is precisely what puts it on their desk.
 */
const ATTENTION = {
  [ROLES.REQUESTER]: {
    status: "completed",
    scope: (w, uid) => w.requester_id === uid,
    heading: "Waiting for you to verify",
    blurb: "The technician says these are fixed. Confirm, or send them back.",
    cta: "Verify",
  },
  [ROLES.TECHNICIAN]: {
    status: "assigned",
    scope: (w, uid) => w.assigned_to_id === uid,
    heading: "Waiting for you to accept",
    blurb: "Accept to start, or decline with a reason so the Supervisor can reassign.",
    cta: "Open",
  },
  [ROLES.SUPERVISOR]: {
    status: "open",
    scope: () => true,
    heading: "Waiting for assignment",
    blurb: "These have no technician yet.",
    cta: "Assign",
  },
};

const HEADINGS = {
  [ROLES.REQUESTER]: { title: "My Work Orders", sub: "Everything you've raised, and what's happening with it." },
  [ROLES.TECHNICIAN]: { title: "My Tasks", sub: "Jobs assigned to you, and where each one stands." },
  // Not "Department Dashboard" since migration 0019 — a Supervisor covers the
  // whole plant, and listenWorkOrderList gives them every row a Manager sees.
  // Naming a department here claimed a filter these figures do not apply.
  [ROLES.SUPERVISOR]: { title: "Supervisor Dashboard", sub: "The plant's queue, assignments and SLA health." },
};

/**
 * Statuses that are not "still open work", and therefore never a slice of the
 * Open card. `verified` is in the list for completeness and cannot actually
 * occur — it is a history state, never a resting one (see the FSD) — while
 * `closed` is the one status the open set is defined by excluding.
 */
const NOT_OPEN = ["closed", "verified"];

/**
 * @param viewRole  Which role this screen is presenting. An account may hold
 *   several (migration 0020) and has a distinct queue under each, so the page
 *   says which one it is rather than this component assuming the highest.
 *   Defaults to the highest held, which is what a single-role account has.
 */
export default function RoleDashboard({ viewRole }) {
  const { user } = useAuth();
  const { ready, statusFlow, statusLabel, statusColor } = useReferenceData();
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState(null);
  const [error, setError] = useState(null);
  const [drill, setDrill] = useState(null); // the key of the card whose rows are open

  useEffect(() => {
    if (!user) return;
    const unsub = listenWorkOrderList(
      user,
      setWorkOrders,
      (e) => setError(describeError(e, "Couldn't load your work orders."))
    );
    return unsub;
  }, [user]);

  const view = viewRole ?? user?.role;
  const attention = ATTENTION[view] ?? ATTENTION[ROLES.REQUESTER];
  const headings = HEADINGS[view] ?? HEADINGS[ROLES.REQUESTER];

  const stats = useMemo(() => {
    // Scoped to the role being viewed, not to everything this account may read.
    // Every card, the recent list and each drill-down are built from this one
    // array, so none of them can disagree with the heading above them.
    const rows = (workOrders ?? []).filter((w) => attention.scope(w, user?.uid));
    const open = rows.filter((w) => w.status !== "closed");

    /* The stored deadline, shared with the list and the detail page — see
       slaRemainMs(). A P7 whose resolution clock has not started counts as
       neither overdue nor at risk, which is correct: nothing has been promised
       about it yet. */
    const remainMs = slaRemainMs;

    const overdue = open.filter((w) => {
      const r = remainMs(w);
      return r != null && r < 0;
    });

    // "At risk" mirrors si_sla_warning_sweep(): under a quarter of the window
    // left, where the window is `due - created_at` exactly as the sweep computes
    // it — which is what keeps the two thresholds in the same place on a
    // sequential priority, whose window spans the stages before it.
    const atRisk = open.filter((w) => {
      const r = remainMs(w);
      if (r == null || r < 0) return false;
      const windowMs = slaWindowMs(w);
      return windowMs != null && r < windowMs * 0.25;
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    /* One entry per status that is actually holding open work, in workflow
       order, each keeping its own rows.
     *
     * Derived from the ROWS and then ordered by `statusFlow`, not built by
     * walking `statusFlow` and counting. Walking the table looks equivalent and
     * silently loses work: `statusFlow` is the ACTIVE statuses, and a status
     * retired from wo_statuses can still be sitting on a work order raised
     * before it was retired — `on_the_way` and `on_site` went in migration
     * 0039 and rows still carry them. Measured on the test project: the
     * table-driven version showed six chips totalling 12 against an Open figure
     * of 16, with an `on_the_way` job counted by neither. Anything unranked
     * sorts to the end rather than disappearing, which is the same reason
     * statusLabel() resolves against every row instead of the active ones.
     *
     * A status with nothing in it is absent rather than shown as zero: a
     * Technician can never hold an `open` work order — it is assigned to nobody
     * — so a permanent "Open 0" chip would be noise on every load. */
    const rank = new Map((statusFlow ?? []).map((code, i) => [code, i]));
    const byStatus = [...new Set(open.map((w) => w.status))]
      .filter((code) => code && !NOT_OPEN.includes(code))
      .sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER))
      .map((code) => ({ code, rows: open.filter((w) => w.status === code) }));

    /* Newest activity first, not newest raised. The query orders by created_at
       (it is the indexed column and the list wants it), so the sort happens
       here on the loaded rows. `updated_at` is maintained by the
       touch_work_orders trigger, so it moves on every transition, edit and
       re-grade — see the note on the Recent heading about whose activity it
       records. */
    const recent = [...rows]
      .sort((a, b) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at))
      .slice(0, 8);

    // Each card keeps the rows it counted, not just the count — the drill-down
    // is then the same array, so a card and its list cannot disagree.
    return {
      total: rows.length,
      open,
      needsMe: rows.filter((w) => w.status === attention.status),
      byStatus,
      overdue,
      atRisk,
      closedToday: rows.filter(
        (w) => w.status === "closed" && w.closed_at && new Date(w.closed_at) >= startOfToday
      ),
      recent,
      remainMs,
    };
  }, [workOrders, attention, user?.uid, statusFlow]);

  const loading = workOrders === null || !ready;

  /* The attention list is the only uncapped strip on this screen - `recent` is
     already sliced to 8. Keyed on the role being viewed: the switcher changes
     which queue this is, so it should start at the top again. The count beside
     the heading still prints `stats.needsMe.length`, the real total. */
  const needsMeRef = useRef(null);
  /* Capped at 10 however tall the screen is: this strip has the stat cards above
     it and the Recent list below, so filling the viewport with it would push the
     rest of the dashboard off the bottom. */
  const needsMeSize = useAutoPageSize(needsMeRef, { min: 3, max: 10, ready: !loading, signature: stats.needsMe.length });

  const needsMePager = usePaged(stats.needsMe, { pageSize: needsMeSize, resetKey: view });

  /* Label, colour and the rows behind each figure, in one place so the card and
     its drill-down are built from the same entry. */
  /* Two headline cards, and then everything else as a slice OF the Open card.
   *
   * They were six equal cards in a row until now, which read as six separate
   * piles of work — and four of them were views of one pile: `overdue`,
   * `atRisk` and every status count are all computed FROM `open`. On a real
   * technician dashboard that showed "Open 16" beside "Overdue 16", which looks
   * like thirty-two jobs and is sixteen.
   *
   * The slices deliberately do NOT add up to the Open figure, and the panel says
   * "of these" rather than printing a sum: an overdue job is also sitting in one
   * of the status chips, so the two kinds of slice overlap by construction.
   * Claiming a total would be a claim the numbers themselves contradict on the
   * first breach. */
  const headline = [
    {
      key: "needsMe",
      icon: Inbox,
      label: attention.heading,
      color: "#F59E0B",
      rows: stats.needsMe,
      blurb: attention.blurb,
    },
    {
      key: "closedToday",
      icon: CheckCircle2,
      label: "Closed today",
      color: "#22C55E",
      rows: stats.closedToday,
      title: "Closed since midnight",
      blurb: "Verified and closed today, in your scope.",
    },
  ];

  const openEntry = {
    key: "open",
    icon: ClipboardList,
    label: "Open",
    rows: stats.open,
    title: "Not yet closed",
    blurb: "Everything still in flight in your scope.",
  };

  /* Where the work sits in the workflow, then how its clock is doing. The two
     SLA slices come last and are rendered even at zero, because "none at risk"
     is an answer somebody wants — where an absent status chip only ever means
     nothing is parked at that stage. */
  const slices = [
    ...stats.byStatus.map((s) => ({
      key: `status:${s.code}`,
      label: statusLabel(s.code),
      color: statusColor(s.code),
      rows: s.rows,
      title: statusLabel(s.code),
      blurb: "Open work orders sitting at this stage of the workflow.",
    })),
    {
      key: "atRisk",
      label: "SLA at risk",
      color: "#F59E0B",
      rows: stats.atRisk,
      title: "Under a quarter of the SLA window left",
      blurb: "The same threshold the warning sweep uses before it notifies anyone.",
    },
    {
      key: "overdue",
      label: "Overdue",
      color: "#EF4444",
      rows: stats.overdue,
      title: "Past the resolution deadline",
      blurb: "Still open with the SLA window already spent.",
    },
  ];

  const openCard = [...headline, openEntry, ...slices].find((c) => c.key === drill) || null;

  return (
    <div className="max-w-6xl">
      <RoleSwitcher current={view} />
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink mb-0.5">{headings.title}</h1>
        <p className="text-[13px] text-ink-soft">
          {headings.sub}
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {headline.map((c) => (
          <StatCard
            key={c.key}
            icon={c.icon}
            label={c.label}
            color={c.color}
            value={c.rows.length}
            loading={loading}
            onClick={loading ? undefined : () => setDrill(c.key)}
          />
        ))}
      </div>

      {/* Open, and the slices of it. One card so the relationship is structural
          rather than something the reader has to infer from six equal boxes. */}
      <Card className="mb-6 overflow-hidden">
        <button
          type="button"
          onClick={loading ? undefined : () => setDrill("open")}
          disabled={loading}
          aria-label={`Open: ${loading ? "loading" : stats.open.length}. Show the records behind this.`}
          className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-navy disabled:hover:bg-white"
        >
          <ClipboardList size={17} className="flex-shrink-0 text-navy" />
          <span className="text-[13.5px] font-bold text-ink">Open</span>
          {loading ? (
            <span className="h-6 w-10 animate-pulse rounded bg-canvas" />
          ) : (
            <span className="font-mono text-[22px] font-bold leading-none text-ink">{stats.open.length}</span>
          )}
          <span className="text-[12.5px] text-ink-soft">still in flight</span>
          <ArrowRight
            size={14}
            className="ml-auto flex-shrink-0 text-ink-soft transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>

        {!loading && stats.open.length > 0 && (
          <div className="border-t border-border bg-[#FBFCFD] px-4 py-3">
            <p className="mb-2 text-[11.5px] font-semibold text-ink-soft">
              Of these — a job can appear in a stage and in an SLA figure both:
            </p>
            <div className="flex flex-wrap gap-2">
              {slices.map((s) => (
                <SliceChip
                  key={s.key}
                  label={s.label}
                  color={s.color}
                  value={s.rows.length}
                  onClick={() => setDrill(s.key)}
                />
              ))}
            </div>
          </div>
        )}
      </Card>

      {openCard && (
        <CardDetail
          title={openCard.title || openCard.label}
          blurb={openCard.blurb}
          rows={openCard.rows.map((w) => rowFromWorkOrder(w, stats.remainMs))}
          emptyText="Nothing here at the moment."
          onClose={() => setDrill(null)}
        />
      )}

      {/* The actionable queue. */}
      <Card className="mb-6 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <UserCheck size={15} className="text-accent" />
            <span className="text-[13.5px] font-bold text-ink">{attention.heading}</span>
            {!loading && stats.needsMe.length > 0 && (
              <span className="bg-accent text-ink text-[11px] font-bold rounded-full px-2 py-0.5">
                {stats.needsMe.length}
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-ink-soft mt-0.5">{attention.blurb}</p>
        </div>

        {loading && <div className="px-4 py-5 text-[13px] text-ink-soft">Loading…</div>}

        {!loading && stats.needsMe.length === 0 && (
          <EmptyState>Nothing waiting on you right now.</EmptyState>
        )}

        {/* Five columns need ~520px; a 360px phone gives the row about 296px, which
            left roughly 50px for the equipment name. Below `sm` the assignee and
            SLA drop under the title instead of taking columns of their own, and
            the CTA collapses to its arrow. */}
        <div ref={needsMeRef}>
        {!loading &&
          needsMePager.visible.map((w, i) => (
            <button
              key={w.id}
              onClick={() => router.push(`/work-orders/view?id=${w.id}`)}
              className={`w-full flex items-center gap-2 sm:gap-3 px-4 py-3 text-left hover:bg-canvas ${
                i === 0 ? "" : "border-t border-[#F1F3F5]"
              }`}
            >
              <div className="flex-[2] min-w-0">
                <div className="font-mono text-[11.5px] text-ink-soft">{w.wo_number || "Pending…"}</div>
                <div className="text-[13.5px] text-ink font-medium truncate">{w.asset_name}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-soft sm:hidden">
                  <span className="truncate">{w.assigned_to_name || "Unassigned"}</span>
                  <span aria-hidden="true">·</span>
                  <SlaText w={w} remainMs={stats.remainMs} />
                </div>
              </div>
              <div className="w-14 flex-shrink-0">
                <PriorityBadge p={w.priority} size="sm" />
              </div>
              <div className="flex-1 text-[12.5px] text-ink-soft truncate hidden sm:block">
                {w.assigned_to_name || "Unassigned"}
              </div>
              <div className="hidden sm:block">
                <SlaCell w={w} remainMs={stats.remainMs} />
              </div>
              <span className="text-accent-text font-semibold text-[12.5px] flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
                <span className="hidden xs:inline">{attention.cta}</span> <ArrowRight size={13} />
              </span>
            </button>
          ))}
        </div>

        {!loading && <PagerFooter pager={needsMePager} noun="work orders" />}
      </Card>

      {/* Recent activity. */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <span className="text-[13.5px] font-bold text-ink">Recent activity</span>
            {/* Named for what the column actually measures. `updated_at` moves on
                every write to the row — a transition, an edit, a supervisor's
                re-grade — so it is the last time ANYTHING happened to the work
                order, not the last time this person touched it. Calling it "last
                modified by you" would be a claim nothing in the row supports;
                measuring that would mean reading work_order_history per row. */}
            <p className="truncate text-[11.5px] text-ink-soft">Most recently updated first.</p>
          </div>
          <button
            onClick={() => router.push("/work-orders")}
            className="text-[12.5px] font-semibold text-navy flex items-center gap-1"
          >
            See all <ArrowRight size={13} />
          </button>
        </div>

        {/* Two dates side by side are unreadable without saying which is which.
            Only rendered where the columns themselves are. */}
        {!loading && stats.recent.length > 0 && (
          <div className="hidden md:flex items-center gap-3 border-b border-border bg-[#FBFCFD] px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-soft">
            <div className="flex-[2]">Work order</div>
            <div className="w-14 flex-shrink-0">Priority</div>
            <div className="flex-[1.3]">Status</div>
            <div className="w-[124px] text-right">Last activity</div>
            <div className="w-[124px] text-right">Raised</div>
            <div className="w-24 text-right">SLA</div>
          </div>
        )}

        {loading && <div className="px-4 py-5 text-[13px] text-ink-soft">Loading…</div>}

        {!loading && stats.recent.length === 0 && (
          <EmptyState>
            {view === ROLES.REQUESTER
              ? "You haven't raised any work orders yet."
              : view === ROLES.TECHNICIAN
                ? "No tasks have been assigned to you yet."
                : "No work orders in your department yet."}
          </EmptyState>
        )}

        {!loading &&
          stats.recent.map((w, i) => (
            <button
              key={w.id}
              onClick={() => router.push(`/work-orders/view?id=${w.id}`)}
              className={`w-full flex items-center gap-2 sm:gap-3 px-4 py-2.5 text-left hover:bg-canvas ${
                i === 0 ? "" : "border-t border-[#F1F3F5]"
              }`}
            >
              <div className="flex-[2] min-w-0">
                <div className="font-mono text-[11px] text-ink-soft">{w.wo_number || "Pending…"}</div>
                <div className="text-[13px] text-ink truncate">{w.asset_name}</div>
                <div className="mt-0.5 text-[11.5px] text-ink-soft sm:hidden">
                  <SlaText w={w} remainMs={stats.remainMs} />
                </div>
                {/* The narrow-screen stand-in for the two date columns. Labelled,
                    because a bare timestamp under a title reads as the raise
                    time and this one is usually not. */}
                <div className="mt-0.5 truncate text-[11px] text-ink-soft md:hidden">
                  Updated {fmtDateTimeMY(w.updated_at ?? w.created_at)} · raised {fmtDateTimeMY(w.created_at)}
                </div>
              </div>
              <div className="w-14 flex-shrink-0">
                <PriorityBadge p={w.priority} size="sm" />
              </div>
              <div className="flex-shrink-0 sm:flex-[1.3]">
                <StatusBadge s={w.status} />
              </div>
              {/* Both stamps in plant time (lib/datetime), not the device's, so
                  two people looking at the same job read the same clock. From
                  `md` up as their own columns; below that they stack under the
                  equipment name, where five columns already do not fit. */}
              <div className="hidden md:block w-[124px] text-right text-[11.5px] text-ink-soft">
                {fmtDateTimeMY(w.updated_at ?? w.created_at)}
              </div>
              <div className="hidden md:block w-[124px] text-right text-[11.5px] text-ink-soft">
                {fmtDateTimeMY(w.created_at)}
              </div>
              <div className="hidden sm:block">
                <SlaCell w={w} remainMs={stats.remainMs} />
              </div>
            </button>
          ))}
      </Card>

      <p className="text-[11.5px] text-ink-soft mt-4">
        Signed in as {user?.name} · {ROLE_LABELS[view] || view}. These figures are your
        own scope — You only ever see the work orders your role covers.
      </p>
    </div>
  );
}

/**
 * One slice of the Open card: a label, its count, and the same drill-down every
 * stat card opens.
 *
 * A chip rather than a card of its own, and that is the whole point of the
 * change — a card sitting beside Open claims to be a separate figure, where a
 * chip inside it reads as part of it. The dot carries the status's own colour
 * from wo_statuses, so a chip and the StatusBadge on the row it opens are the
 * same colour rather than two vocabularies for one status.
 */
function SliceChip({ label, value, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}. Show the records behind this.`}
      className="flex items-center gap-1.5 rounded-full border border-border bg-white py-1 pl-2 pr-2.5 text-left transition-colors hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-navy"
    >
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: color || "#64748B" }}
        aria-hidden="true"
      />
      <span className="text-[12px] text-ink-soft">{label}</span>
      <span className="font-mono text-[13px] font-bold text-ink">{value}</span>
    </button>
  );
}

/** The 96px-wide SLA column used from `sm` up. */
function SlaCell({ w, remainMs }) {
  return (
    <div className="w-24 text-right">
      <SlaText w={w} remainMs={remainMs} />
    </div>
  );
}

/**
 * The same value with no column width of its own, so it can sit inline under the
 * equipment name on a phone where there is no room for a fifth column.
 */
function SlaText({ w, remainMs }) {
  const remain = w.status === "closed" ? null : remainMs(w);
  if (w.status === "closed" || remain == null) {
    return <span className="font-mono text-[11.5px] text-ink-soft">—</span>;
  }
  const late = remain < 0;
  return (
    <span
      className="font-mono text-[11.5px]"
      style={{ color: late ? "#EF4444" : "#64748B", fontWeight: late ? 700 : 400 }}
    >
      {late ? "Breached" : `${fmtDue(remain)} left`}
    </span>
  );
}
