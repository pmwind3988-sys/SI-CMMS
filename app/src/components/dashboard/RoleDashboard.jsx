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
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Clock,
  AlertOctagon,
  CheckCircle2,
  Wrench,
  UserCheck,
  ArrowRight,
  Inbox,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useReferenceData } from "../../lib/referenceData";
import { listenWorkOrderList } from "../../lib/workOrders";
import { fmtDue } from "../../lib/constants";
import { ROLES, ROLE_LABELS } from "../../lib/roles";
import RoleSwitcher from "./RoleSwitcher";
import { PriorityBadge, StatusBadge } from "../ui/Badges";
import { Card, ErrorBanner, EmptyState } from "../ui/Surfaces";
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
  [ROLES.TECHNICIAN]: { title: "My Tasks", sub: "Jobs assigned to you, newest first." },
  // Not "Department Dashboard" since migration 0019 — a Supervisor covers the
  // whole plant, and listenWorkOrderList gives them every row a Manager sees.
  // Naming a department here claimed a filter these figures do not apply.
  [ROLES.SUPERVISOR]: { title: "Supervisor Dashboard", sub: "The plant's queue, assignments and SLA health." },
};

// Statuses where a technician is actively working the job. `on_the_way` and
// `on_site` are gone since migration 0039 — no work order can hold either, so
// naming them here would be a list guarding against a state that cannot occur.
const IN_PROGRESS = ["accepted", "repairing", "testing"];

/**
 * @param viewRole  Which role this screen is presenting. An account may hold
 *   several (migration 0020) and has a distinct queue under each, so the page
 *   says which one it is rather than this component assuming the highest.
 *   Defaults to the highest held, which is what a single-role account has.
 */
export default function RoleDashboard({ viewRole }) {
  const { user } = useAuth();
  const { slaForPriority, ready } = useReferenceData();
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
    //
    // Test data is dropped HERE, at that single point, rather than only from the
    // card arithmetic (migration 0034). Filtering the counts but not the rows
    // behind them would produce precisely the disagreement the paragraph above
    // exists to prevent: a card reading 4 opening a list of 5. This is a
    // dashboard, so the rule is the same one the server-side aggregate follows —
    // statistics exclude test data. The Work Orders list is the record and still
    // shows every row, tagged "Demo", which is where you go to find one.
    //
    // Only the Supervisor view could ever contain one: the requester and
    // technician scopes are `requester_id === uid` / `assigned_to_id === uid`, so
    // a real person's own dashboard cannot hold a fixture's work. Supervisor is
    // `() => true` since 0019, which is what let the demo seed in.
    const rows = (workOrders ?? [])
      .filter((w) => !w.is_test_data)
      .filter((w) => attention.scope(w, user?.uid));
    const open = rows.filter((w) => w.status !== "closed");

    const remainMs = (w) => {
      const sla = slaForPriority(w.priority);
      if (!sla?.resolution_target_minutes || !w.created_at) return null;
      return sla.resolution_target_minutes * 60000 - (Date.now() - new Date(w.created_at).getTime());
    };

    const overdue = open.filter((w) => {
      const r = remainMs(w);
      return r != null && r < 0;
    });

    // "At risk" mirrors si_sla_warning_sweep(): under a quarter of the window left.
    const atRisk = open.filter((w) => {
      const r = remainMs(w);
      if (r == null || r < 0) return false;
      const sla = slaForPriority(w.priority);
      return r < sla.resolution_target_minutes * 60000 * 0.25;
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Each card keeps the rows it counted, not just the count — the drill-down
    // is then the same array, so a card and its list cannot disagree.
    return {
      total: rows.length,
      open,
      needsMe: rows.filter((w) => w.status === attention.status),
      inProgress: open.filter((w) => IN_PROGRESS.includes(w.status)),
      overdue,
      atRisk,
      closedToday: rows.filter(
        (w) => w.status === "closed" && w.closed_at && new Date(w.closed_at) >= startOfToday
      ),
      recent: [...rows].slice(0, 8),
      remainMs,
    };
  }, [workOrders, slaForPriority, attention, user?.uid]);

  const loading = workOrders === null || !ready;

  /* Label, colour and the rows behind each figure, in one place so the card and
     its drill-down are built from the same entry. */
  const cards = [
    {
      key: "needsMe",
      icon: Inbox,
      label: attention.heading,
      color: "#F59E0B",
      rows: stats.needsMe,
      blurb: attention.blurb,
    },
    {
      key: "open",
      icon: ClipboardList,
      label: "Open",
      rows: stats.open,
      title: "Not yet closed",
      blurb: "Everything still in flight in your scope.",
    },
    {
      key: "inProgress",
      icon: Wrench,
      label: "In progress",
      color: "#F59E0B",
      rows: stats.inProgress,
      title: "A technician is on these",
      blurb: "Accepted through to testing.",
    },
    {
      key: "atRisk",
      icon: Clock,
      label: "SLA at risk",
      color: "#F59E0B",
      rows: stats.atRisk,
      title: "Under a quarter of the SLA window left",
      blurb: "The same threshold the warning sweep uses before it notifies anyone.",
    },
    {
      key: "overdue",
      icon: AlertOctagon,
      label: "Overdue",
      color: "#EF4444",
      rows: stats.overdue,
      title: "Past the resolution deadline",
      blurb: "Still open with the SLA window already spent.",
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

  const openCard = cards.find((c) => c.key === drill) || null;

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

      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {cards.map((c) => (
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
        {!loading &&
          stats.needsMe.map((w, i) => (
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
              <span className="text-accent font-semibold text-[12.5px] flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
                <span className="hidden xs:inline">{attention.cta}</span> <ArrowRight size={13} />
              </span>
            </button>
          ))}
      </Card>

      {/* Recent activity. */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-[13.5px] font-bold text-ink">Recent</span>
          <button
            onClick={() => router.push("/work-orders")}
            className="text-[12.5px] font-semibold text-navy flex items-center gap-1"
          >
            See all <ArrowRight size={13} />
          </button>
        </div>

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
              </div>
              <div className="w-14 flex-shrink-0">
                <PriorityBadge p={w.priority} size="sm" />
              </div>
              <div className="flex-shrink-0 sm:flex-[1.3]">
                <StatusBadge s={w.status} />
              </div>
              <div className="hidden sm:block">
                <SlaCell w={w} remainMs={stats.remainMs} />
              </div>
            </button>
          ))}
      </Card>

      <p className="text-[11.5px] text-ink-soft mt-4">
        Signed in as {user?.name} · {ROLE_LABELS[view] || view}. These figures are your
        own scope — Row Level Security means you only ever see work orders your role covers.
      </p>
    </div>
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
