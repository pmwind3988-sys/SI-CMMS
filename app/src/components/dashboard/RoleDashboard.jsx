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
import { PriorityBadge, StatusBadge } from "../ui/Badges";
import { Card, ErrorBanner, EmptyState } from "../ui/Surfaces";
import { describeError } from "../../lib/errors";
import StatCard from "./StatCard";

/** The one status where work is sitting on this role's desk. */
const ATTENTION = {
  [ROLES.REQUESTER]: {
    status: "completed",
    heading: "Waiting for you to verify",
    blurb: "The technician says these are fixed. Confirm, or send them back.",
    cta: "Verify",
  },
  [ROLES.TECHNICIAN]: {
    status: "assigned",
    heading: "Waiting for you to accept",
    blurb: "Accept to start, or decline with a reason so the Supervisor can reassign.",
    cta: "Open",
  },
  [ROLES.SUPERVISOR]: {
    status: "open",
    heading: "Waiting for assignment",
    blurb: "These have no technician yet.",
    cta: "Assign",
  },
};

const HEADINGS = {
  [ROLES.REQUESTER]: { title: "My Work Orders", sub: "Everything you've raised, and what's happening with it." },
  [ROLES.TECHNICIAN]: { title: "My Tasks", sub: "Jobs assigned to you, newest first." },
  [ROLES.SUPERVISOR]: { title: "Department Dashboard", sub: "Your department's queue, assignments and SLA health." },
};

// Statuses where a technician is actively working the job.
const IN_PROGRESS = ["accepted", "on_the_way", "on_site", "repairing", "testing"];

export default function RoleDashboard() {
  const { user } = useAuth();
  const { slaForPriority, ready } = useReferenceData();
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return;
    const unsub = listenWorkOrderList(
      user,
      setWorkOrders,
      (e) => setError(describeError(e, "Couldn't load your work orders."))
    );
    return unsub;
  }, [user]);

  const attention = ATTENTION[user?.role] ?? ATTENTION[ROLES.REQUESTER];
  const headings = HEADINGS[user?.role] ?? HEADINGS[ROLES.REQUESTER];

  const stats = useMemo(() => {
    const rows = workOrders ?? [];
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

    return {
      total: rows.length,
      open: open.length,
      needsMe: rows.filter((w) => w.status === attention.status),
      inProgress: open.filter((w) => IN_PROGRESS.includes(w.status)).length,
      overdue: overdue.length,
      atRisk: atRisk.length,
      closedToday: rows.filter(
        (w) => w.status === "closed" && w.closed_at && new Date(w.closed_at) >= startOfToday
      ).length,
      recent: [...rows].slice(0, 8),
      remainMs,
    };
  }, [workOrders, slaForPriority, attention.status]);

  const loading = workOrders === null || !ready;

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-ink mb-0.5">{headings.title}</h1>
        <p className="text-[13px] text-ink-soft">
          {headings.sub}
          {user?.role === ROLES.SUPERVISOR && user?.departmentId ? ` · ${user.departmentId}` : ""}
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <StatCard
          icon={Inbox}
          label={attention.heading}
          value={stats.needsMe.length}
          color="#F59E0B"
          loading={loading}
        />
        <StatCard icon={ClipboardList} label="Open" value={stats.open} loading={loading} />
        <StatCard icon={Wrench} label="In progress" value={stats.inProgress} color="#F59E0B" loading={loading} />
        <StatCard icon={Clock} label="SLA at risk" value={stats.atRisk} color="#F59E0B" loading={loading} />
        <StatCard icon={AlertOctagon} label="Overdue" value={stats.overdue} color="#EF4444" loading={loading} />
        <StatCard icon={CheckCircle2} label="Closed today" value={stats.closedToday} color="#22C55E" loading={loading} />
      </div>

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
            {user?.role === ROLES.REQUESTER
              ? "You haven't raised any work orders yet."
              : user?.role === ROLES.TECHNICIAN
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
        Signed in as {user?.name} · {ROLE_LABELS[user?.role] || user?.role}. These figures are your
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
