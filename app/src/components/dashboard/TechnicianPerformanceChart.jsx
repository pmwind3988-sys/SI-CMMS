"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { useIsNarrow } from "../../lib/useMediaQuery";
import ChartLegend from "./ChartLegend";

/* Single series, so this is not a colour key either. The one thing worth
   saying is that the average repair time lives in the tooltip and not on the
   chart - easy to miss, and it is the more interesting of the two numbers. */
const LEGEND = [
  { color: "#22C55E", label: "Completed", note: "work orders this technician finished" },
  { label: "Horizontal axis", note: "how many they completed" },
  { label: "Average repair time", note: "tap or hover a bar to see it" },
];

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-border rounded-lg shadow-card px-3 py-2 text-[12px]">
      <div className="font-semibold text-ink">{p.technician}</div>
      <div className="text-ink-soft">{p.completed} completed</div>
      <div className="text-ink-soft">Avg repair: {Math.round(p.avg_repair_minutes / 60)} hrs</div>
    </div>
  );
}

export default function TechnicianPerformanceChart({ data, subtitle }) {
  const rows = data || [];
  // See MachineBreakdownChart — the label gutter has to shrink on a phone or
  // there's no plot area left.
  const narrow = useIsNarrow();
  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-3 sm:p-4">
      <div className="text-[13.5px] font-bold text-ink mb-1">Technician Performance</div>
      <div className="text-[11.5px] text-ink-soft mb-2">{subtitle}</div>
      <ChartLegend items={LEGEND} />
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ left: narrow ? 0 : 8, right: narrow ? 8 : 16 }}>
            <XAxis type="number" tick={{ fontSize: narrow ? 10 : 11, fill: "#64748B" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="technician" tick={{ fontSize: narrow ? 10 : 11, fill: "#101828" }} axisLine={false} tickLine={false} width={narrow ? 84 : 110} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="completed" fill="#22C55E" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
