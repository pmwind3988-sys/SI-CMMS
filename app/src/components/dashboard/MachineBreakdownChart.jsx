"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { useIsNarrow } from "../../lib/useMediaQuery";
import ChartLegend from "./ChartLegend";

// The two colours are the only thing on this chart that carries meaning and is
// nowhere stated. `i < 3` below is what draws them; this restates that rule
// rather than recomputing it, so the two cannot disagree.
const LEGEND = [
  { color: "#EF4444", label: "Top 3", note: "the three machines with the most work orders" },
  { color: "#F59E0B", label: "The rest of the top ten", note: "ranked by work order count" },
  { label: "Horizontal axis", note: "how many work orders that machine has had" },
];

export default function MachineBreakdownChart({ data }) {
  const rows = data || [];
  // A 120px label gutter left barely 170px of plot inside a phone-width card,
  // so every bar looked the same length. Recharts wants a pixel number here,
  // hence the media query rather than a breakpoint class.
  const narrow = useIsNarrow();
  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-3 sm:p-4">
      <div className="text-[13.5px] font-bold text-ink mb-1">Machine Breakdown</div>
      <div className="text-[11.5px] text-ink-soft mb-2">Top 10 equipment by work order count</div>
      <ChartLegend items={LEGEND} />
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: narrow ? 0 : 8, right: narrow ? 8 : 16 }}>
            <XAxis type="number" tick={{ fontSize: narrow ? 10 : 11, fill: "#64748B" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="asset" tick={{ fontSize: narrow ? 10 : 11, fill: "#101828" }} axisLine={false} tickLine={false} width={narrow ? 84 : 120} />
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
