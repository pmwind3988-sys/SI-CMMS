"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenDashboardCards, listenDashboardCharts, refreshDashboardStatsNow } from "../../lib/dashboard";
import { ELEVATED_ROLES } from "../../lib/roles";
import StatCard from "./StatCard";
import MonthlyWorkOrdersChart from "./MonthlyWorkOrdersChart";
import DepartmentBreakdownChart from "./DepartmentBreakdownChart";
import MachineBreakdownChart from "./MachineBreakdownChart";
import TechnicianPerformanceChart from "./TechnicianPerformanceChart";
import { ErrorBanner } from "../ui/Surfaces";

function fmtMinutes(mins) {
  if (!mins) return "0";
  if (mins < 60) return String(mins);
  return (mins / 60).toFixed(1);
}
function unitFor(mins) {
  return mins && mins >= 60 ? "hrs" : "min";
}

export default function DashboardModule() {
  const { user } = useAuth();
  const [cards, setCards] = useState(null);
  const [charts, setCharts] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsub1 = listenDashboardCards(setCards, () => setError("Couldn't load dashboard metrics."));
    const unsub2 = listenDashboardCharts(setCharts, () => setError("Couldn't load dashboard charts."));
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const canRefresh = ELEVATED_ROLES.includes(user?.role);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshDashboardStatsNow();
    } catch (e) {
      setError("Couldn't refresh right now — try again in a moment.");
    } finally {
      setRefreshing(false);
    }
  }

  const loading = !cards;

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink mb-0.5">Dashboard</h1>
          <p className="text-[13px] text-ink-soft">
            {cards?.updated_at?.toDate
              ? `Last updated ${new Date(cards.updated_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
              : "Loading…"}
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

      {/* ---- CARDS: responsive grid — 2 cols on mobile, up to 5 on desktop ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard icon={ClipboardList} label="Total Open Work Orders" value={cards?.total_open ?? 0} loading={loading} color="#0F3D91" />
        <StatCard icon={AlertOctagon} label="P1 Critical" value={cards?.p1_critical ?? 0} loading={loading} color="#EF4444" />
        <StatCard icon={AlertTriangle} label="P2 High" value={cards?.p2_high ?? 0} loading={loading} color="#F59E0B" />
        <StatCard icon={AlertCircle} label="P3 Medium" value={cards?.p3_medium ?? 0} loading={loading} color="#FBBF24" />
        <StatCard icon={Info} label="P4 Low" value={cards?.p4_low ?? 0} loading={loading} color="#0F3D91" />
        <StatCard icon={CheckCircle2} label="Completed Today" value={cards?.completed_today ?? 0} loading={loading} color="#22C55E" />
        <StatCard icon={Clock} label="Overdue" value={cards?.overdue ?? 0} loading={loading} color="#EF4444" />
        <StatCard
          icon={Timer}
          label="Avg. Response Time"
          value={fmtMinutes(cards?.avg_response_minutes)}
          unit={unitFor(cards?.avg_response_minutes)}
          loading={loading}
          color="#1E4FA0"
        />
        <StatCard
          icon={Wrench}
          label="Avg. Repair Time"
          value={fmtMinutes(cards?.avg_repair_minutes)}
          unit={unitFor(cards?.avg_repair_minutes)}
          loading={loading}
          color="#1E4FA0"
        />
        <StatCard icon={Users} label="Active Technicians" value={cards?.active_technicians ?? 0} loading={loading} color="#22C55E" />
      </div>

      {/* ---- CHARTS: 1 column on mobile, 2 columns on desktop ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MonthlyWorkOrdersChart data={charts?.monthly_work_orders} />
        <DepartmentBreakdownChart data={charts?.department_breakdown} />
        <MachineBreakdownChart data={charts?.machine_breakdown} />
        <TechnicianPerformanceChart data={charts?.technician_performance} />
      </div>
    </div>
  );
}
