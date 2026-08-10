"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Download, AlertTriangle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenWorkOrderList } from "../../lib/workOrders";
import { fmtDue } from "../../lib/constants";
import { useReferenceData } from "../../lib/referenceData";
import { ROLES } from "../../lib/roles";
import { PriorityBadge, StatusBadge } from "../ui/Badges";
import Button from "../ui/Button";
import { Card, ErrorBanner, EmptyState } from "../ui/Surfaces";
import { inputClass } from "../ui/Field";

const TITLES = {
  [ROLES.REQUESTER]: "My Work Orders",
  [ROLES.TECHNICIAN]: "My Tasks",
  [ROLES.SUPERVISOR]: "Work Orders — My Department",
  [ROLES.MANAGER]: "Work Orders",
  [ROLES.ADMIN]: "Work Orders — All",
};

const EMPTY_MESSAGES = {
  [ROLES.REQUESTER]: "You haven't raised any work orders yet.",
  [ROLES.TECHNICIAN]: "No tasks assigned to you right now.",
  [ROLES.SUPERVISOR]: "No work orders match these filters in your department.",
  [ROLES.MANAGER]: "No work orders match these filters.",
  [ROLES.ADMIN]: "No work orders match these filters.",
};

export default function WorkOrderList() {
  const { user } = useAuth();
  const { priorities, statuses } = useReferenceData();
  const router = useRouter();
  const [workOrders, setWorkOrders] = useState(null);
  const [error, setError] = useState(null);
  const [fPriority, setFPriority] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [q, setQ] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    setError(null);
    setWorkOrders(null);
    const unsub = listenWorkOrderList(user, setWorkOrders, (err) => setError(err?.message || "Couldn't load work orders."));
    return unsub;
  }, [user, reloadKey]);

  const filtered = useMemo(() => {
    if (!workOrders) return [];
    return workOrders.filter((w) => {
      if (fPriority !== "All" && w.priority !== fPriority) return false;
      if (fStatus !== "All" && w.status !== fStatus) return false;
      if (q && !(w.asset_name?.toLowerCase().includes(q.toLowerCase()) || w.wo_number?.toLowerCase().includes(q.toLowerCase()))) return false;
      return true;
    });
  }, [workOrders, fPriority, fStatus, q]);

  const needsAssignment = (workOrders || []).filter((w) => w.status === "open").length;
  const needsMyResponse = user?.role === ROLES.TECHNICIAN ? (workOrders || []).filter((w) => w.status === "assigned").length : 0;
  const canTriage = user?.role === ROLES.SUPERVISOR || user?.role === ROLES.MANAGER || user?.role === ROLES.ADMIN;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-ink">{TITLES[user.role]}</h1>
          <p className="text-[13px] text-ink-soft">{workOrders ? `${filtered.length} of ${workOrders.length} work orders` : "Loading…"}</p>
        </div>
        {user.role !== ROLES.TECHNICIAN && (
          <Button variant="amber" icon={Plus} onClick={() => router.push("/work-orders/new")}>
            Raise Work Order
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {canTriage && needsAssignment > 0 && (
        <div className="flex items-center gap-2 rounded bg-accent-soft border border-accent/40 px-3.5 py-2.5 mb-3.5 text-[13px] text-[#8A5A0A]">
          <AlertTriangle size={15} />
          <strong>{needsAssignment}</strong> work order{needsAssignment !== 1 ? "s" : ""} need{needsAssignment === 1 ? "s" : ""} a technician assigned.
        </div>
      )}
      {user.role === ROLES.TECHNICIAN && needsMyResponse > 0 && (
        <div className="flex items-center gap-2 rounded bg-accent-soft border border-accent/40 px-3.5 py-2.5 mb-3.5 text-[13px] text-[#8A5A0A]">
          <AlertTriangle size={15} />
          <strong>{needsMyResponse}</strong> new assignment{needsMyResponse !== 1 ? "s" : ""} awaiting your response.
        </div>
      )}

      <div className="flex items-center gap-3 mb-3.5 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-border rounded px-3 py-1.5 w-64">
          <Search size={14} className="text-ink-soft" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search WO# or equipment…" className="outline-none text-[13px] w-full" />
        </div>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={`${inputClass} w-36`}>
          <option>All</option>
          {priorities.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} — {p.label}
            </option>
          ))}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inputClass} w-52`}>
          <option value="All">All</option>
          {statuses.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" icon={Download}>
          Export
        </Button>
      </div>

      <Card className="overflow-hidden hidden md:block">
        <div className="flex items-center px-4 py-2.5 bg-canvas text-[11.5px] font-bold text-ink-soft uppercase tracking-wide">
          <div className="flex-[2]">Work Order</div>
          <div className="flex-[1.4]">Department</div>
          <div className="w-16">Priority</div>
          <div className="flex-[1.4]">Status</div>
          <div className="flex-[1.2]">Assigned</div>
          <div className="w-24 text-right">SLA</div>
        </div>
        {filtered.map((w, i) => (
          <WorkOrderRow key={w.id} w={w} first={i === 0} onClick={() => router.push(`/work-orders/view?id=${w.id}`)} />
        ))}
        {workOrders && filtered.length === 0 && <EmptyState>{EMPTY_MESSAGES[user.role]}</EmptyState>}
      </Card>

      <div className="md:hidden flex flex-col gap-2">
        {filtered.map((w) => (
          <WorkOrderCard key={w.id} w={w} onClick={() => router.push(`/work-orders/view?id=${w.id}`)} />
        ))}
        {workOrders && filtered.length === 0 && <EmptyState>{EMPTY_MESSAGES[user.role]}</EmptyState>}
      </div>
    </div>
  );
}

// Resolution target comes from the sla table now, in minutes, so an admin
// changing P2's target changes every countdown in the app.
function slaRemain(w, slaForPriority) {
  if (!w.created_at || !w.priority) return null;
  const sla = slaForPriority(w.priority);
  if (!sla?.resolution_target_minutes) return null;
  const createdMs = new Date(w.created_at).getTime();
  return sla.resolution_target_minutes * 60000 - (Date.now() - createdMs);
}

function WorkOrderRow({ w, first, onClick }) {
  const { slaForPriority, departmentName } = useReferenceData();
  const remain = slaRemain(w, slaForPriority);
  return (
    <div onClick={onClick} className={`flex items-center px-4 py-3 cursor-pointer hover:bg-canvas ${first ? "" : "border-t border-[#F1F3F5]"}`}>
      <div className="flex-[2] min-w-0">
        <div className="font-mono text-[11.5px] text-ink-soft">{w.wo_number || "Pending…"}</div>
        <div className="text-[13.5px] text-ink font-medium">{w.asset_name}</div>
      </div>
      <div className="flex-[1.4] text-[13px] text-ink-soft">{departmentName(w.department_id)}</div>
      <div className="w-16">
        <PriorityBadge p={w.priority} size="sm" />
      </div>
      <div className="flex-[1.4]">
        <StatusBadge s={w.status} />
      </div>
      <div className="flex-[1.2] text-[13px] text-ink">{w.assigned_to_name || <span className="text-ink-soft">Unassigned</span>}</div>
      <div className="w-24 text-right font-mono text-[11.5px]" style={{ color: remain != null && remain < 0 ? "#EF4444" : "#64748B", fontWeight: remain < 0 ? 700 : 400 }}>
        {w.status === "closed" ? "—" : remain != null ? (remain < 0 ? "Breached" : fmtDue(remain) + " left") : "—"}
      </div>
    </div>
  );
}

function WorkOrderCard({ w, onClick }) {
  const { slaForPriority, departmentName } = useReferenceData();
  const remain = slaRemain(w, slaForPriority);
  return (
    <Card className="p-3.5" onClick={onClick}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[11px] text-ink-soft">{w.wo_number || "Pending…"}</div>
          <div className="text-[14px] text-ink font-semibold mt-0.5">{w.asset_name}</div>
          <div className="text-[12px] text-ink-soft mt-0.5">{departmentName(w.department_id)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PriorityBadge p={w.priority} size="sm" />
          <StatusBadge s={w.status} />
        </div>
      </div>
      <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-[#F1F3F5]">
        <span className="text-[12px] text-ink-soft">{w.assigned_to_name || "Unassigned"}</span>
        <span className="font-mono text-[11px]" style={{ color: remain < 0 ? "#EF4444" : "#64748B" }}>
          {w.status === "closed" ? "—" : remain != null ? (remain < 0 ? "Breached" : fmtDue(remain) + " left") : "—"}
        </span>
      </div>
    </Card>
  );
}
