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
  FlaskConical,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenDashboardCards, listenDashboardCharts, listenDashboardCardRows, refreshDashboardStatsNow } from "../../lib/dashboard";
import { listenDemoAccounts, DEMO_FLAGS, demoFlagsOf } from "../../lib/admin";
import { ELEVATED_ROLES, ROLES, ROLE_LABELS, hasRole, hasAnyRole } from "../../lib/roles";
import { describeError } from "../../lib/errors";
import StatCard from "./StatCard";
import CardDetail, { rowFromRpc } from "./CardDetail";
import MonthlyWorkOrdersChart from "./MonthlyWorkOrdersChart";
import DepartmentBreakdownChart from "./DepartmentBreakdownChart";
import MachineBreakdownChart from "./MachineBreakdownChart";
import TechnicianPerformanceChart from "./TechnicianPerformanceChart";
import RoleSwitcher from "./RoleSwitcher";
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
  const [drill, setDrill] = useState(null); // a CARDS entry, or the demo-accounts card

  // System administration stays Admin-only, Manager's elevation notwithstanding
  // — so does noticing that the demo accounts are still live.
  const isAdmin = hasRole(user, ROLES.ADMIN);
  const [demoAccounts, setDemoAccounts] = useState(null);

  useEffect(() => {
    const unsub1 = listenDashboardCards(setCards, () => setError("Couldn't load dashboard metrics."));
    const unsub2 = listenDashboardCharts(setCharts, () => setError("Couldn't load dashboard charts."));
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    return listenDemoAccounts(setDemoAccounts, (e) =>
      setError(describeError(e, "Couldn't check for demo accounts."))
    );
  }, [isAdmin]);

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
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-navy border border-border rounded-lg px-3 py-2 bg-white disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {isAdmin && demoAccounts?.length > 0 && (
        <button
          type="button"
          onClick={() => setDrill(DEMO_CARD)}
          className="mb-4 flex w-full items-start gap-2 rounded border border-[#F59E0B66] bg-[#FFFBEB] px-4 py-3 text-left text-[13px] text-[#92400E] hover:bg-[#FEF3C7]"
        >
          <FlaskConical size={15} className="mt-0.5 flex-shrink-0" />
          <span>
            <strong>{demoAccounts.length}</strong>{" "}
            {demoAccounts.length === 1 ? "account is" : "accounts are"} still seeded demo data —
            placeholder addresses, the shared bootstrap password, or profiles nobody has claimed.
            Review them before this reaches anyone real.
          </span>
        </button>
      )}

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
        {isAdmin && (
          <StatCard
            icon={FlaskConical}
            label="Demo accounts"
            color="#F59E0B"
            loading={demoAccounts === null}
            value={demoAccounts?.length ?? 0}
            emphasis={(demoAccounts?.length ?? 0) > 0}
            onClick={() => setDrill(DEMO_CARD)}
          />
        )}
      </div>

      {/* ---- CHARTS: 1 column on mobile, 2 columns on desktop. `min-w-0` on the
           children because recharts' ResponsiveContainer measures its parent:
           without it a grid track can only shrink to its content's min width and
           the chart keeps a width the phone does not have. ---- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <MonthlyWorkOrdersChart data={charts?.monthly_work_orders} />
        <DepartmentBreakdownChart data={charts?.department_breakdown} />
        <MachineBreakdownChart data={charts?.machine_breakdown} />
        <TechnicianPerformanceChart data={charts?.technician_performance} />
      </div>

      {drill?.key === DEMO_CARD.key && (
        <CardDetail
          title={DEMO_CARD.title}
          blurb={DEMO_CARD.blurb}
          rows={(demoAccounts ?? []).map(demoAccountRow)}
          loading={demoAccounts === null}
          emptyText="Every account looks real. Nothing seeded is still sitting unchanged."
          footnote="Fix these from Admin → Users. Each reason disappears on its own once it is dealt with."
          onClose={() => setDrill(null)}
        />
      )}
      {drill && drill.key !== DEMO_CARD.key && (
        <CardDrill card={drill} snapshotAt={snapshotAt} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

const DEMO_CARD = {
  key: "demo_accounts",
  title: "Accounts that still look like demo data",
  blurb: "Flagged for one reason each. A reason clears the moment it stops being true.",
};

function demoAccountRow(u) {
  return {
    id: u.id,
    href: null,
    title: u.email,
    subtitle: u.name,
    meta: `${ROLE_LABELS[u.role] || u.role} · ${u.status === "active" ? "Active" : "Inactive"}`,
    tags: demoFlagsOf(u).map((f) => DEMO_FLAGS[f]?.short || f),
    metricKind: "none",
  };
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
