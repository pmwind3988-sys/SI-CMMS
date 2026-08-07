import React, { useState, useRef, useMemo } from "react";
import {
  ClipboardList, Plus, Search, Download, ArrowLeft, AlertTriangle, Timer,
  CheckCircle2, PlayCircle, PauseCircle, Send, RotateCcw, Ban, ThumbsUp,
  UserCheck, Image as ImageIcon, Video, X, Bell, ChevronDown, Eye, EyeOff,
  Loader2, ShieldCheck, ArrowRight, Sparkles, Factory, Wrench, LogOut,
  Phone, User as UserIcon, HardHat, Users as UsersIcon, Building2
} from "lucide-react";

/* ================================================================
   SI — Service Inside · Work Order Management Module
   Production build. No other module is included by design.
   Roles: Requester · Technician · Supervisor · HOD
   Flow:  New → Assigned → Accepted → In Progress → Resolved → Verified → Closed
================================================================ */

/* ---------------------------------------------------------------
   DESIGN TOKENS — SI brand system (Navy / Orange / Green / Red)
----------------------------------------------------------------*/
const T = {
  graphite: "#0F3D91", graphite2: "#0B2F70", steel: "#1E4FA0", steelLine: "#2C5AA8",
  fog: "#F6F8FB", fogCard: "#FFFFFF", ink: "#101828", inkSoft: "#64748B",
  amber: "#F59E0B", amberSoft: "#FDE7C4",
  p1: "#EF4444", p2: "#F59E0B", p3: "#FBBF24", p4: "#0F3D91", good: "#22C55E",
  border: "#E5E9F0",
  shadow: "0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.05)",
};

const FontStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    .f-display { font-family: 'Inter', sans-serif; letter-spacing: -0.01em; }
    .f-mono { font-family: 'Inter', sans-serif; font-variant-numeric: tabular-nums; letter-spacing: 0; }
    @keyframes riseIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .rise { animation: riseIn .35s ease both; }
    input:focus, select:focus, textarea:focus { outline: none; }
    button { font-family: inherit; }
  `}</style>
);

function Logo({ size = 34, variant = "navy" }) {
  const bg = variant === "navy" ? T.graphite : "#fff";
  const fg = variant === "navy" ? "#fff" : T.graphite;
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" role="img" aria-label="SI logo">
      <rect width="34" height="34" rx="9" fill={bg} />
      <path d="M9.2 13.4c0-2.1 1.9-3.6 4.6-3.6 2.4 0 4.1 1 4.8 2.7l-2.3 1.1c-.5-1-1.3-1.5-2.5-1.5-1.1 0-1.8.5-1.8 1.2 0 .8.8 1.1 2.3 1.5 2.5.6 4.3 1.4 4.3 3.8 0 2.2-2 3.7-4.9 3.7-2.6 0-4.5-1.1-5.2-2.9l2.3-1.1c.5 1.1 1.5 1.7 2.9 1.7 1.2 0 2-.5 2-1.3 0-.8-.8-1.1-2.5-1.5-2.4-.6-4-1.5-4-3.8z" fill={fg} />
      <rect x="22.4" y="10.1" width="2.5" height="12.9" rx="1.1" fill={fg} />
      <circle cx="23.65" cy="7.4" r="1.9" fill={T.amber} />
    </svg>
  );
}

/* ---------------------------------------------------------------
   SHARED PRIMITIVES
----------------------------------------------------------------*/
const PRIORITY_COLORS = { P1: T.p1, P2: T.p2, P3: T.p3, P4: T.p4 };

function PriorityBadge({ p, size = "md" }) {
  const c = PRIORITY_COLORS[p];
  return (
    <span className="f-mono" style={{ background: `${c}1A`, color: c, border: `1px solid ${c}55`, borderRadius: 5, padding: size === "sm" ? "1px 6px" : "2px 8px", fontSize: size === "sm" ? 11 : 12, fontWeight: 600 }}>
      {p}
    </span>
  );
}

function StatusBadge({ s }) {
  const styles = {
    "New": T.p4, "Assigned": T.p4, "Accepted": T.amber, "In Progress": T.amber,
    "On Hold": T.inkSoft, "Resolved": T.p2, "Verified": T.good, "Closed": T.good,
  };
  const c = styles[s] || T.inkSoft;
  return <span style={{ color: c, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>● {s}</span>;
}

function RoleBadge({ role }) {
  const map = {
    Requester: { c: T.p4, icon: UserIcon }, Technician: { c: T.amber, icon: HardHat },
    Supervisor: { c: T.good, icon: UsersIcon }, HOD: { c: T.p1, icon: Building2 },
  };
  const cfg = map[role] || map.Requester;
  const Icon = cfg.icon;
  return (
    <span className="flex items-center gap-1.5" style={{ background: `${cfg.c}12`, color: cfg.c, border: `1px solid ${cfg.c}45`, borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 700 }}>
      <Icon size={12} /> {role}
    </span>
  );
}

function Field({ label, required, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, display: "block", marginBottom: 6 }}>
        {label} {required && <span style={{ color: T.p1 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: T.p1, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: 12, border: `1.5px solid #D8DEE4`,
  fontSize: 13.5, background: "#fff", color: T.ink, fontFamily: "inherit",
};

function Btn({ children, variant = "primary", onClick, icon: Icon, style, disabled, size = "md" }) {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 12, border: "none",
    fontWeight: 600, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
    fontSize: size === "sm" ? 12.5 : 13.5, padding: size === "sm" ? "7px 12px" : "10px 16px",
    fontFamily: "inherit",
  };
  const variants = {
    primary: { background: T.ink, color: "#fff" },
    amber: { background: T.amber, color: "#101828" },
    ghost: { background: "transparent", color: T.ink, border: `1.5px solid #D8DEE4` },
    danger: { background: "#FCE9E9", color: T.p1 },
    success: { background: "#E7F5EE", color: T.good },
    subtle: { background: T.fog, color: T.ink },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], ...style }}>
      {Icon && <Icon size={14} />} {children}
    </button>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, background: T.graphite, color: "#fff", padding: "12px 18px", borderRadius: 12, fontSize: 13, display: "flex", alignItems: "center", gap: 8, zIndex: 1000, animation: "toastIn .25s ease both", boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}>
      <CheckCircle2 size={15} color={T.amber} /> {message}
    </div>
  );
}

/* ---------------------------------------------------------------
   DOMAIN DATA — minimal lookups this module depends on but
   does not own (Equipment/Users belong to other modules).
----------------------------------------------------------------*/
const DEPARTMENTS = ["Machining", "Assembly", "Press Shop", "Utilities", "Packaging", "Warehouse", "Quality"];

const EQUIPMENT = [
  { id: "AST-0412", name: "CNC Lathe #04", department: "Machining", criticality: "High" },
  { id: "AST-0288", name: "Conveyor B-2", department: "Assembly", criticality: "Medium" },
  { id: "AST-0157", name: "Hydraulic Press 3", department: "Press Shop", criticality: "High" },
  { id: "AST-0330", name: "Air Compressor 1", department: "Utilities", criticality: "Medium" },
  { id: "AST-0501", name: "Packaging Line C", department: "Packaging", criticality: "Medium" },
  { id: "AST-0099", name: "Overhead Crane 2", department: "Warehouse", criticality: "Low" },
  { id: "AST-0212", name: "Boiler Unit A", department: "Utilities", criticality: "High" },
];

const TECHNICIANS = [
  { id: "u1", name: "Arun Kumar", skills: ["Mechanical", "Hydraulics"], load: 2 },
  { id: "u2", name: "Meera Iyer", skills: ["Electrical", "PLC"], load: 4 },
  { id: "u3", name: "Sanjay Rao", skills: ["Mechanical", "CNC"], load: 1 },
  { id: "u4", name: "Divya Shah", skills: ["Utilities", "Boilers"], load: 3 },
  { id: "u5", name: "Karan Mehta", skills: ["Electrical", "Conveyors"], load: 2 },
];

const SLA_MATRIX = {
  P1: { ack: "5 min", response: "15 min", resolution: "4 hrs", resolutionMs: 4 * 3600e3 },
  P2: { ack: "15 min", response: "1 hr", resolution: "8 hrs", resolutionMs: 8 * 3600e3 },
  P3: { ack: "30 min", response: "4 hrs", resolution: "24 hrs", resolutionMs: 24 * 3600e3 },
  P4: { ack: "2 hrs", response: "24 hrs", resolution: "5 business days", resolutionMs: 5 * 24 * 3600e3 },
};

