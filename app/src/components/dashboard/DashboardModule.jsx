"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  AlertTriangle,
  AlertOctagon,
  AlertCircle,
  Info,
  CheckCircle2,
  Clock,
  Timer,
  Wrench,
  Users,
  RefreshCw,
  CalendarClock,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenDashboardCards, listenDashboardChartsRange, listenDashboardCardRows, refreshDashboardStatsNow } from "../../lib/dashboard";
import { resolveChartPeriod, periodSubtitle, periodScope, DEFAULT_PERIOD } from "../../lib/chartPeriods";
import { ELEVATED_ROLES, hasAnyRole } from "../../lib/roles";
import { describeError } from "../../lib/errors";
import StatCard from "./StatCard";
import CardDetail, { rowFromRpc } from "./CardDetail";
import WorkOrderTrendChart from "./WorkOrderTrendChart";
import DepartmentBreakdownChart from "./DepartmentBreakdownChart";
import MachineBreakdownChart from "./MachineBreakdownChart";
import TechnicianPerformanceChart from "./TechnicianPerformanceChart";
import RoleSwitcher from "./RoleSwitcher";
import ChartPeriodControl from "./ChartPeriodControl";
import { ErrorBanner } from "../ui/Surfaces";

function fmtMinutes(mins) {
  if (!mins) return "0";
  if (mins < 60) return String(mins);
  return (mins / 60).toFixed(1);
}
function unitFor(mins) {
  return mins && mins >= 60 ? "hrs" : "min";
}

/**
 * One entry per card. `key` is both the field in the precomputed stats payload
 * and the argument si_dashboard_card_rows() takes, which is what stops the
 * drill-down from drifting away from the figure it was opened from.
 */
const CARDS = [
  {
    key: "total_open",
    label: "Total Open Work Orders",
    icon: ClipboardList,
    color: "#0F3D91",
    title: "Open work orders",
    blurb: "Everything not yet closed, soonest resolution deadline first.",
  },
  {
    key: "p1_critical",
    label: "P1 Critical",
    icon: AlertOctagon,
    color: "#EF4444",
    title: "Open P1 — Critical",
    blurb: "Open work orders at the highest priority.",
  },
  {
    key: "p2_high",
    label: "P2 High",
    icon: AlertTriangle,
    color: "#F59E0B",
    title: "Open P2 — High",
    blurb: "Open work orders at high priority.",
  },
  {
    key: "p3_medium",
    label: "P3 Medium",
    icon: AlertCircle,
    color: "#FBBF24",
    title: "Open P3 — Medium",
    blurb: "Open work orders at medium priority.",
  },
  {
    key: "p4_low",
    label: "P4 Low",
    icon: Info,
    color: "#0F3D91",
    title: "Open P4 — Low",
    blurb: "Open work orders at low priority.",
  },
  /* Migration 0050. Without this card a P7 would be counted in Total Open and
     in none of the priority bands, so the four bands would visibly stop adding
     up to the total — and long-term work, which is exactly the kind that sits
     unattended, would be the work with no figure watching it. */
  {
    key: "p7_long_term",
    label: "P7 Long-term",
    icon: CalendarClock,
    color: "#7C3AED",
    title: "Open P7 — Long-term",
    blurb: "Planned long-term tasks. Measured in days, in stages, not from when they were raised.",
  },
  {
    key: "completed_today",
    label: "Completed Today",
    icon: CheckCircle2,
    color: "#22C55E",
    title: "Closed since midnight",
    blurb: "Counted on closure, not on the technician marking the repair complete.",
  },
  {
    key: "overdue",
    label: "Overdue",
    icon: Clock,
    color: "#EF4444",
    title: "Past their SLA",
    blurb: "Open work orders the breach sweep has already flagged.",
  },
  {
    key: "avg_response_minutes",
    label: "Avg. Response Time",
    icon: Timer,
    color: "#1E4FA0",
    format: (c) => ({ value: fmtMinutes(c?.avg_response_minutes), unit: unitFor(c?.avg_response_minutes) }),
    title: "Raise → accept, per acceptance",
    blurb: "Every acceptance in the audit trail — the rows this average is taken over.",
  },
  {
    key: "avg_repair_minutes",
    label: "Avg. Repair Time",
    icon: Wrench,
    color: "#1E4FA0",
    format: (c) => ({ value: fmtMinutes(c?.avg_repair_minutes), unit: unitFor(c?.avg_repair_minutes) }),
    title: "Raise → close, per work order",
    blurb: "Finished work orders and how long each one took end to end.",
  },
  {
    key: "active_technicians",
    label: "Active Technicians",
    icon: Users,
    color: "#22C55E",
    title: "Technicians carrying open work",
    blurb: "One row per technician, with the open load that made them count.",
    metricUnit: "open",
  },
];

