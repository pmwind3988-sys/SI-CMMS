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

export function RoleBadge({ role }) {
  const cfg = ROLE_MAP[role] || ROLE_MAP.requester;
  const Icon = cfg.Icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full text-[11.5px] font-bold px-2.5 py-1"
      style={{ background: `${cfg.c}12`, color: cfg.c, border: `1px solid ${cfg.c}45` }}
    >
      <Icon size={12} /> {ROLE_LABELS[role] || role}
    </span>
  );
}
