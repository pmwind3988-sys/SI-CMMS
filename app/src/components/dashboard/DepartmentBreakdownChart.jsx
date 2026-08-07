"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";

const COLORS = ["#0F3D91", "#F59E0B", "#22C55E", "#EF4444", "#1E4FA0", "#FBBF24", "#64748B"];

export default function DepartmentBreakdownChart({ data }) {
  const rows = data || [];
  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-4">
      <div className="text-[13.5px] font-bold text-ink mb-1">Department Breakdown</div>
      <div className="text-[11.5px] text-ink-soft mb-3">Work orders by department</div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="department" innerRadius="50%" outerRadius="80%" paddingAngle={2}>
              {rows.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
