"use client";

import { User, HardHat, Users, Briefcase, ShieldCheck } from "lucide-react";
import { useReferenceData } from "../../lib/referenceData";
import { ROLE_LABELS } from "../../lib/roles";

// Colours and labels come from the priorities and wo_statuses tables, so an
// Administrator recolouring a status in Settings changes every badge in the app.
export function PriorityBadge({ p, size = "md" }) {
  const { priorityColor } = useReferenceData();
  const c = priorityColor(p);
  const pad = size === "sm" ? "1px 6px" : "2px 8px";
  const fs = size === "sm" ? 11 : 12;
  return (
    <span
      className="font-mono font-semibold rounded"
      style={{ background: `${c}1A`, color: c, border: `1px solid ${c}55`, padding: pad, fontSize: fs }}
    >
      {p}
    </span>
  );
}

export function StatusBadge({ s }) {
  const { statusColor, statusLabel } = useReferenceData();
  const c = statusColor(s);
  return (
    <span className="text-[12.5px] font-semibold whitespace-nowrap" style={{ color: c }}>
      ● {statusLabel(s)}
    </span>
  );
}

const ROLE_MAP = {
  requester: { c: "#0F3D91", Icon: User },
  technician: { c: "#F59E0B", Icon: HardHat },
  supervisor: { c: "#22C55E", Icon: Users },
  manager: { c: "#1E4FA0", Icon: Briefcase },
  admin: { c: "#EF4444", Icon: ShieldCheck },
};

/**
 * `compact` drops the label below `xs` (400px) and leaves the icon, which is
 * already colour-coded per role. "Administrator" is 84px of text; in the app
 * bar, beside the hamburger, the brand mark and the bell, it was the element
 * that pushed the row past a 360px viewport — and `body { overflow-x: hidden }`
 * meant it was clipped rather than scrollable to.
 */
export function RoleBadge({ role, compact = false }) {
  const cfg = ROLE_MAP[role] || ROLE_MAP.requester;
  const Icon = cfg.Icon;
  const label = ROLE_LABELS[role] || role;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold"
      style={{ background: `${cfg.c}12`, color: cfg.c, border: `1px solid ${cfg.c}45` }}
      // The label is hidden from the accessibility tree along with the text
      // when it collapses, so the badge carries it itself.
      aria-label={label}
      title={label}
    >
      <Icon size={12} className="flex-shrink-0" />
      <span className={`truncate ${compact ? "hidden xs:inline" : ""}`}>{label}</span>
    </span>
  );
}
