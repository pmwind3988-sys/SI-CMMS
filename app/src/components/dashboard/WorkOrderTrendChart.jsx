"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import ChartLegend from "./ChartLegend";

/**
 * Was MonthlyWorkOrdersChart, and the rename is the change: the bucket is
 * whatever the chosen period implies now — hours across a day, days across a
 * week, weeks across a month, months across longer — so a component called
 * "Monthly" would be describing one of its four modes.
 *
 * Single series, so nothing here is a colour key. What this chart needs
 * explaining is its vertical axis, which carries no title, and the fact that a
 * bucket counts when a work order was RAISED rather than when it was finished —
 * the one reading of it that would otherwise be wrong.
 */
export default function WorkOrderTrendChart({ data, period, subtitle }) {
  const axis = period?.axis || "period";
  const legend = [
    { color: "#0F3D91", label: "Work orders raised", note: "counted in the period they were reported in, not the one they were finished in" },
    { label: "Horizontal axis", note: `one point per ${axis}, including the quiet ones` },
    { label: "Vertical axis", note: "how many were raised in that bucket" },
  ];

  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-3 sm:p-4">
      <div className="text-[13.5px] font-bold text-ink mb-1">Work Orders Raised</div>
      <div className="text-[11.5px] text-ink-soft mb-2">{subtitle}</div>
      <ChartLegend items={legend} />
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data || []} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" />
            {/* `label` rather than `month`: the server names the bucket, and
                it is "14:00" as readily as "Aug 26". */}
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#0F3D91" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