export default function DashboardModule() {
  const { user } = useAuth();
  const [cards, setCards] = useState(null);
  const [charts, setCharts] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [drill, setDrill] = useState(null); // a CARDS entry
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD);
  const [custom, setCustom] = useState(null);

  /* Resolved once per choice rather than on every render: it reads the clock,
     and a period recomputed mid-render would re-run the subscription below
     every time anything else on this page changed. */
  const period = useMemo(() => resolveChartPeriod(periodKey, custom), [periodKey, custom]);

  useEffect(() => {
    return listenDashboardCards(setCards, () => setError("Couldn't load dashboard metrics."));
  }, []);

  /* Keyed on the resolved edges, not on the preset name, so a custom range
     that changes by a day re-runs and one that does not, does not. */
  useEffect(() => {
    setCharts(null);
    return listenDashboardChartsRange(period, setCharts, () =>
      setError("Couldn't load dashboard charts for that period.")
    );
  }, [period?.from, period?.to, period?.bucket]);

  const canRefresh = hasAnyRole(user, ELEVATED_ROLES);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshDashboardStatsNow();
    } catch (e) {
      setError(describeError(e, "Couldn't refresh right now — try again in a moment."));
    } finally {
      setRefreshing(false);
    }
  }

  const loading = !cards;
  const snapshotAt =
    cards?.updated_at && !Number.isNaN(Date.parse(cards.updated_at))
      ? new Date(cards.updated_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <div>
      {/* Manager and Admin land here; a Manager+Supervisor reaches their other
          queue from this strip. Renders nothing for a single-role account. */}
      <RoleSwitcher current={user?.role} />
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink mb-0.5">Dashboard</h1>
          <p className="text-[13px] text-ink-soft">
            {snapshotAt ? `Last updated ${snapshotAt} · tap any card for the records behind it` : "Loading…"}
          </p>
        </div>
        {canRefresh && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[12.5px] font-semibold text-navy disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ---- CARDS: responsive grid — up to 5 cols on desktop, 2 on a phone,
           and one below 340px, where half of a 320px screen leaves ~95px for a
           label like "Total Open Work Orders" and it wrapped a word per line.
           Full width it fits on one line, so the single column is the shorter
           card, not the taller one. ---- */}
      <div className="mb-6 grid grid-cols-1 gap-3 min-[340px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {CARDS.map((c) => {
          const shaped = c.format ? c.format(cards) : { value: cards?.[c.key] ?? 0 };
          return (
            <StatCard
              key={c.key}
              icon={c.icon}
              label={c.label}
              color={c.color}
              loading={loading}
              value={shaped.value}
              unit={shaped.unit}
              onClick={() => setDrill(c)}
            />
          );
        })}
      </div>

      {/* ---- CHARTS: 1 column on mobile, 2 columns on desktop. `min-w-0` on the
           children because recharts' ResponsiveContainer measures its parent:
           without it a grid track can only shrink to its content's min width and
           the chart keeps a width the phone does not have. ---- */}
      {/* The period control sits on the charts' own heading rather than at the
          top of the page: it governs these four cards and nothing above them,
          and the cards are current-state counters that take no period. */}
      <div className="mb-2 flex items-end justify-between gap-3">
        <h2 className="text-[13.5px] font-bold text-ink">Trends and breakdowns</h2>
        <ChartPeriodControl
          period={period}
          periodKey={periodKey}
          custom={custom}
          onChange={(key, range) => {
            setPeriodKey(key);
            setCustom(range);
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <WorkOrderTrendChart
          data={charts?.work_orders_trend}
          period={period}
          subtitle={periodSubtitle(period, "Raised")}
        />
        <DepartmentBreakdownChart
          data={charts?.department_breakdown}
          subtitle={periodScope(period, "Raised")}
        />
        <MachineBreakdownChart
          data={charts?.machine_breakdown}
          subtitle={periodScope(period, "Top 10 by work orders raised")}
        />
        <TechnicianPerformanceChart
          data={charts?.technician_performance}
          subtitle={periodScope(period, "Top 10 by work orders finished")}
        />
      </div>

      {drill && <CardDrill card={drill} snapshotAt={snapshotAt} onClose={() => setDrill(null)} />}
    </div>
  );
}

/**
 * Loads one card's rows only while its modal is open — mounting the listener
 * with the modal is what keeps this to a single query per deliberate click
 * rather than eleven on every dashboard load.
 */
function CardDrill({ card, snapshotAt, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    return listenDashboardCardRows(
      card.key,
      setRows,
      (e) => setError(describeError(e, "Couldn't load the records behind this card."))
    );
  }, [card.key]);

  const normalised = useMemo(() => (rows ?? []).map(rowFromRpc), [rows]);

  return (
    <CardDetail
      title={card.title}
      blurb={card.blurb}
      rows={normalised}
      loading={rows === null && !error}
      error={error}
      metricUnit={card.metricUnit}
      emptyText="No records match this card right now."
      footnote={
        snapshotAt
          ? `This list is live. The card itself is the ${snapshotAt} snapshot, recomputed every 15 minutes, so the two can differ briefly.`
          : "This list is live; the card is a periodic snapshot."
      }
      onClose={onClose}
    />
  );
}
