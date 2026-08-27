"use client";

import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import ChartLegend, { EXCLUDES_TEST_DATA } from "./ChartLegend";

const COLORS = ["#0F3D91", "#F59E0B", "#22C55E", "#EF4444", "#1E4FA0", "#FBBF24", "#64748B"];

export default function DepartmentBreakdownChart({ data }) {
  const rows = data || [];
  /* Built from the same `COLORS[i % COLORS.length]` the <Cell>s below use, off
     the same array in the same order, so the key cannot drift from the pie.
     Duplicating the expression is the only way it could. */
  const legend = [
    ...rows.map((r, i) => ({
      color: COLORS[i % COLORS.length],
      label: r.department,
      note: `${r.count} work order${r.count === 1 ? "" : "s"}`,
    })),
    EXCLUDES_TEST_DATA,
  ];
  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-3 sm:p-4">
      <div className="text-[13.5px] font-bold text-ink mb-1">Department Breakdown</div>
      <div className="text-[11.5px] text-ink-soft mb-2">Work orders by department</div>
      {/* Replaces recharts' own <Legend>, which was always on and took roughly a
          third of this card's height away from the pie on a phone. */}
      <ChartLegend items={legend} />
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="department" innerRadius="50%" outerRadius="80%" paddingAngle={2}>
              {rows.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
