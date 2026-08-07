// SI — Service Inside · Work Order Module
// Shared domain constants, display-side only.
//
// The SLA thresholds and status literals below are no longer the server's copy:
// SLA targets live in the `sla` table (read by si_sla_target_minutes) and the
// transition matrix lives in `wo_status_transitions`. What remains here is
// presentation — labels, colours, and the client-side priority suggestion the
// raise form uses before anything is written.
import { ROLES } from "./roles";

export const STATUS_FLOW = [
  "open",
  "assigned",
  "accepted",
  "on_the_way",
  "on_site",
  "repairing",
  "waiting_spare_part",
  "testing",
  "completed",
  "verified",
  "closed",
];

export const STATUS_LABELS = {
  open: "Open",
  assigned: "Assigned",
  accepted: "Accepted",
  on_the_way: "On The Way",
  on_site: "On Site",
  repairing: "Repairing",
  waiting_spare_part: "Waiting Spare Part",
  testing: "Testing",
  completed: "Completed",
  verified: "Verified",
  closed: "Closed",
};

export const STATUS_COLORS = {
  open: "#0F3D91",
  assigned: "#0F3D91",
  accepted: "#F59E0B",
  on_the_way: "#F59E0B",
  on_site: "#F59E0B",
  repairing: "#F59E0B",
  waiting_spare_part: "#64748B",
  testing: "#F59E0B",
  completed: "#F59E0B",
  verified: "#22C55E",
  closed: "#22C55E",
};

export const PRIORITY_COLORS = { P1: "#EF4444", P2: "#F59E0B", P3: "#FBBF24", P4: "#0F3D91" };

export const SLA_MATRIX = {
  P1: { ack: "5 min", response: "15 min", resolution: "4 hrs", resolutionMs: 4 * 3600e3, ackMs: 5 * 60e3 },
  P2: { ack: "15 min", response: "1 hr", resolution: "8 hrs", resolutionMs: 8 * 3600e3, ackMs: 15 * 60e3 },
  P3: { ack: "30 min", response: "4 hrs", resolution: "24 hrs", resolutionMs: 24 * 3600e3, ackMs: 30 * 60e3 },
  P4: { ack: "2 hrs", response: "24 hrs", resolution: "5 business days", resolutionMs: 5 * 24 * 3600e3, ackMs: 2 * 3600e3 },
};

export const IMPACT_OPTIONS = [
  { value: "full_stoppage", label: "Full production stoppage", suggests: "P1" },
  { value: "reduced_capacity", label: "Running at reduced capacity", suggests: "P2" },
  { value: "auxiliary", label: "Auxiliary equipment, no line impact", suggests: "P3" },
  { value: "none", label: "No production impact (cosmetic/routine)", suggests: "P4" },
];

// Departments and Assets are owned by their own modules in production;
// this module depends on lightweight lookups of both, shaped to match
// the real /departments and /assets collections' id + name fields.
export const DEPARTMENTS = [
  { id: "DEPT-MACHINING", name: "Machining" },
  { id: "DEPT-ASSEMBLY", name: "Assembly" },
  { id: "DEPT-PRESS", name: "Press Shop" },
  { id: "DEPT-UTILITIES", name: "Utilities" },
  { id: "DEPT-PACKAGING", name: "Packaging" },
  { id: "DEPT-WAREHOUSE", name: "Warehouse" },
  { id: "DEPT-QUALITY", name: "Quality" },
];

export const EQUIPMENT = [
  { id: "AST-0412", name: "CNC Lathe #04", department_id: "DEPT-MACHINING", criticality: "High" },
  { id: "AST-0288", name: "Conveyor B-2", department_id: "DEPT-ASSEMBLY", criticality: "Medium" },
  { id: "AST-0157", name: "Hydraulic Press 3", department_id: "DEPT-PRESS", criticality: "High" },
  { id: "AST-0330", name: "Air Compressor 1", department_id: "DEPT-UTILITIES", criticality: "Medium" },
  { id: "AST-0501", name: "Packaging Line C", department_id: "DEPT-PACKAGING", criticality: "Medium" },
  { id: "AST-0099", name: "Overhead Crane 2", department_id: "DEPT-WAREHOUSE", criticality: "Low" },
  { id: "AST-0212", name: "Boiler Unit A", department_id: "DEPT-UTILITIES", criticality: "High" },
];

// The TECHNICIANS placeholder array that used to live here has been removed
// rather than updated. work_orders.assigned_to_id is a uuid foreign key onto
// users(id) now, so its slug ids ("tech-arun") could never be assigned to
// anything — keeping them would have been a trap. AssignPanel reads the real
// roster via listenTechnicians() in lib/workOrders.js.

const RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };

export function suggestPriority(impactValue) {
  const found = IMPACT_OPTIONS.find((i) => i.value === impactValue);
  return found ? found.suggests : "P3";
}

export function computeSuggestion(impact, safety, env) {
  let level = impact ? RANK[suggestPriority(impact)] : null;
  if (safety?.flag) {
    const esc = safety.severity === "High" ? 1 : 2;
    level = level ? Math.min(level, esc) : esc;
  }
  if (env?.flag) level = level ? Math.min(level, 2) : 2;
  return level ? "P" + level : null;
}

export function fmtDue(ms) {
  if (ms == null) return "—";
  const sign = ms < 0 ? -1 : 1;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600e3);
  const d = Math.floor(h / 24);
  let out;
  if (d >= 1) out = `${d}d ${h % 24}h`;
  else if (h >= 1) out = `${h}h ${Math.floor((abs % 3600e3) / 60000)}m`;
  else out = `${Math.floor(abs / 60000)}m`;
  return sign < 0 ? `${out} overdue` : out;
}

export function equipmentById(id) {
  return EQUIPMENT.find((e) => e.id === id) || null;
}
export function departmentById(id) {
  return DEPARTMENTS.find((d) => d.id === id) || null;
}

export function isAssigneeOf(wo, currentUser) {
  return currentUser?.role === ROLES.TECHNICIAN && wo.assigned_to_id === currentUser.uid;
}
export function isRequesterOf(wo, currentUser) {
  return currentUser?.role === ROLES.REQUESTER && wo.requester_id === currentUser.uid;
}
export function isSupervisorOfDept(wo, currentUser) {
  return currentUser?.role === ROLES.SUPERVISOR && wo.department_id === currentUser.departmentId;
}
export function isManagerOrAdmin(currentUser) {
  return currentUser?.role === ROLES.MANAGER || currentUser?.role === ROLES.ADMIN;
}
export function canAssign(currentUser) {
  return currentUser?.role === ROLES.SUPERVISOR || isManagerOrAdmin(currentUser);
}
export function canEditWhileOpen(wo, currentUser) {
  return (
    (currentUser?.role === ROLES.REQUESTER && wo.requester_id === currentUser.uid) ||
    isSupervisorOfDept(wo, currentUser) ||
    isManagerOrAdmin(currentUser)
  );
}
