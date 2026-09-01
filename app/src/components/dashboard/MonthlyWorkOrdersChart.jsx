"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import ChartLegend from "./ChartLegend";

// Single series, so nothing here is a colour key. What this chart actually
// needs explaining is its vertical axis, which carries no title, and the fact
// that a month counts when a work order was RAISED rather than finished — the
// one reading of it that would otherwise be wrong.
const LEGEND = [
  { color: "#0F3D91", label: "Work orders raised", note: "counted by the month they were reported in, not the month they were finished" },
  { label: "Vertical axis", note: "how many were raised that month" },
];

export default function MonthlyWorkOrdersChart({ data }) {
  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-3 sm:p-4">
      <div className="text-[13.5px] font-bold text-ink mb-1">Monthly Work Orders</div>
      <div className="text-[11.5px] text-ink-soft mb-2">Created per month, last 12 months</div>
      <ChartLegend items={LEGEND} />
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data || []} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#0F3D91" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
