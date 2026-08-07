"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export default function MonthlyWorkOrdersChart({ data }) {
  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-4">
      <div className="text-[13.5px] font-bold text-ink mb-1">Monthly Work Orders</div>
      <div className="text-[11.5px] text-ink-soft mb-3">Created per month, last 12 months</div>
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