const IMPACT_OPTIONS = [
  { value: "full_stoppage", label: "Full production stoppage", suggests: "P1" },
  { value: "reduced_capacity", label: "Running at reduced capacity", suggests: "P2" },
  { value: "auxiliary", label: "Auxiliary equipment, no line impact", suggests: "P3" },
  { value: "none", label: "No production impact (cosmetic/routine)", suggests: "P4" },
];

const STATUS_FLOW = ["New", "Assigned", "Accepted", "In Progress", "Resolved", "Verified", "Closed"];
const RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };

function suggestPriority(impactValue) { const found = IMPACT_OPTIONS.find((i) => i.value === impactValue); return found ? found.suggests : "P3"; }
function computeSuggestion(impact, safety, env) {
  let level = impact ? RANK[suggestPriority(impact)] : null;
  if (safety.flag) { const esc = safety.severity === "High" ? 1 : 2; level = level ? Math.min(level, esc) : esc; }
  if (env.flag) { level = level ? Math.min(level, 2) : 2; }
  return level ? "P" + level : null;
}
function fmtDue(ms) {
  const h = Math.floor(ms / 3600e3); const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${Math.floor((ms % 3600e3) / 60000)}m`;
  return `${Math.floor(ms / 60000)}m`;
}
function equipmentById(id) { return EQUIPMENT.find((e) => e.id === id) || null; }

function isAssigneeOf(wo, currentUser) { return currentUser.role === "Technician" && wo.assignedTo.some((a) => a.id === currentUser.techId); }
function isRequesterOf(wo, currentUser) { return currentUser.role === "Requester" && wo.requestedBy === currentUser.name; }

/* ---------------------------------------------------------------
   SEED DATA — one example at every stage of the workflow
----------------------------------------------------------------*/
function seedWorkOrders() {
  const now = Date.now();
  return [
    { id: "wo1", woNumber: "PLT001-WO-2026-1187", machine: equipmentById("AST-0412"), department: "Machining", type: "Breakdown", priority: "P1", status: "New", impact: "full_stoppage", safetyRisk: { flag: true, severity: "High" }, environmentalRisk: { flag: false }, estDowntime: { value: 3, unit: "Hours" }, description: "Spindle overheating, line stopped.", requestedBy: "Ravi Kumar", requesterPhone: "98450 11223", assignedTo: [], photos: [], videos: [], progressLog: [], createdAt: now - 25 * 60000,
      history: [{ status: "New", actor: "Ravi Kumar", t: now - 25 * 60000, remarks: "Reported via floor terminal" }] },

    { id: "wo2", woNumber: "PLT001-WO-2026-1183", machine: equipmentById("AST-0288"), department: "Assembly", type: "Breakdown", priority: "P2", status: "Assigned", impact: "reduced_capacity", safetyRisk: { flag: false }, environmentalRisk: { flag: false }, estDowntime: { value: 6, unit: "Hours" }, description: "Belt slipping intermittently under load.", requestedBy: "Lena Fernandes", requesterPhone: "98450 22334", assignedTo: [TECHNICIANS[4]], photos: [], videos: [], progressLog: [], createdAt: now - 2 * 3600e3,
      history: [
        { status: "New", actor: "Lena Fernandes", t: now - 2 * 3600e3 },
        { status: "Assigned", actor: "Priya Nair", t: now - 100 * 60000, remarks: "Assigned to Karan Mehta" },
      ] },

    { id: "wo3", woNumber: "PLT001-WO-2026-1179", machine: equipmentById("AST-0157"), department: "Press Shop", type: "Breakdown", priority: "P3", status: "Accepted", impact: "auxiliary", safetyRisk: { flag: false }, environmentalRisk: { flag: true }, estDowntime: { value: 1, unit: "Days" }, description: "Minor hydraulic fluid leak at fitting.", requestedBy: "Operator Team", requesterPhone: "98450 33445", assignedTo: [TECHNICIANS[0]], photos: [], videos: [], progressLog: [], createdAt: now - 5 * 3600e3,
      history: [
        { status: "New", actor: "Operator Team", t: now - 5 * 3600e3 },
        { status: "Assigned", actor: "Priya Nair", t: now - 4.5 * 3600e3, remarks: "Assigned to Arun Kumar" },
        { status: "Accepted", actor: "Arun Kumar", t: now - 4 * 3600e3 },
      ] },

    { id: "wo4", woNumber: "PLT001-WO-2026-1174", machine: equipmentById("AST-0330"), department: "Utilities", type: "Breakdown", priority: "P2", status: "In Progress", impact: "reduced_capacity", safetyRisk: { flag: false }, environmentalRisk: { flag: false }, estDowntime: { value: 4, unit: "Hours" }, description: "Compressor cycling on/off rapidly, pressure unstable.", requestedBy: "Operator Team", requesterPhone: "98450 44556", assignedTo: [TECHNICIANS[3]], photos: [], videos: [],
      progressLog: [
        { note: "Checked pressure switch — reads erratic, likely faulty.", actor: "Divya Shah", t: now - 90 * 60000 },
        { note: "Ordered replacement switch from stores, ETA 30 min.", actor: "Divya Shah", t: now - 40 * 60000 },
      ],
      createdAt: now - 3 * 3600e3,
      history: [
        { status: "New", actor: "Operator Team", t: now - 3 * 3600e3 },
        { status: "Assigned", actor: "Priya Nair", t: now - 2.8 * 3600e3, remarks: "Assigned to Divya Shah" },
        { status: "Accepted", actor: "Divya Shah", t: now - 2.6 * 3600e3 },
        { status: "In Progress", actor: "Divya Shah", t: now - 2.4 * 3600e3 },
      ] },

    { id: "wo5", woNumber: "PLT001-WO-2026-1170", machine: equipmentById("AST-0501"), department: "Packaging", type: "Breakdown", priority: "P2", status: "Resolved", impact: "reduced_capacity", safetyRisk: { flag: false }, environmentalRisk: { flag: false }, estDowntime: { value: 4, unit: "Hours" }, description: "Sensor misalignment causing jam stoppages.", requestedBy: "Operator Team", requesterPhone: "98450 55667", assignedTo: [TECHNICIANS[4]], photos: [], videos: [],
      progressLog: [{ note: "Realigned sensor bracket and ran 20 test cycles — no further jams.", actor: "Karan Mehta", t: now - 40 * 60000 }],
      resolutionNotes: "Sensor bracket had loosened from vibration; realigned and torqued to spec. Recommend adding this to the monthly PM checklist.",
      createdAt: now - 8 * 3600e3,
      history: [
        { status: "New", actor: "Operator Team", t: now - 8 * 3600e3 },
        { status: "Assigned", actor: "Priya Nair", t: now - 7.5 * 3600e3 },
        { status: "Accepted", actor: "Karan Mehta", t: now - 7 * 3600e3 },
        { status: "In Progress", actor: "Karan Mehta", t: now - 6 * 3600e3 },
        { status: "Resolved", actor: "Karan Mehta", t: now - 38 * 60000, remarks: "Sensor realigned & tested — awaiting requester verification" },
      ] },

    { id: "wo6", woNumber: "PLT001-WO-2026-1052", machine: equipmentById("AST-0157"), department: "Press Shop", type: "Breakdown", priority: "P1", status: "Closed", impact: "full_stoppage", safetyRisk: { flag: true, severity: "High" }, environmentalRisk: { flag: false }, estDowntime: { value: 5, unit: "Hours" }, description: "Pressure valve failure, full stoppage.", requestedBy: "Operator Team", requesterPhone: "98450 66778", assignedTo: [TECHNICIANS[0]], photos: [], videos: [],
      progressLog: [{ note: "Isolated line, replaced pressure relief valve, re-pressurized and tested.", actor: "Arun Kumar", t: now - 20 * 24 * 3600e3 + 18000000 }],
      resolutionNotes: "Pressure relief valve replaced with OEM part. Old valve sent for failure analysis.",
      createdAt: now - 20 * 24 * 3600e3,
      history: [
        { status: "New", actor: "Operator Team", t: now - 20 * 24 * 3600e3 },
        { status: "Assigned", actor: "Priya Nair", t: now - 20 * 24 * 3600e3 + 600000 },
        { status: "Accepted", actor: "Arun Kumar", t: now - 20 * 24 * 3600e3 + 900000 },
        { status: "In Progress", actor: "Arun Kumar", t: now - 20 * 24 * 3600e3 + 1200000 },
        { status: "Resolved", actor: "Arun Kumar", t: now - 20 * 24 * 3600e3 + 18000000, remarks: "Valve replaced" },
        { status: "Verified", actor: "Operator Team", t: now - 20 * 24 * 3600e3 + 18700000, remarks: "Confirmed fixed — line running normally" },
        { status: "Closed", actor: "Operator Team", t: now - 20 * 24 * 3600e3 + 18700000 },
      ] },
  ];
}

/* ---------------------------------------------------------------
   NOTIFICATIONS — derived from work-order events, per role
----------------------------------------------------------------*/
function getNotificationsForUser(workOrders, currentUser) {
  const items = [];
  workOrders.forEach((w) => {
    if ((currentUser.role === "Supervisor" || currentUser.role === "HOD") && w.status === "New") {
      items.push({ t: w.createdAt, wo: w, text: `${w.woNumber} needs a technician assigned`, color: T.p1 });
    }
    if (isAssigneeOf(w, currentUser) && w.status === "Assigned") {
      items.push({ t: w.history[w.history.length - 1].t, wo: w, text: `You've been assigned ${w.woNumber} — respond`, color: T.amber });
    }
    if (isRequesterOf(w, currentUser) && w.status === "Resolved") {
      items.push({ t: w.history[w.history.length - 1].t, wo: w, text: `${w.woNumber} was resolved — please verify`, color: T.good });
    }
    if (currentUser.role === "HOD") {
      const elapsed = Date.now() - w.createdAt;
      if (SLA_MATRIX[w.priority].resolutionMs - elapsed < 0 && w.status !== "Closed") {
        items.push({ t: w.createdAt, wo: w, text: `${w.woNumber} has breached its SLA`, color: T.p1 });
      }
    }
  });
  return items.sort((a, b) => b.t - a.t).slice(0, 8);
}

