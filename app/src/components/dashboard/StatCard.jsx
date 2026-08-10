"use client";

export default function StatCard({ icon: Icon, label, value, unit, color = "#0F3D91", loading }) {
  return (
    <div className="bg-white border border-border rounded-xl shadow-card p-3 sm:p-4">
      <div className="flex items-start justify-between gap-1.5 mb-2">
        <span className="text-[11.5px] font-semibold text-ink-soft">{label}</span>
        {Icon && <Icon size={15} className="flex-shrink-0 mt-px" style={{ color }} />}
      </div>
      {loading ? (
        <div className="h-7 w-16 bg-canvas rounded animate-pulse" />
      ) : (
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-[21px] sm:text-[24px] font-bold text-ink">{value}</span>
          {unit && <span className="text-[12px] text-ink-soft">{unit}</span>}
        </div>
      )}
    </div>
  );
}
