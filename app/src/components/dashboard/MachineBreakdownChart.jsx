"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

export default function MachineBreakdownChart({ data }) {
  const rows = data || [];
  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-4">
      <div className="text-[13.5px] font-bold text-ink mb-1">Machine Breakdown</div>
      <div className="text-[11.5px] text-ink-soft mb-3">Top 10 equipment by work order count</div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="asset" tick={{ fontSize: 11, fill: "#101828" }} axisLine={false} tickLine={false} width={120} />
            <Tooltip />
            <Bar dataKey="count" fill="#EF4444" radius={[0, 4, 4, 0]}>
              {rows.map((_, i) => (
                <Cell key={i} fill={i < 3 ? "#EF4444" : "#F59E0B"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