function NotificationBell({ workOrders, currentUser, onOpen }) {
  const [open, setOpen] = useState(false);
  const items = getNotificationsForUser(workOrders, currentUser);
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", cursor: "pointer", position: "relative" }}>
        <Bell size={19} color={T.inkSoft} />
        {items.length > 0 && <span style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: 4, background: T.p1 }} />}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 30, width: 320, background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: "0 12px 32px rgba(15,23,42,.15)", zIndex: 50 }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.border}`, fontWeight: 700, fontSize: 13, color: T.ink }}>Notifications</div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {items.length === 0 && <div style={{ padding: 20, fontSize: 12.5, color: T.inkSoft, textAlign: "center" }}>You're all caught up.</div>}
            {items.map((n, i) => (
              <div key={i} onClick={() => { onOpen(n.wo.id); setOpen(false); }} className="flex items-start gap-2" style={{ padding: "10px 16px", borderTop: i > 0 ? "1px solid #F1F3F5" : "none", cursor: "pointer" }}>
                <div style={{ width: 7, height: 7, borderRadius: 4, background: n.color, marginTop: 5, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12.5, color: T.ink }}>{n.text}</div>
                  <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{new Date(n.t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   ASSIGNMENT — Supervisor / HOD assign or reassign a technician
================================================================ */
function AssignPanel({ wo, onAssign, canAssign }) {
  const bestMatch = TECHNICIANS.filter((t) => t.skills.some((s) => wo.department.toLowerCase().includes(s.toLowerCase()) || wo.machine.name.toLowerCase().includes(s.toLowerCase())));
  return (
    <div>
      <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 14 }}>
        Currently assigned: {wo.assignedTo.length ? <strong style={{ color: T.ink }}>{wo.assignedTo.map((t) => t.name).join(", ")}</strong> : "Unassigned — waiting on Supervisor"}
      </div>
      {!canAssign && <div style={{ background: T.fog, borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: T.inkSoft, marginBottom: 14 }}>Only a Supervisor or HOD can assign or reassign a technician.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TECHNICIANS.map((t) => {
          const isAssigned = wo.assignedTo.some((a) => a.id === t.id);
          const isBest = bestMatch.some((b) => b.id === t.id);
          return (
            <div key={t.id} className="flex items-center justify-between" style={{ padding: "10px 14px", borderRadius: 12, border: `1.5px solid ${isAssigned ? T.amber : T.border}`, background: isAssigned ? "#FDE7C4" : "#fff" }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 30, height: 30, borderRadius: 15, background: T.graphite, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                  {t.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{t.name} {isBest && <span style={{ background: "#E7F5EE", color: T.good, fontSize: 10.5, borderRadius: 4, padding: "1px 6px", marginLeft: 6, fontWeight: 700 }}>Best match</span>}</div>
                  <div style={{ fontSize: 11.5, color: T.inkSoft }}>{t.skills.join(" · ")} — {t.load} open jobs</div>
                </div>
              </div>
              {canAssign && <Btn size="sm" variant={isAssigned ? "success" : "ghost"} icon={isAssigned ? CheckCircle2 : UserCheck} onClick={() => onAssign(t)}>{isAssigned ? "Assigned" : wo.assignedTo.length ? "Reassign" : "Assign"}</Btn>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================
   PROGRESS LOG — Technician logs updates while attending
================================================================ */
function ProgressLogPanel({ wo, onAddNote, canLog }) {
  const [note, setNote] = useState("");
  function submit() { if (note.trim()) { onAddNote(note.trim()); setNote(""); } }
  return (
    <div>
      {canLog && (
        <div className="flex gap-2" style={{ marginBottom: 16 }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a progress update…" style={{ ...inputStyle, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          <Btn variant="amber" icon={Plus} onClick={submit}>Log</Btn>
        </div>
      )}
      {wo.progressLog.length === 0 && <div style={{ fontSize: 13, color: T.inkSoft }}>No progress logged yet.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {wo.progressLog.slice().reverse().map((p, i) => (
          <div key={i} style={{ background: T.fog, borderRadius: 12, padding: "10px 14px" }}>
            <div style={{ fontSize: 13, color: T.ink }}>{p.note}</div>
            <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 4 }}>{p.actor} · {new Date(p.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        ))}
      </div>
      {wo.resolutionNotes && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.good, marginBottom: 6 }}>Resolution notes</div>
          <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.6 }}>{wo.resolutionNotes}</div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   ATTACHMENTS
================================================================ */
function AttachmentsPanel({ wo, onAddPhoto, onAddVideo }) {
  const photoInput = useRef(null); const videoInput = useRef(null);
  return (
    <div className="flex gap-6" style={{ flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: T.ink }}>Photos ({wo.photos.length})</div>
          <Btn size="sm" variant="ghost" icon={ImageIcon} onClick={() => photoInput.current.click()}>Upload</Btn>
          <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={onAddPhoto} />
        </div>
        <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
          {wo.photos.length === 0 && <div style={{ fontSize: 12.5, color: T.inkSoft }}>No photos uploaded yet.</div>}
          {wo.photos.map((p, i) => <img key={i} src={p.url} alt={p.name} style={{ width: 72, height: 72, borderRadius: 12, objectFit: "cover", border: `1px solid ${T.border}`, boxShadow: T.shadow }} />)}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: T.ink }}>Videos ({wo.videos.length})</div>
          <Btn size="sm" variant="ghost" icon={Video} onClick={() => videoInput.current.click()}>Upload</Btn>
          <input ref={videoInput} type="file" accept="video/*" multiple hidden onChange={onAddVideo} />
        </div>
        {wo.videos.length === 0 && <div style={{ fontSize: 12.5, color: T.inkSoft }}>No videos uploaded yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {wo.videos.map((v, i) => <div key={i} className="flex items-center gap-2" style={{ fontSize: 12.5, background: T.fog, borderRadius: 6, padding: "8px 10px" }}><Video size={14} color={T.inkSoft} /> {v.name}</div>)}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   STATUS TIMELINE
================================================================ */
function StatusTimeline({ wo }) {
  const flowIndex = STATUS_FLOW.indexOf(wo.status);
  const lastEvent = wo.history[wo.history.length - 1];
  return (
    <div>
      {STATUS_FLOW.map((s, i) => {
        const event = wo.history.find((h) => h.status === s);
        const done = i <= flowIndex;
        const isCurrent = s === wo.status;
        return (
          <div key={s} className="flex" style={{ gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: done ? (isCurrent ? T.amber : T.good) : "#E7EAEE", border: isCurrent ? `2px solid ${T.amber}` : "none" }}>
                {done && !isCurrent && <CheckCircle2 size={13} color="#fff" />}
              </div>
              {i < STATUS_FLOW.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 28, background: i < flowIndex ? T.good : "#E7EAEE" }} />}
            </div>
            <div style={{ paddingBottom: 22 }}>
              <div style={{ fontSize: 13.5, fontWeight: isCurrent ? 700 : 500, color: done ? T.ink : T.inkSoft }}>{s}</div>
              {event ? (
                <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>
                  {event.actor} · {new Date(event.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {event.remarks && <div style={{ marginTop: 2, color: T.ink }}>{event.remarks}</div>}
                </div>
              ) : <div style={{ fontSize: 12, color: "#B7BEC6", marginTop: 2 }}>Pending</div>}
            </div>
          </div>
        );
      })}
      {wo.status === "On Hold" && (
        <div className="flex items-center gap-2" style={{ background: "#FCE9E9", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: T.p1, marginTop: 4 }}>
          <PauseCircle size={15} /> {lastEvent?.remarks || "On hold"}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   WORKFLOW — role-gated actions for every step of the loop
================================================================ */
function WorkflowPanel({ wo, role, currentUser, onAction }) {
  const assignee = isAssigneeOf(wo, currentUser);
  const requester = isRequesterOf(wo, currentUser);
  const isSupervisorLike = role === "Supervisor" || role === "HOD";
  const [declineReason, setDeclineReason] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [showReopen, setShowReopen] = useState(false);

  const infoBox = (text) => <div style={{ background: T.fog, borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 12.5, color: T.inkSoft }}>{text}</div>;

  if (wo.status === "New") {
    if (isSupervisorLike) return <div>{infoBox("This work order needs a technician. Go to the Assignment tab to assign one.")}<Btn variant="amber" icon={UserCheck} onClick={() => onAction("__gotoAssign")}>Assign a technician</Btn></div>;
    return infoBox("Waiting for a Supervisor to assign a technician.");
  }

  if (wo.status === "Assigned") {
    if (assignee) {
      return (
        <div>
          {infoBox("You've been assigned this work order. Accept it to start, or decline with a reason so the Supervisor can reassign.")}
          <div className="flex gap-2" style={{ marginBottom: showDecline ? 12 : 0 }}>
            <Btn variant="success" icon={CheckCircle2} onClick={() => onAction("Accepted", "Accepted by technician")}>Accept</Btn>
            <Btn variant="danger" icon={Ban} onClick={() => setShowDecline((s) => !s)}>Decline</Btn>
          </div>
          {showDecline && (
            <div className="flex gap-2" style={{ marginTop: 10 }}>
              <input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason for declining…" style={{ ...inputStyle, flex: 1 }} />
              <Btn variant="danger" disabled={!declineReason} onClick={() => { onAction("New", `Declined by ${currentUser.name}: ${declineReason}`, { assignedTo: [] }); setShowDecline(false); }}>Confirm decline</Btn>
            </div>
          )}
        </div>
      );
    }
    if (isSupervisorLike) return <div>{infoBox(`Waiting for ${wo.assignedTo[0]?.name || "the technician"} to accept.`)}<Btn variant="ghost" icon={UserCheck} onClick={() => onAction("__gotoAssign")}>Reassign</Btn></div>;
    return infoBox(`Assigned to ${wo.assignedTo[0]?.name || "a technician"} — waiting for them to accept.`);
  }

  if (wo.status === "Accepted") {
    if (assignee) return <div>{infoBox("You've accepted this job. Start work when you're on site.")}<Btn variant="amber" icon={PlayCircle} onClick={() => onAction("In Progress", "Technician attending on site")}>Attend / Start job</Btn></div>;
    return infoBox(`${wo.assignedTo[0]?.name || "Technician"} has accepted and will attend shortly.`);
  }

  if (wo.status === "In Progress") {
    if (assignee) {
      return (
        <div>
          {infoBox("Log progress updates as you work. When the issue is fixed, mark it resolved so the requester can verify.")}
          <div className="flex gap-2" style={{ marginBottom: showResolve ? 12 : 0, flexWrap: "wrap" }}>
            <Btn variant="ghost" icon={PauseCircle} onClick={() => onAction("On Hold", "Put on hold")}>Put on hold</Btn>
            <Btn variant="success" icon={CheckCircle2} onClick={() => setShowResolve((s) => !s)}>Mark Resolved</Btn>
          </div>
          {showResolve && (
            <div>
              <textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} rows={3} placeholder="What did you do to fix it? (visible to requester)" style={{ ...inputStyle, resize: "vertical", marginBottom: 8 }} />
              <Btn variant="success" icon={Send} disabled={!resolutionNotes} onClick={() => { onAction("Resolved", "Marked resolved — awaiting requester verification", { resolutionNotes }); setShowResolve(false); }}>Submit for verification</Btn>
            </div>
          )}
        </div>
      );
    }
    return infoBox(`${wo.assignedTo[0]?.name || "Technician"} is attending to this work order.`);
  }

  if (wo.status === "On Hold") {
    if (assignee) return <div>{infoBox("This job is on hold.")}<Btn variant="amber" icon={PlayCircle} onClick={() => onAction("In Progress", "Resumed")}>Resume</Btn></div>;
    return infoBox("This work order is on hold.");
  }

  if (wo.status === "Resolved") {
    if (requester) {
      return (
        <div>
          {infoBox("The technician marked this resolved. Please verify the fix before it's closed.")}
          <div className="flex gap-2" style={{ marginBottom: showReopen ? 12 : 0 }}>
            <Btn variant="success" icon={ThumbsUp} onClick={() => onAction("__verify")}>Confirm fixed — Close</Btn>
            <Btn variant="danger" icon={RotateCcw} onClick={() => setShowReopen((s) => !s)}>Not fixed</Btn>
          </div>
          {showReopen && (
            <div className="flex gap-2" style={{ marginTop: 10 }}>
              <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="What's still wrong?" style={{ ...inputStyle, flex: 1 }} />
              <Btn variant="danger" disabled={!reopenReason} onClick={() => { onAction("In Progress", `Reopened by requester: ${reopenReason}`); setShowReopen(false); }}>Reopen</Btn>
            </div>
          )}
        </div>
      );
    }
    if (role === "HOD") return <div>{infoBox("Awaiting requester verification. As HOD you can override and close directly if the requester is unresponsive.")}<Btn variant="ghost" icon={ThumbsUp} onClick={() => onAction("__verify")}>Force verify & close</Btn></div>;
    return infoBox("Waiting for the requester to verify the fix.");
  }

  return infoBox("This work order is closed. Verified and archived — cost and history have been finalized.");
}

/* ================================================================
   WORK ORDER DETAIL — shared shell, role-gated tabs & actions
================================================================ */
function WorkOrderDetail({ wo, onBack, onUpdate, role, currentUser, onNotify }) {
  const [tab, setTab] = useState("overview");
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "assignment", label: "Assignment" },
    { key: "progress", label: "Progress Log" },
    { key: "attachments", label: "Attachments" },
    { key: "timeline", label: "Status Timeline" },
    { key: "workflow", label: "Workflow" },
  ];
  const elapsed = Date.now() - wo.createdAt;
  const remain = SLA_MATRIX[wo.priority].resolutionMs - elapsed;
  const breached = remain < 0 && wo.status !== "Closed";
  const canAssign = role === "Supervisor" || role === "HOD";
  const canLogProgress = isAssigneeOf(wo, currentUser) && ["Accepted", "In Progress", "On Hold"].includes(wo.status);

  function pushHistory(status, remarks, patch = {}) {
    onUpdate({ ...wo, ...patch, status, history: [...wo.history, { status, actor: currentUser.name, t: Date.now(), remarks }] });
  }
  function handleAssign(t) {
    const already = wo.assignedTo.some((a) => a.id === t.id);
    const assignedTo = already ? [] : [t];
    const status = already ? "New" : "Assigned";
    onUpdate({ ...wo, assignedTo, status, history: [...wo.history, { status, actor: currentUser.name, t: Date.now(), remarks: already ? `Unassigned ${t.name}` : `Assigned to ${t.name}` }] });
    if (!already) onNotify(`${t.name} notified — awaiting their acceptance.`);
  }
  function handleWorkflowAction(next, remarks, patch = {}) {
    if (next === "__gotoAssign") { setTab("assignment"); return; }
    if (next === "__verify") {
      onUpdate({ ...wo, status: "Closed", history: [...wo.history, { status: "Verified", actor: currentUser.name, t: Date.now(), remarks: "Confirmed fixed by requester" }, { status: "Closed", actor: currentUser.name, t: Date.now() + 1 }] });
      onNotify(`${wo.woNumber} verified and closed.`);
      return;
    }
    pushHistory(next, remarks, patch);
    if (next === "New" && remarks?.startsWith("Declined")) onNotify(`${currentUser.name} declined — back with Supervisor for reassignment.`);
    if (next === "Resolved") onNotify(`${wo.requestedBy} notified to verify the fix.`);
    if (next === "In Progress" && remarks?.startsWith("Reopened")) onNotify(`Reopened — ${wo.assignedTo[0]?.name || "technician"} notified.`);
  }
  function handlePhoto(e) { const files = Array.from(e.target.files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f) })); onUpdate({ ...wo, photos: [...wo.photos, ...files] }); }
  function handleVideo(e) { const files = Array.from(e.target.files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f) })); onUpdate({ ...wo, videos: [...wo.videos, ...files] }); }
  function handleAddNote(note) { onUpdate({ ...wo, progressLog: [...wo.progressLog, { note, actor: currentUser.name, t: Date.now() }] }); }

  return (
    <div className="rise" style={{ maxWidth: 980 }}>
      <button onClick={onBack} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}><ArrowLeft size={15} /> Back to Work Orders</button>
      <div className="flex items-center justify-between" style={{ marginBottom: 6, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="flex items-center gap-3">
            <span className="f-mono" style={{ fontSize: 13, color: T.inkSoft }}>{wo.woNumber}</span>
            <PriorityBadge p={wo.priority} /><StatusBadge s={wo.status} />
          </div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink, marginTop: 6 }}>{wo.machine.name}</h1>
        </div>
        <div className="flex items-center gap-2" style={{ background: breached ? "#FCE9E9" : T.fog, borderRadius: 12, padding: "10px 14px" }}>
          <Timer size={15} color={breached ? T.p1 : T.inkSoft} />
          <div>
            <div style={{ fontSize: 11, color: T.inkSoft }}>Resolution SLA</div>
            <div className="f-mono" style={{ fontSize: 13, fontWeight: 700, color: breached ? T.p1 : T.ink }}>{wo.status === "Closed" ? "Closed" : breached ? "Breached" : fmtDue(remain) + " left"}</div>
          </div>
        </div>
      </div>
      <div className="flex gap-1" style={{ borderBottom: `1px solid ${T.border}`, marginBottom: 20, marginTop: 18, flexWrap: "wrap" }}>
        {tabs.map((t) => <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: tab === t.key ? T.ink : T.inkSoft, borderBottom: tab === t.key ? `2.5px solid ${T.amber}` : "2.5px solid transparent" }}>{t.label}</button>)}
      </div>
      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 24 }}>
        {tab === "overview" && (
          <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              {[["Equipment", wo.machine.name], ["Department", wo.department], ["Type", wo.type], ["Production impact", IMPACT_OPTIONS.find((i) => i.value === wo.impact)?.label || "—"], ["Estimated downtime", `${wo.estDowntime.value} ${wo.estDowntime.unit}`], ["Requested by", wo.requestedBy], ["Requester phone", wo.requesterPhone || "—"], ["Safety risk", wo.safetyRisk?.flag ? `Yes (${wo.safetyRisk.severity})` : "No"], ["Environmental risk", wo.environmentalRisk?.flag ? "Yes" : "No"], ["Permit / LOTO required", wo.safetyRisk?.flag ? "Yes" : "No"]].map(([label, val]) => (
                <div key={label} className="flex justify-between" style={{ padding: "9px 0", borderBottom: "1px solid #F1F3F5", fontSize: 13.5 }}><span style={{ color: T.inkSoft }}>{label}</span><span style={{ color: T.ink, fontWeight: 500, textAlign: "right" }}>{val}</span></div>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, marginBottom: 8 }}>Complaint</div>
              <p style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.6, marginBottom: 20 }}>{wo.description}</p>
              <div style={{ background: T.fog, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 10 }}>SLA targets ({wo.priority})</div>
                {[["Acknowledge", SLA_MATRIX[wo.priority].ack], ["Response", SLA_MATRIX[wo.priority].response], ["Resolution", SLA_MATRIX[wo.priority].resolution]].map(([l, v]) => (
                  <div key={l} className="flex justify-between" style={{ fontSize: 12.5, padding: "4px 0" }}><span style={{ color: T.inkSoft }}>{l}</span><span className="f-mono" style={{ color: T.ink, fontWeight: 600 }}>{v}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === "assignment" && <AssignPanel wo={wo} onAssign={handleAssign} canAssign={canAssign} />}
        {tab === "progress" && <ProgressLogPanel wo={wo} onAddNote={handleAddNote} canLog={canLogProgress} />}
        {tab === "attachments" && <AttachmentsPanel wo={wo} onAddPhoto={handlePhoto} onAddVideo={handleVideo} />}
        {tab === "timeline" && <StatusTimeline wo={wo} />}
        {tab === "workflow" && <WorkflowPanel wo={wo} role={role} currentUser={currentUser} onAction={handleWorkflowAction} />}
      </div>
    </div>
  );
}

/* ================================================================
   WORK ORDER LIST — role-scoped
================================================================ */
function WorkOrderList({ workOrders, onOpen, onCreate, role, currentUser }) {
  const [fPriority, setFPriority] = useState("All"); const [fStatus, setFStatus] = useState("All"); const [q, setQ] = useState("");

  const scoped = workOrders.filter((w) => {
    if (role === "Requester") return w.requestedBy === currentUser.name;
    if (role === "Technician") return w.assignedTo.some((a) => a.id === currentUser.techId);
    return true;
  });
  const needsAssignment = scoped.filter((w) => w.status === "New").length;
  const needsMyResponse = role === "Technician" ? scoped.filter((w) => w.status === "Assigned").length : 0;

  const filtered = scoped.filter((w) => {
    if (fPriority !== "All" && w.priority !== fPriority) return false;
    if (fStatus !== "All" && w.status !== fStatus) return false;
    if (q && !(w.machine.name.toLowerCase().includes(q.toLowerCase()) || w.woNumber.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const titles = { Requester: "My Work Orders", Technician: "My Tasks", Supervisor: "Work Orders", HOD: "Work Orders — Oversight" };

  return (
    <div className="rise">
      <div className="flex items-center justify-between" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div><h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink }}>{titles[role]}</h1><p style={{ fontSize: 13, color: T.inkSoft }}>{filtered.length} of {scoped.length} work orders</p></div>
        {role !== "Technician" && <Btn variant="amber" icon={Plus} onClick={onCreate}>Raise Work Order</Btn>}
      </div>

      {(role === "Supervisor" || role === "HOD") && needsAssignment > 0 && (
        <div className="flex items-center gap-2" style={{ background: "#FDE7C4", border: `1px solid ${T.amber}55`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#8A5A0A" }}>
          <AlertTriangle size={15} /> <strong>{needsAssignment}</strong> work order{needsAssignment !== 1 ? "s" : ""} need{needsAssignment === 1 ? "s" : ""} a technician assigned.
        </div>
      )}
      {role === "Technician" && needsMyResponse > 0 && (
        <div className="flex items-center gap-2" style={{ background: "#FDE7C4", border: `1px solid ${T.amber}55`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#8A5A0A" }}>
          <AlertTriangle size={15} /> <strong>{needsMyResponse}</strong> new assignment{needsMyResponse !== 1 ? "s" : ""} awaiting your response.
        </div>
      )}

      <div className="flex items-center gap-3" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <div className="flex items-center gap-2" style={{ background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: "7px 12px", width: 260 }}>
          <Search size={14} color={T.inkSoft} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search WO# or equipment…" style={{ border: "none", outline: "none", fontSize: 13, width: "100%" }} />
        </div>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} style={{ ...inputStyle, width: 150, padding: "8px 10px" }}><option>All</option><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ ...inputStyle, width: 190, padding: "8px 10px" }}><option>All</option>{STATUS_FLOW.concat(["On Hold"]).map((s) => <option key={s}>{s}</option>)}</select>
        <Btn variant="ghost" icon={Download} size="sm">Export</Btn>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden" }}>
        <div className="flex items-center" style={{ padding: "10px 18px", background: T.fog, fontSize: 11.5, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", letterSpacing: "0.03em" }}>
          <div style={{ flex: 2 }}>Work Order</div><div style={{ flex: 1.4 }}>Department</div><div style={{ width: 70 }}>Priority</div><div style={{ flex: 1.4 }}>Status</div><div style={{ flex: 1.2 }}>Assigned</div><div style={{ width: 100, textAlign: "right" }}>SLA</div>
        </div>
        {filtered.map((w, i) => {
          const elapsed = Date.now() - w.createdAt; const remain = SLA_MATRIX[w.priority].resolutionMs - elapsed;
          return (
            <div key={w.id} onClick={() => onOpen(w.id)} className="flex items-center" style={{ padding: "13px 18px", borderTop: i > 0 ? "1px solid #F1F3F5" : "none", cursor: "pointer" }}>
              <div style={{ flex: 2, minWidth: 0 }}><div className="f-mono" style={{ fontSize: 11.5, color: T.inkSoft }}>{w.woNumber}</div><div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{w.machine.name}</div></div>
              <div style={{ flex: 1.4, fontSize: 13, color: T.inkSoft }}>{w.department}</div>
              <div style={{ width: 70 }}><PriorityBadge p={w.priority} size="sm" /></div>
              <div style={{ flex: 1.4 }}><StatusBadge s={w.status} /></div>
              <div style={{ flex: 1.2, fontSize: 13, color: T.ink }}>{w.assignedTo.length ? w.assignedTo.map((t) => t.name).join(", ") : <span style={{ color: T.inkSoft }}>Unassigned</span>}</div>
              <div className="f-mono" style={{ width: 100, textAlign: "right", fontSize: 11.5, color: remain < 0 ? T.p1 : T.inkSoft, fontWeight: remain < 0 ? 700 : 400 }}>{w.status === "Closed" ? "—" : remain < 0 ? "Breached" : fmtDue(remain) + " left"}</div>
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: T.inkSoft, fontSize: 13 }}>No work orders match these filters.</div>}
      </div>
    </div>
  );
}

/* ================================================================
   RAISE WORK ORDER
================================================================ */
function RaiseWorkOrder({ onCancel, onCreated, currentUser }) {
  const [department, setDepartment] = useState("");
  const [machineId, setMachineId] = useState("");
  const [type, setType] = useState("Breakdown");
  const [complaint, setComplaint] = useState("");
  const [priority, setPriority] = useState(""); const [priorityTouched, setPriorityTouched] = useState(false);
  const [impact, setImpact] = useState("");
  const [photos, setPhotos] = useState([]); const [videos, setVideos] = useState([]);
  const [downtimeValue, setDowntimeValue] = useState(""); const [downtimeUnit, setDowntimeUnit] = useState("Hours");
  const [safetyFlag, setSafetyFlag] = useState(false); const [safetySeverity, setSafetySeverity] = useState("Medium");
  const [envFlag, setEnvFlag] = useState(false);
  const [requester, setRequester] = useState(currentUser.name);
  const [phone, setPhone] = useState(currentUser.phone || "");
  const [errors, setErrors] = useState({});
  const photoInput = useRef(null); const videoInput = useRef(null);

  const machine = equipmentById(machineId);
  const safety = { flag: safetyFlag, severity: safetySeverity };
  const env = { flag: envFlag };
  const suggestion = computeSuggestion(impact, safety, env);
  const effectivePriority = priorityTouched ? priority : suggestion;

  function handleMachineChange(id) { setMachineId(id); const m = equipmentById(id); if (m && !department) setDepartment(m.department); }
  function handlePhotoUpload(e) { const files = Array.from(e.target.files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f) })); setPhotos((p) => [...p, ...files]); }
  function handleVideoUpload(e) { const files = Array.from(e.target.files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f) })); setVideos((v) => [...v, ...files]); }

  function handleSubmit() {
    const errs = {};
    if (!department) errs.department = "Select a department.";
    if (!machineId) errs.machine = "Select the affected equipment.";
    if (!complaint || complaint.length < 10) errs.complaint = "Describe the complaint (min. 10 characters).";
    if (!impact) errs.impact = "Select the production impact.";
    if (!downtimeValue) errs.downtime = "Estimate the downtime.";
    if (!requester) errs.requester = "Requester name is required.";
    if (!phone || phone.replace(/\D/g, "").length < 7) errs.phone = "Enter a valid phone number.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const finalPriority = effectivePriority || "P3"; const now = Date.now();
    onCreated({
      id: "wo" + Math.random().toString(36).slice(2, 8), woNumber: `PLT001-WO-2026-${Math.floor(1200 + Math.random() * 800)}`,
      machine, department, type, priority: finalPriority, status: "New", impact,
      estDowntime: { value: downtimeValue, unit: downtimeUnit }, description: complaint,
      safetyRisk: safety, environmentalRisk: env,
      requestedBy: requester, requesterPhone: phone, assignedTo: [], photos, videos, progressLog: [], createdAt: now,
      history: [{ status: "New", actor: requester, t: now, remarks: "Raised via Work Order form" }],
    });
  }

  return (
    <div className="rise" style={{ maxWidth: 900 }}>
      <button onClick={onCancel} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}><ArrowLeft size={15} /> Back to Work Orders</button>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Raise Work Order</h1>
      <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 24 }}>Priority is suggested automatically and escalates for safety or environmental risk.</p>

      <div className="flex gap-6" style={{ flexWrap: "wrap" }}>
        <div style={{ flex: 2, minWidth: 380 }}>
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 22 }}>

            <Field label="Department" required hint={errors.department}>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ ...inputStyle, borderColor: errors.department ? T.p1 : "#D8DEE4" }}>
                <option value="">Select department…</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>

            <Field label="Equipment" required hint={errors.machine}>
              <select value={machineId} onChange={(e) => handleMachineChange(e.target.value)} style={{ ...inputStyle, borderColor: errors.machine ? T.p1 : "#D8DEE4" }}>
                <option value="">Select equipment…</option>{EQUIPMENT.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
              </select>
            </Field>
            {machine && <div className="flex items-center gap-2" style={{ background: T.fog, borderRadius: 12, padding: "8px 12px", marginBottom: 16, fontSize: 12.5, color: T.inkSoft }}><Factory size={14} /> Criticality: <strong style={{ color: T.ink }}>{machine.criticality}</strong><span style={{ margin: "0 4px" }}>·</span> Asset ID: <span className="f-mono">{machine.id}</span></div>}

            <Field label="Work order type"><div className="flex gap-2">{["Breakdown", "Inspection", "Project"].map((t) => <button key={t} onClick={() => setType(t)} style={{ padding: "8px 14px", borderRadius: 12, fontSize: 13, cursor: "pointer", border: `1.5px solid ${type === t ? T.ink : "#D8DEE4"}`, background: type === t ? T.ink : "#fff", color: type === t ? "#fff" : T.ink, fontWeight: 500 }}>{t}</button>)}</div></Field>

            <Field label="Complaint" required hint={errors.complaint}>
              <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={4} placeholder="What happened? Include symptoms, sounds, error codes…" style={{ ...inputStyle, resize: "vertical", borderColor: errors.complaint ? T.p1 : "#D8DEE4" }} />
            </Field>

            <Field label="Priority" required>
              <div className="flex gap-2">
                {["P1", "P2", "P3", "P4"].map((p) => (
                  <button key={p} onClick={() => { setPriority(p); setPriorityTouched(true); }} style={{ flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 700, border: `1.5px solid ${effectivePriority === p ? PRIORITY_COLORS[p] : "#D8DEE4"}`, background: effectivePriority === p ? `${PRIORITY_COLORS[p]}1A` : "#fff", color: effectivePriority === p ? PRIORITY_COLORS[p] : T.inkSoft }}>{p}</button>
                ))}
              </div>
            </Field>

            <div style={{ background: suggestion ? `${PRIORITY_COLORS[suggestion]}0D` : T.fog, border: `1px solid ${suggestion ? PRIORITY_COLORS[suggestion] + "55" : T.border}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: suggestion ? 8 : 0 }}>
                <Sparkles size={14} color={T.amber} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>Auto Priority Suggestion</span>
              </div>
              {suggestion ? (
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 12.5, color: T.inkSoft }}>
                    Based on production impact{safetyFlag ? " + safety risk" : ""}{envFlag ? " + environmental risk" : ""}, the system recommends <strong style={{ color: PRIORITY_COLORS[suggestion] }}>{suggestion}</strong>.
                  </span>
                  {priorityTouched && priority !== suggestion && (
                    <button onClick={() => { setPriority(suggestion); setPriorityTouched(true); }} style={{ background: "none", border: "none", color: T.amber, fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 10 }}>Apply →</button>
                  )}
                </div>
              ) : <span style={{ fontSize: 12.5, color: T.inkSoft }}>Select production impact below (and any risk flags) to see a suggestion.</span>}
            </div>

            <Field label="Production impact" required hint={errors.impact}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {IMPACT_OPTIONS.map((opt) => (
                  <label key={opt.value} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 12, border: `1.5px solid ${impact === opt.value ? T.amber : "#E2E6EA"}`, background: impact === opt.value ? "#FDE7C4" : "#fff", cursor: "pointer" }}>
                    <span className="flex items-center gap-2" style={{ fontSize: 13.5, color: T.ink }}><input type="radio" checked={impact === opt.value} onChange={() => setImpact(opt.value)} style={{ accentColor: T.amber }} />{opt.label}</span>
                    <PriorityBadge p={opt.suggests} size="sm" />
                  </label>
                ))}
              </div>
            </Field>

            <div className="flex gap-4" style={{ flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, marginBottom: 8 }}>Upload Photo</div>
                <button onClick={() => photoInput.current.click()} className="flex items-center justify-center gap-2" style={{ width: "100%", padding: "18px", border: "1.5px dashed #D8DEE4", borderRadius: 12, background: T.fog, cursor: "pointer", color: T.inkSoft, fontSize: 13 }}><ImageIcon size={16} /> Upload photo</button>
                <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={handlePhotoUpload} />
                {photos.length > 0 && <div className="flex gap-2" style={{ marginTop: 10, flexWrap: "wrap" }}>{photos.map((p, i) => <div key={i} style={{ position: "relative", width: 64, height: 64, borderRadius: 12, overflow: "hidden", border: `1px solid ${T.border}`, boxShadow: T.shadow }}><img src={p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /><button onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))} style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,.6)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", padding: 2 }}><X size={11} /></button></div>)}</div>}
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, marginBottom: 8 }}>Upload Video</div>
                <button onClick={() => videoInput.current.click()} className="flex items-center justify-center gap-2" style={{ width: "100%", padding: "18px", border: "1.5px dashed #D8DEE4", borderRadius: 12, background: T.fog, cursor: "pointer", color: T.inkSoft, fontSize: 13 }}><Video size={16} /> Upload video</button>
                <input ref={videoInput} type="file" accept="video/*" multiple hidden onChange={handleVideoUpload} />
                {videos.length > 0 && <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>{videos.map((v, i) => <div key={i} className="flex items-center justify-between" style={{ fontSize: 12.5, background: T.fog, borderRadius: 6, padding: "6px 10px" }}><span className="flex items-center gap-2" style={{ color: T.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}><Video size={13} color={T.inkSoft} /> {v.name}</span><button onClick={() => setVideos(videos.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: T.inkSoft }}><X size={13} /></button></div>)}</div>}
              </div>
            </div>

            <Field label="Estimated downtime" required hint={errors.downtime}>
              <div className="flex gap-2"><input type="number" min="0" value={downtimeValue} onChange={(e) => setDowntimeValue(e.target.value)} placeholder="e.g. 4" style={{ ...inputStyle, flex: 1, borderColor: errors.downtime ? T.p1 : "#D8DEE4" }} /><select value={downtimeUnit} onChange={(e) => setDowntimeUnit(e.target.value)} style={{ ...inputStyle, width: 130 }}><option>Hours</option><option>Days</option></select></div>
            </Field>

            <Field label="Safety risk">
              <div className="flex items-center gap-3" style={{ marginBottom: safetyFlag ? 10 : 0 }}>
                {["No", "Yes"].map((v) => (
                  <button key={v} onClick={() => setSafetyFlag(v === "Yes")} style={{ padding: "8px 20px", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 600, border: `1.5px solid ${(v === "Yes") === safetyFlag ? T.p1 : "#D8DEE4"}`, background: (v === "Yes") === safetyFlag ? "#FCE9E9" : "#fff", color: (v === "Yes") === safetyFlag ? T.p1 : T.inkSoft }}>{v}</button>
                ))}
              </div>
              {safetyFlag && (
                <div className="flex gap-2">
                  {["Low", "Medium", "High"].map((s) => (
                    <button key={s} onClick={() => setSafetySeverity(s)} style={{ flex: 1, padding: "6px 0", borderRadius: 12, fontSize: 12, cursor: "pointer", fontWeight: 600, border: `1.5px solid ${safetySeverity === s ? T.p1 : "#D8DEE4"}`, background: safetySeverity === s ? "#FCE9E9" : "#fff", color: safetySeverity === s ? T.p1 : T.inkSoft }}>{s}</button>
                  ))}
                </div>
              )}
              {safetyFlag && <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 6 }}>Permit-to-Work / LOTO will be required before work begins.</div>}
            </Field>

            <Field label="Environmental risk">
              <div className="flex items-center gap-3">
                {["No", "Yes"].map((v) => (
                  <button key={v} onClick={() => setEnvFlag(v === "Yes")} style={{ padding: "8px 20px", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 600, border: `1.5px solid ${(v === "Yes") === envFlag ? T.amber : "#D8DEE4"}`, background: (v === "Yes") === envFlag ? "#FDE7C4" : "#fff", color: (v === "Yes") === envFlag ? "#8A5A0A" : T.inkSoft }}>{v}</button>
                ))}
              </div>
              {envFlag && <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8 }}>e.g. chemical spill, emission, or leak risk — EHS will be notified.</div>}
            </Field>

            <div className="flex gap-4">
              <div style={{ flex: 1 }}><Field label="Requester" required hint={errors.requester}><input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Full name" style={{ ...inputStyle, borderColor: errors.requester ? T.p1 : "#D8DEE4" }} /></Field></div>
              <div style={{ flex: 1 }}><Field label="Phone number" required hint={errors.phone}><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" style={{ ...inputStyle, borderColor: errors.phone ? T.p1 : "#D8DEE4" }} /></Field></div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="rise" style={{ background: T.graphite, borderRadius: 12, padding: 20, color: "#fff", position: "sticky", top: 24 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 14 }}><Timer size={15} color={T.amber} /><span style={{ fontWeight: 700, fontSize: 14 }}>SLA preview</span></div>
            {effectivePriority ? (
              <>
                <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
                  <PriorityBadge p={effectivePriority} />
                  <span style={{ fontSize: 12.5, color: "#B9C9E8" }}>{priorityTouched ? "Manually set" : "Auto-suggested"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[["Acknowledge by", SLA_MATRIX[effectivePriority].ack], ["Response by", SLA_MATRIX[effectivePriority].response], ["Resolution by", SLA_MATRIX[effectivePriority].resolution]].map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between" style={{ fontSize: 12.5 }}><span style={{ color: "#B9C9E8" }}>{label}</span><span className="f-mono" style={{ color: "#fff", fontWeight: 600 }}>{val}</span></div>
                  ))}
                </div>
                {(safetyFlag || envFlag) && (
                  <div style={{ borderTop: `1px solid ${T.steelLine}`, marginTop: 14, paddingTop: 12, fontSize: 11.5, color: "#FDE7C4" }}>
                    {safetyFlag && <div className="flex items-center gap-1.5" style={{ marginBottom: 4 }}><AlertTriangle size={12} /> Escalated for safety risk</div>}
                    {envFlag && <div className="flex items-center gap-1.5"><AlertTriangle size={12} /> Escalated for environmental risk</div>}
                  </div>
                )}
              </>
            ) : <p style={{ fontSize: 12.5, color: "#B9C9E8" }}>Fill in the form to see the priority and SLA targets here.</p>}
          </div>
          <div className="flex gap-2" style={{ marginTop: 16 }}>
            <Btn variant="amber" onClick={handleSubmit} icon={Send} style={{ flex: 1, justifyContent: "center" }}>Submit</Btn>
            <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   LOGIN — identity + role selection (the four users this module serves)
================================================================ */
const ROLES = [
  { key: "Requester", icon: UserIcon, desc: "Raise work orders, verify the fix" },
  { key: "Technician", icon: HardHat, desc: "Accept, attend, and resolve jobs" },
  { key: "Supervisor", icon: UsersIcon, desc: "Assign technicians, track SLAs" },
  { key: "HOD", icon: Building2, desc: "Oversight & escalation authority" },
];

function LoginScreen({ onAuthenticated }) {
  const [role, setRole] = useState("Requester");
  const [name, setName] = useState("Ravi Kumar");
  const [phone, setPhone] = useState("98450 11223");
  const [techId, setTechId] = useState(TECHNICIANS[2].id);
  const [status, setStatus] = useState("idle");

  function handleRoleChange(r) {
    setRole(r);
    if (r === "Requester") { setName("Ravi Kumar"); setPhone("98450 11223"); }
    if (r === "Supervisor") { setName("Priya Nair"); setPhone("98450 99001"); }
    if (r === "HOD") { setName("Vikram Shah"); setPhone("98450 88002"); }
    if (r === "Technician") { const t = TECHNICIANS.find((x) => x.id === techId) || TECHNICIANS[2]; setName(t.name); setPhone("98450 77003"); }
  }
  function handleTechChange(id) { setTechId(id); const t = TECHNICIANS.find((x) => x.id === id); setName(t.name); }

  function handleSubmit(e) {
    e.preventDefault();
    setStatus("checking");
    setTimeout(() => {
      setStatus("success");
      setTimeout(() => onAuthenticated({ name, role, phone, techId: role === "Technician" ? techId : null }), 500);
    }, 700);
  }

  return (
    <div className="f-display" style={{ minHeight: "100vh", display: "flex", background: T.graphite }}>
      <FontStyles />
      <div className="hidden md:flex" style={{ flex: "1", background: `linear-gradient(160deg, ${T.graphite} 0%, ${T.graphite2} 100%)`, flexDirection: "column", justifyContent: "space-between", padding: "48px" }}>
        <div className="flex items-center gap-3">
          <Logo size={38} variant="light" />
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 21, lineHeight: 1 }}>SI</div>
            <div className="f-mono" style={{ color: "#9FB6E0", fontSize: 10, letterSpacing: "0.05em", marginTop: 2 }}>SERVICE INSIDE</div>
          </div>
        </div>
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ color: "#fff", fontSize: 28, lineHeight: 1.3, fontWeight: 700, marginBottom: 14 }}>Work Order Management</h1>
          <p style={{ color: "#B9C9E8", fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>Requester raises it. Supervisor assigns it. Technician attends and resolves it. Requester verifies it. Every step, tracked.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {["Requester creates work order", "Supervisor assigns a technician", "Technician accepts, attends & updates progress", "Requester verifies — then it's closed"].map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="f-mono" style={{ width: 22, height: 22, borderRadius: 11, background: T.steel, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
                <span style={{ color: "#DCE6F5", fontSize: 13 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="f-mono" style={{ color: "#5B76AE", fontSize: 12 }}>Work Order Management · v1.0</div>
      </div>

      <div style={{ flex: "1", background: T.fog, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div className="rise" style={{ width: "100%", maxWidth: 400 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Sign in</h2>
          <p style={{ fontSize: 13.5, color: T.inkSoft, marginBottom: 22 }}>Choose your role to see the work order module the way that role sees it.</p>

          <div className="flex" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
            {ROLES.map((r) => (
              <button key={r.key} type="button" onClick={() => handleRoleChange(r.key)} style={{
                textAlign: "left", padding: "12px", borderRadius: 12, cursor: "pointer",
                border: `1.5px solid ${role === r.key ? T.graphite : T.border}`, background: role === r.key ? "#EAF0FB" : "#fff",
              }}>
                <r.icon size={18} color={role === r.key ? T.graphite : T.inkSoft} />
                <div style={{ fontSize: 13, fontWeight: 700, color: role === r.key ? T.graphite : T.ink, marginTop: 6 }}>{r.key}</div>
                <div style={{ fontSize: 10.5, color: T.inkSoft, marginTop: 2, lineHeight: 1.3 }}>{r.desc}</div>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            {role === "Technician" ? (
              <Field label="Which technician are you?" required>
                <select value={techId} onChange={(e) => handleTechChange(e.target.value)} style={inputStyle}>
                  {TECHNICIANS.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.skills.join(", ")}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Full name" required><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} /></Field>
            )}
            <Field label="Phone number"><input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} /></Field>

            <button type="submit" disabled={status !== "idle"} style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", background: status === "success" ? T.good : T.ink, color: "#fff", fontWeight: 600, fontSize: 14, cursor: status === "idle" ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8 }}>
              {status === "checking" && <><Loader2 size={16} className="animate-spin" /> Signing in…</>}
              {status === "success" && <><CheckCircle2 size={16} /> Signed in</>}
              {status === "idle" && <>Continue as {role} <ArrowRight size={15} /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   APP SHELL — Work Order Management only. No other module.
================================================================ */
function AppShell({ user, onSignOut, children, topRight }) {
  return (
    <div className="f-display" style={{ minHeight: "100vh", display: "flex", background: T.fog }}>
      <FontStyles />
      <div style={{ width: 216, background: T.graphite, padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div className="flex items-center gap-2.5" style={{ padding: "0 8px", marginBottom: 24 }}>
          <Logo size={30} variant="light" />
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 15.5, lineHeight: 1 }}>SI</div>
            <div className="f-mono" style={{ color: "#9FB6E0", fontSize: 9, letterSpacing: "0.04em" }}>SERVICE INSIDE</div>
          </div>
        </div>
        <div style={{ padding: "9px 10px", borderRadius: 12, background: T.steel, display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <ClipboardList size={16} color="#fff" />
          <span style={{ color: "#fff", fontSize: 13.5, fontWeight: 600 }}>Work Orders</span>
        </div>
        <div style={{ marginTop: "auto", padding: "12px 8px", borderTop: `1px solid ${T.steelLine}` }}>
          <div className="flex items-center gap-2.5" style={{ marginBottom: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 15, background: T.amber, display: "flex", alignItems: "center", justifyContent: "center", color: T.graphite, fontWeight: 700, fontSize: 12.5 }}>
              {user.name.split(" ").map((n) => n[0]).join("")}
            </div>
            <div>
              <div style={{ color: "#fff", fontSize: 12.5, fontWeight: 600 }}>{user.name}</div>
              <div style={{ color: "#9FB6E0", fontSize: 10.5 }}>{user.role}</div>
            </div>
          </div>
          <button onClick={onSignOut} className="flex items-center gap-2" style={{ background: "none", border: "none", cursor: "pointer", color: "#9FB6E0", fontSize: 12, padding: "6px 2px" }}>
            <LogOut size={13} /> Switch role
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="flex items-center justify-between" style={{ padding: "14px 26px", background: T.fogCard, borderBottom: `1px solid ${T.border}` }}>
          <div className="flex items-center gap-2" style={{ background: T.fog, borderRadius: 12, padding: "7px 12px", width: 320 }}>
            <Search size={15} color={T.inkSoft} />
            <input placeholder="Search work orders…" style={{ border: "none", outline: "none", background: "transparent", fontSize: 13.5, width: "100%" }} />
          </div>
          <div className="flex items-center gap-4">
            {topRight}
            <RoleBadge role={user.role} />
          </div>
        </div>
        <div style={{ padding: "24px 26px", overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ================================================================
   ROOT APP — Work Order Management module only
================================================================ */
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("list"); // list | create | detail
  const [activeId, setActiveId] = useState(null);
  const [workOrders, setWorkOrders] = useState(seedWorkOrders());
  const [toast, setToast] = useState(null);

  function notify(msg) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  if (!user) return <LoginScreen onAuthenticated={setUser} />;

  function openWO(id) { setActiveId(id); setView("detail"); }
  function updateWO(updated) { setWorkOrders((list) => list.map((w) => (w.id === updated.id ? updated : w))); }
  function createWO(wo) {
    setWorkOrders((list) => [wo, ...list]);
    setActiveId(wo.id);
    setView("detail");
    notify(`Work order ${wo.woNumber} created — Supervisor notified.`);
  }

  const activeWo = workOrders.find((w) => w.id === activeId);

  return (
    <>
      <AppShell user={user} onSignOut={() => setUser(null)} topRight={<NotificationBell workOrders={workOrders} currentUser={user} onOpen={openWO} />}>
        {view === "list" && <WorkOrderList workOrders={workOrders} onOpen={openWO} onCreate={() => setView("create")} role={user.role} currentUser={user} />}
        {view === "create" && <RaiseWorkOrder onCancel={() => setView("list")} onCreated={createWO} currentUser={user} />}
        {view === "detail" && activeWo && <WorkOrderDetail wo={activeWo} onBack={() => setView("list")} onUpdate={updateWO} role={user.role} currentUser={user} onNotify={notify} />}
      </AppShell>
      <Toast message={toast} />
    </>
  );
}
