import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Bell, LayoutDashboard, ClipboardList, LogOut, Search, Plus, ArrowLeft, Send, Save,
  CheckCircle2, PlayCircle, RotateCcw, Ban, ThumbsUp, UserCheck, Truck, MapPin, Wrench,
  PackageSearch, FlaskConical, AlertTriangle, Sparkles, Factory, Image as ImageIcon, Video,
  X, MessageSquare, CheckCheck, FileCheck2, UserPlus, RefreshCw, AlertOctagon, Clock,
  Users, Timer, Briefcase, ShieldCheck, HardHat, User as UserIcon, PencilLine,
} from "lucide-react";

/* ============================================================================
   SI — Service Inside · Interactive Preview (mock data, in-memory only)
   Auth + Dashboard + Work Order + Notification modules, all wired together
   with real state transitions — no Firebase, nothing persists on reload.
============================================================================ */

const T = {
  navy: "#0F3D91", navyDeep: "#0B2F70", navyMid: "#1E4FA0",
  canvas: "#F6F8FB", ink: "#101828", inkSoft: "#64748B",
  amber: "#F59E0B", amberSoft: "#FDE7C4", good: "#22C55E", red: "#EF4444", border: "#E5E9F0",
};

const ROLES = { REQUESTER: "requester", TECHNICIAN: "technician", SUPERVISOR: "supervisor", MANAGER: "manager", ADMIN: "admin" };
const ROLE_LABELS = { requester: "Requester", technician: "Technician", supervisor: "Supervisor", manager: "Maintenance Manager", admin: "Administrator" };
const ELEVATED = [ROLES.MANAGER, ROLES.ADMIN];

const STATUS_FLOW = ["open", "assigned", "accepted", "on_the_way", "on_site", "repairing", "waiting_spare_part", "testing", "completed", "verified", "closed"];
const STATUS_LABELS = { open: "Open", assigned: "Assigned", accepted: "Accepted", on_the_way: "On The Way", on_site: "On Site", repairing: "Repairing", waiting_spare_part: "Waiting Spare Part", testing: "Testing", completed: "Completed", verified: "Verified", closed: "Closed" };
const STATUS_COLORS = { open: T.navy, assigned: T.navy, accepted: T.amber, on_the_way: T.amber, on_site: T.amber, repairing: T.amber, waiting_spare_part: T.inkSoft, testing: T.amber, completed: T.amber, verified: T.good, closed: T.good };
const PRIORITY_COLORS = { P1: T.red, P2: T.amber, P3: "#FBBF24", P4: T.navy };
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
const DEPARTMENTS = [
  { id: "DEPT-MACHINING", name: "Machining" },
  { id: "DEPT-ASSEMBLY", name: "Assembly" },
  { id: "DEPT-PRESS", name: "Press Shop" },
];
const EQUIPMENT = [
  { id: "AST-0412", name: "CNC Lathe #04", department_id: "DEPT-MACHINING", criticality: "High" },
  { id: "AST-0157", name: "Hydraulic Press 3", department_id: "DEPT-PRESS", criticality: "High" },
  { id: "AST-0288", name: "Conveyor B-2", department_id: "DEPT-ASSEMBLY", criticality: "Medium" },
];
const TECHNICIANS = [
  { id: "tech-arun", name: "Arun Kumar", skills: ["Mechanical", "Hydraulics"], load: 2 },
  { id: "tech-meera", name: "Meera Iyer", skills: ["Electrical", "PLC"], load: 4 },
  { id: "tech-sanjay", name: "Sanjay Rao", skills: ["Mechanical", "CNC"], load: 1 },
];
const RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };

function suggestPriority(impact) { return IMPACT_OPTIONS.find((i) => i.value === impact)?.suggests || "P3"; }
function computeSuggestion(impact, safety, env) {
  let level = impact ? RANK[suggestPriority(impact)] : null;
  if (safety?.flag) { const esc = safety.severity === "High" ? 1 : 2; level = level ? Math.min(level, esc) : esc; }
  if (env?.flag) level = level ? Math.min(level, 2) : 2;
  return level ? "P" + level : null;
}
function fmtDue(ms) {
  if (ms == null) return "—";
  const sign = ms < 0 ? -1 : 1; const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600e3); const d = Math.floor(h / 24);
  let out = d >= 1 ? `${d}d ${h % 24}h` : h >= 1 ? `${h}h ${Math.floor((abs % 3600e3) / 60000)}m` : `${Math.floor(abs / 60000)}m`;
  return sign < 0 ? `${out} overdue` : out;
}
function fmtRelative(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now"; if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60); if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
let _id = 1000;
function newId(prefix) { return `${prefix}-${_id++}`; }

const USERS = {
  [ROLES.REQUESTER]: { uid: "u-req", name: "Ravi Kumar", role: ROLES.REQUESTER, departmentId: "DEPT-MACHINING", phone: "98450 11223" },
  [ROLES.TECHNICIAN]: { uid: "tech-arun", name: "Arun Kumar", role: ROLES.TECHNICIAN, departmentId: "DEPT-MACHINING", phone: "98450 77003" },
  [ROLES.SUPERVISOR]: { uid: "u-sup", name: "Priya Nair", role: ROLES.SUPERVISOR, departmentId: "DEPT-MACHINING", phone: "98450 99001" },
  [ROLES.MANAGER]: { uid: "u-mgr", name: "Vikram Shah", role: ROLES.MANAGER, phone: "98450 88002" },
  [ROLES.ADMIN]: { uid: "u-adm", name: "Anita Desai", role: ROLES.ADMIN, phone: "98450 66009" },
};

function seedWorkOrders() {
  const now = Date.now();
  const mk = (overrides) => ({
    id: newId("wo"),
    wo_number: `WO-2026-${String(_id).padStart(6, "0")}`,
    department_id: "DEPT-MACHINING", asset_id: "AST-0412", asset_name: "CNC Lathe #04",
    type: "breakdown", priority: "P3", status: "open", impact: "auxiliary",
    est_downtime_value: 2, est_downtime_unit: "hours",
    description: "Sample issue description for preview purposes.",
    safety_risk: { flag: false, severity: null }, environmental_risk: { flag: false }, permit_required: false,
    requester_id: USERS.requester.uid, requester_name: USERS.requester.name, requester_phone: USERS.requester.phone,
    assigned_to_id: null, assigned_to_name: null,
    created_at: now - 3 * 3600e3, updated_at: now,
    decline_count: 0, resolution_notes: null, reopen_reason: null,
    history: [{ from: null, to: "open", actor: USERS.requester.name, role: "requester", remarks: "Work order raised", at: now - 3 * 3600e3 }],
    comments: [], attachments: [],
    ...overrides,
  });
  return [
    mk({ priority: "P1", status: "open", asset_name: "Hydraulic Press 3", asset_id: "AST-0157", department_id: "DEPT-PRESS", impact: "full_stoppage", description: "Press stopped mid-cycle, hydraulic pressure alarm tripped.", created_at: now - 40 * 60e3 }),
    mk({ priority: "P2", status: "assigned", assigned_to_id: "tech-arun", assigned_to_name: "Arun Kumar", created_at: now - 2 * 3600e3, history: [{ from: null, to: "open", actor: "Ravi Kumar", role: "requester", remarks: "Work order raised", at: now - 2 * 3600e3 }, { from: "open", to: "assigned", actor: "Priya Nair", role: "supervisor", remarks: "Assigned to Arun Kumar", at: now - 100 * 60e3 }] }),
    mk({ priority: "P2", status: "repairing", assigned_to_id: "tech-arun", assigned_to_name: "Arun Kumar", description: "Conveyor belt slipping under load, motor running hot.", asset_name: "Conveyor B-2", asset_id: "AST-0288", department_id: "DEPT-ASSEMBLY", created_at: now - 5 * 3600e3, comments: [{ id: newId("c"), author: "Arun Kumar", role: "technician", text: "Belt tension adjusted, motor temp checked — within range now.", at: now - 40 * 60e3 }] }),
    mk({ priority: "P3", status: "testing", assigned_to_id: "tech-meera", assigned_to_name: "Meera Iyer", created_at: now - 8 * 3600e3 }),
    mk({ priority: "P3", status: "completed", assigned_to_id: "tech-sanjay", assigned_to_name: "Sanjay Rao", resolution_notes: "Replaced worn drive belt, ran full cycle test with no issues.", created_at: now - 10 * 3600e3 }),
    mk({ priority: "P4", status: "closed", assigned_to_id: "tech-arun", assigned_to_name: "Arun Kumar", resolution_notes: "Cosmetic panel reattached.", verified_by: "u-req", created_at: now - 30 * 3600e3, closed_at: now - 26 * 3600e3 }),
    mk({ priority: "P1", status: "on_site", assigned_to_id: "tech-meera", assigned_to_name: "Meera Iyer", asset_name: "Air Compressor 1", asset_id: "AST-0330", description: "Compressor tripping breaker repeatedly, burning smell reported.", safety_risk: { flag: true, severity: "High" }, created_at: now - 25 * 60e3 }),
  ];
}
function seedNotifications() {
  const now = Date.now();
  return [
    { id: newId("n"), recipient_id: USERS.supervisor.uid, type: "needs_assignment", title: "New work order needs a technician", body: "WO-2026-001007 — Hydraulic Press 3 (P1)", status: "sent", created_at: now - 40 * 60e3 },
    { id: newId("n"), recipient_id: USERS.technician.uid, type: "assigned", title: "You've been assigned a work order", body: "WO-2026-001008 — Conveyor B-2 (P2)", status: "sent", created_at: now - 5 * 3600e3 },
    { id: newId("n"), recipient_id: USERS.requester.uid, type: "completed", title: "Your work order was completed — please verify", body: "WO-2026-001010 — CNC Lathe #04", status: "read", created_at: now - 10 * 3600e3 },
  ];
}
const NOTIF_META = {
  submitted: { icon: FileCheck2, color: T.navy }, needs_assignment: { icon: UserPlus, color: T.red },
  assigned: { icon: UserCheck, color: T.navy }, declined: { icon: Ban, color: T.red },
  status_change: { icon: RefreshCw, color: T.amber }, reopened: { icon: RotateCcw, color: T.red },
  completed: { icon: CheckCircle2, color: T.good }, sla_warning: { icon: Clock, color: T.amber }, sla_breach: { icon: AlertOctagon, color: T.red },
};

/* ------------------------- small UI atoms ------------------------- */
function Btn({ children, variant = "primary", size = "md", icon: Icon, disabled, onClick, className = "" }) {
  const styles = {
    primary: { background: T.ink, color: "#fff" }, amber: { background: T.amber, color: T.navyDeep },
    ghost: { background: "#fff", color: T.ink, border: "1px solid " + T.border },
    danger: { background: "#FCE9E9", color: T.red }, success: { background: "#E7F5EE", color: T.good },
  };
  const pad = size === "sm" ? "0.3rem 0.6rem" : "0.5rem 0.9rem";
  return (
    <button onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1 rounded font-semibold text-sm disabled:opacity-50 ${className}`}
      style={{ ...styles[variant], padding: pad, fontSize: size === "sm" ? 12 : 13 }}>
      {Icon && <Icon size={14} />}{children}
    </button>
  );
}
function Card({ children, className = "", style }) {
  return <div className={`bg-white rounded-lg border ${className}`} style={{ borderColor: T.border, boxShadow: "0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.05)", ...style }}>{children}</div>;
}
function Field({ label, required, hint, children }) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold mb-1" style={{ color: T.ink }}>{label} {required && <span style={{ color: T.red }}>*</span>}</label>
      {children}
      {hint && <div className="text-xs mt-1" style={{ color: T.red }}>{hint}</div>}
    </div>
  );
}
const inputCls = "w-full px-2 py-2 rounded border text-sm bg-white";
const inputStyle = { borderColor: "#D8DEE4", color: T.ink };
function PriorityBadge({ p }) {
  const c = PRIORITY_COLORS[p] || T.inkSoft;
  return <span className="font-mono font-bold rounded px-1 text-xs" style={{ color: c, background: c + "1A", border: "1px solid " + c + "55" }}>{p}</span>;
}
function StatusBadge({ s }) {
  return <span className="text-sm font-semibold whitespace-nowrap" style={{ color: STATUS_COLORS[s] }}>● {STATUS_LABELS[s]}</span>;
}
const ROLE_ICON = { requester: UserIcon, technician: HardHat, supervisor: Users, manager: Briefcase, admin: ShieldCheck };
const ROLE_COLOR = { requester: T.navy, technician: T.amber, supervisor: T.good, manager: T.navyMid, admin: T.red };
function RoleBadge({ role }) {
  const Icon = ROLE_ICON[role] || UserIcon; const c = ROLE_COLOR[role] || T.inkSoft;
  return <span className="inline-flex items-center gap-1 rounded-full text-xs font-bold px-2 py-1" style={{ background: c + "12", color: c, border: "1px solid " + c + "45" }}><Icon size={12} />{ROLE_LABELS[role]}</span>;
}
function EmptyState({ children }) { return <div className="text-center py-8 text-sm" style={{ color: T.inkSoft }}>{children}</div>; }

/* ------------------------- Notification Bell ------------------------- */
function NotificationBell({ user, notifications, markRead, markAllRead, goto }) {
  const [open, setOpen] = useState(false);
  const mine = notifications.filter((n) => n.recipient_id === user.uid).sort((a, b) => b.created_at - a.created_at);
  const unread = mine.filter((n) => n.status !== "read");
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative">
        <Bell size={19} style={{ color: T.inkSoft }} />
        {unread.length > 0 && <span className="absolute rounded-full" style={{ top: -2, right: -2, width: 8, height: 8, background: T.red }} />}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg border z-50" style={{ borderColor: T.border, boxShadow: "0 8px 24px rgba(0,0,0,.15)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: T.border }}>
            <span className="font-bold text-sm">Notifications</span>
            {unread.length > 0 && <button onClick={markAllRead} className="flex items-center gap-1 text-xs" style={{ color: T.inkSoft }}><CheckCheck size={13} />Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {mine.length === 0 && <div className="p-5 text-center text-sm" style={{ color: T.inkSoft }}>You're all caught up.</div>}
            {mine.slice(0, 10).map((n) => {
              const meta = NOTIF_META[n.type] || { icon: Bell, color: T.inkSoft };
              const isUnread = n.status !== "read";
              return (
                <button key={n.id} onClick={() => { markRead(n.id); setOpen(false); goto("detail", n.entity_id); }}
                  className="w-full text-left flex items-start gap-2 px-4 py-2 border-t hover:bg-gray-50"
                  style={{ borderColor: "#F1F3F5", background: isUnread ? T.canvas : "#fff" }}>
                  <meta.icon size={15} style={{ color: meta.color, marginTop: 2, flexShrink: 0 }} />
                  <div className="min-w-0">
                    <div className="text-sm" style={{ color: T.ink }}>{n.title}</div>
                    <div className="text-xs mt-0.5" style={{ color: T.inkSoft }}>{n.body}</div>
                    <div className="text-xs mt-1 font-mono" style={{ color: T.inkSoft }}>{fmtRelative(n.created_at)}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="px-4 py-2 border-t text-center" style={{ borderColor: T.border }}>
            <button onClick={() => { setOpen(false); goto("notifications"); }} className="text-sm font-semibold" style={{ color: T.navy }}>View all notifications</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsPage({ user, notifications, markRead, markAllRead, goto }) {
  const mine = notifications.filter((n) => n.recipient_id === user.uid).sort((a, b) => b.created_at - a.created_at);
  const unread = mine.filter((n) => n.status !== "read");
  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: T.ink }}>Notifications</h1>
          <p className="text-sm" style={{ color: T.inkSoft }}>{unread.length} unread of {mine.length}</p>
        </div>
        {unread.length > 0 && <Btn variant="ghost" size="sm" icon={CheckCheck} onClick={markAllRead}>Mark all read</Btn>}
      </div>
      <Card className="overflow-hidden">
        {mine.length === 0 && <EmptyState><Bell size={18} className="mx-auto mb-2 opacity-50" />No notifications yet.</EmptyState>}
        {mine.map((n, i) => {
          const meta = NOTIF_META[n.type] || { icon: Bell, color: T.inkSoft };
          const isUnread = n.status !== "read";
          return (
            <button key={n.id} onClick={() => { markRead(n.id); goto("detail", n.entity_id); }}
              className={`w-full text-left flex items-start gap-3 px-5 py-4 hover:bg-gray-50 ${i > 0 ? "border-t" : ""}`}
              style={{ borderColor: "#F1F3F5", background: isUnread ? T.canvas : "transparent" }}>
              <meta.icon size={17} style={{ color: meta.color, marginTop: 2, flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: T.ink }}>{n.title}</span>
                  <span className="text-xs font-mono whitespace-nowrap" style={{ color: T.inkSoft }}>{fmtRelative(n.created_at)}</span>
                </div>
                <div className="text-sm mt-0.5" style={{ color: T.inkSoft }}>{n.body}</div>
              </div>
              {isUnread && <div className="rounded-full flex-shrink-0" style={{ width: 8, height: 8, background: T.red, marginTop: 6 }} />}
            </button>
          );
        })}
      </Card>
    </div>
  );
}

/* ------------------------- Dashboard ------------------------- */
function Dashboard({ workOrders }) {
  const stats = useMemo(() => {
    const openStatuses = STATUS_FLOW.slice(0, 8);
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let total_open = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0, completedToday = 0, overdue = 0;
    const activeTechs = new Set(); const monthly = {}; const dept = {}; const asset = {}; const tech = {};
    let repairTotal = 0, repairSamples = 0;
    for (const w of workOrders) {
      const remain = SLA_MATRIX[w.priority].resolutionMs - (now - w.created_at);
      const isOpen = openStatuses.includes(w.status);
      if (isOpen) {
        total_open++;
        if (w.priority === "P1") p1++; if (w.priority === "P2") p2++; if (w.priority === "P3") p3++; if (w.priority === "P4") p4++;
        if (remain < 0) overdue++;
        if (w.assigned_to_id) activeTechs.add(w.assigned_to_id);
      }
      if (w.closed_at && w.closed_at >= todayStart.getTime()) completedToday++;
      if (w.closed_at) { repairTotal += (w.closed_at - w.created_at) / 60000; repairSamples++; }
      const m = new Date(w.created_at).toLocaleDateString(undefined, { month: "short" });
      monthly[m] = (monthly[m] || 0) + 1;
      const dn = DEPARTMENTS.find((d) => d.id === w.department_id)?.name || w.department_id;
      dept[dn] = (dept[dn] || 0) + 1;
      asset[w.asset_name] = (asset[w.asset_name] || 0) + 1;
      if (w.assigned_to_id) tech[w.assigned_to_name] = (tech[w.assigned_to_name] || 0) + (w.status === "closed" || w.status === "completed" ? 1 : 0);
    }
    return {
      total_open, p1, p2, p3, p4, completedToday, overdue, activeTechs: activeTechs.size,
      avgRepairHrs: repairSamples ? (repairTotal / repairSamples / 60).toFixed(1) : "0",
      monthly: Object.entries(monthly).map(([month, count]) => ({ month, count })),
      dept: Object.entries(dept).map(([department, count]) => ({ department, count })),
      asset: Object.entries(asset).map(([asset, count]) => ({ asset, count })).sort((a, b) => b.count - a.count),
      tech: Object.entries(tech).map(([technician, completed]) => ({ technician, completed })).sort((a, b) => b.completed - a.completed),
    };
  }, [workOrders]);

  const cards = [
    { label: "Total Open", value: stats.total_open, color: T.navy },
    { label: "P1 Critical", value: stats.p1, color: T.red },
    { label: "P2 High", value: stats.p2, color: T.amber },
    { label: "P3 Medium", value: stats.p3, color: "#FBBF24" },
    { label: "P4 Low", value: stats.p4, color: T.navy },
    { label: "Completed Today", value: stats.completedToday, color: T.good },
    { label: "Overdue", value: stats.overdue, color: T.red },
    { label: "Avg. Response", value: "18", unit: "min", color: T.navyMid },
    { label: "Avg. Repair", value: stats.avgRepairHrs, unit: "hrs", color: T.navyMid },
    { label: "Active Technicians", value: stats.activeTechs, color: T.good },
  ];
  const PIE_COLORS = [T.navy, T.amber, T.good, T.red, T.navyMid];

  return (
    <div>
      <h1 className="text-xl font-bold mb-1" style={{ color: T.ink }}>Dashboard</h1>
      <p className="text-sm mb-4" style={{ color: T.inkSoft }}>Live preview — recalculated from the mock work orders in memory.</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {cards.map((c) => (
          <Card key={c.label} className="p-3">
            <div className="text-xs font-semibold mb-1" style={{ color: T.inkSoft }}>{c.label}</div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-2xl font-bold" style={{ color: T.ink }}>{c.value}</span>
              {c.unit && <span className="text-xs" style={{ color: T.inkSoft }}>{c.unit}</span>}
            </div>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-sm font-bold mb-3">Monthly Work Orders</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F3F5" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip />
                <Line type="monotone" dataKey="count" stroke={T.navy} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-bold mb-3">Department Breakdown</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stats.dept} dataKey="count" nameKey="department" innerRadius="45%" outerRadius="75%" paddingAngle={2}>
                  {stats.dept.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} /><Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-bold mb-3">Machine Breakdown</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.asset} layout="vertical" margin={{ left: 8 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="asset" tick={{ fontSize: 11 }} width={100} />
                <Tooltip /><Bar dataKey="count" fill={T.red} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-bold mb-3">Technician Performance</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.tech} layout="vertical" margin={{ left: 8 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="technician" tick={{ fontSize: 11 }} width={100} />
                <Tooltip /><Bar dataKey="completed" fill={T.good} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------- Work Order List ------------------------- */
function WorkOrderList({ user, workOrders, goto }) {
  const [q, setQ] = useState(""); const [fPriority, setFPriority] = useState("All"); const [fStatus, setFStatus] = useState("All");
  const scoped = useMemo(() => {
    if (user.role === ROLES.REQUESTER) return workOrders.filter((w) => w.requester_id === user.uid);
    if (user.role === ROLES.TECHNICIAN) return workOrders.filter((w) => w.assigned_to_id === user.uid);
    if (user.role === ROLES.SUPERVISOR) return workOrders.filter((w) => w.department_id === user.departmentId);
    return workOrders;
  }, [workOrders, user]);
  const filtered = scoped.filter((w) => (fPriority === "All" || w.priority === fPriority) && (fStatus === "All" || w.status === fStatus) && (!q || w.asset_name.toLowerCase().includes(q.toLowerCase()) || w.wo_number.toLowerCase().includes(q.toLowerCase())));
  const needsAssignment = scoped.filter((w) => w.status === "open").length;
  const canTriage = [ROLES.SUPERVISOR, ...ELEVATED].includes(user.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: T.ink }}>Work Orders</h1>
          <p className="text-sm" style={{ color: T.inkSoft }}>{filtered.length} of {scoped.length} work orders</p>
        </div>
        {user.role !== ROLES.TECHNICIAN && <Btn variant="amber" icon={Plus} onClick={() => goto("new")}>Raise Work Order</Btn>}
      </div>
      {canTriage && needsAssignment > 0 && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-sm" style={{ background: T.amberSoft, border: "1px solid " + T.amber + "60", color: "#8A5A0A" }}>
          <AlertTriangle size={15} /><strong>{needsAssignment}</strong> work order{needsAssignment !== 1 ? "s" : ""} need{needsAssignment === 1 ? "s" : ""} a technician.
        </div>
      )}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={inputCls} style={{ ...inputStyle, width: 200 }} />
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={inputCls} style={{ ...inputStyle, width: 110 }}>
          <option>All</option>{["P1", "P2", "P3", "P4"].map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls} style={{ ...inputStyle, width: 170 }}>
          <option value="All">All</option>{STATUS_FLOW.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <Card className="overflow-hidden">
        <div className="hidden md:flex px-4 py-2 text-xs font-bold uppercase" style={{ background: T.canvas, color: T.inkSoft }}>
          <div className="flex-1">Work Order</div><div className="w-28">Department</div><div className="w-16">Priority</div><div className="w-32">Status</div><div className="w-28">Assigned</div><div className="w-24 text-right">SLA</div>
        </div>
        {filtered.map((w, i) => {
          const remain = SLA_MATRIX[w.priority].resolutionMs - (Date.now() - w.created_at);
          return (
            <div key={w.id} onClick={() => goto("detail", w.id)} className={`flex flex-col md:flex-row md:items-center px-4 py-3 cursor-pointer hover:bg-gray-50 ${i > 0 ? "border-t" : ""}`} style={{ borderColor: "#F1F3F5" }}>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs" style={{ color: T.inkSoft }}>{w.wo_number}</div>
                <div className="text-sm font-medium" style={{ color: T.ink }}>{w.asset_name}</div>
              </div>
              <div className="w-28 text-sm" style={{ color: T.inkSoft }}>{DEPARTMENTS.find((d) => d.id === w.department_id)?.name}</div>
              <div className="w-16"><PriorityBadge p={w.priority} /></div>
              <div className="w-32"><StatusBadge s={w.status} /></div>
              <div className="w-28 text-sm" style={{ color: T.ink }}>{w.assigned_to_name || <span style={{ color: T.inkSoft }}>Unassigned</span>}</div>
              <div className="w-24 text-right font-mono text-xs" style={{ color: remain < 0 ? T.red : T.inkSoft, fontWeight: remain < 0 ? 700 : 400 }}>
                {w.status === "closed" ? "—" : remain < 0 ? "Breached" : fmtDue(remain) + " left"}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <EmptyState>No work orders match these filters.</EmptyState>}
      </Card>
    </div>
  );
}

/* ------------------------- Raise / Edit Work Order ------------------------- */
function RaiseEditForm({ user, existing, onSubmit, goto }) {
  const isEdit = !!existing;
  const [departmentId, setDepartmentId] = useState(existing?.department_id || "");
  const [assetId, setAssetId] = useState(existing?.asset_id || "");
  const [complaint, setComplaint] = useState(existing?.description || "");
  const [priority, setPriority] = useState(existing?.priority || "");
  const [priorityTouched, setPriorityTouched] = useState(isEdit);
  const [impact, setImpact] = useState(existing?.impact || "");
  const [downtimeValue, setDowntimeValue] = useState(existing?.est_downtime_value?.toString() || "");
  const [safetyFlag, setSafetyFlag] = useState(existing?.safety_risk?.flag || false);
  const [safetySeverity, setSafetySeverity] = useState(existing?.safety_risk?.severity || "Medium");
  const [envFlag, setEnvFlag] = useState(existing?.environmental_risk?.flag || false);
  const [errors, setErrors] = useState({});

  const asset = EQUIPMENT.find((e) => e.id === assetId);
  const suggestion = computeSuggestion(impact, { flag: safetyFlag, severity: safetySeverity }, { flag: envFlag });
  const effectivePriority = priorityTouched ? priority : suggestion;

  function handleAssetChange(id) { setAssetId(id); const a = EQUIPMENT.find((e) => e.id === id); if (a && !departmentId) setDepartmentId(a.department_id); }
  function validate() {
    const e = {};
    if (!departmentId) e.department = "Select a department.";
    if (!assetId) e.asset = "Select the affected equipment.";
    if (!complaint || complaint.length < 10) e.complaint = "Describe the complaint (min. 10 characters).";
    if (!impact) e.impact = "Select the production impact.";
    if (!downtimeValue) e.downtime = "Estimate the downtime.";
    return e;
  }
  function handleSubmit() {
    const errs = validate(); setErrors(errs);
    if (Object.keys(errs).length) return;
    onSubmit({ departmentId, assetId, assetName: asset.name, priority: effectivePriority || "P3", impact, downtimeValue, safety: { flag: safetyFlag, severity: safetySeverity }, env: { flag: envFlag }, complaint });
  }

  return (
    <div className="max-w-3xl">
      <button onClick={() => goto(isEdit ? "detail" : "workorders", existing?.id)} className="flex items-center gap-1 text-sm mb-3" style={{ color: T.inkSoft }}><ArrowLeft size={15} />Back</button>
      <h1 className="text-xl font-bold mb-1" style={{ color: T.ink }}>{isEdit ? `Edit ${existing.wo_number}` : "Raise Work Order"}</h1>
      <p className="text-sm mb-4" style={{ color: T.inkSoft }}>{isEdit ? "Core details can be corrected while this work order is still Open." : "Priority is suggested automatically and escalates for safety/environmental risk."}</p>
      <div className="flex flex-col md:flex-row gap-4">
        <Card className="p-4 flex-1">
          <Field label="Department" required hint={errors.department}>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputCls} style={inputStyle}>
              <option value="">Select…</option>{DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Equipment" required hint={errors.asset}>
            <select value={assetId} onChange={(e) => handleAssetChange(e.target.value)} className={inputCls} style={inputStyle}>
              <option value="">Select…</option>{EQUIPMENT.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          {asset && <div className="flex items-center gap-2 rounded px-2 py-2 mb-3 text-xs" style={{ background: T.canvas, color: T.inkSoft }}><Factory size={13} />Criticality: <strong style={{ color: T.ink }}>{asset.criticality}</strong></div>}
          <Field label="Complaint" required hint={errors.complaint}>
            <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={3} className={inputCls} style={inputStyle} placeholder="What happened?" />
          </Field>
          <Field label="Priority" required>
            <div className="flex gap-2">
              {["P1", "P2", "P3", "P4"].map((p) => (
                <button key={p} onClick={() => { setPriority(p); setPriorityTouched(true); }} className="flex-1 py-2 rounded text-sm font-bold border"
                  style={{ borderColor: effectivePriority === p ? PRIORITY_COLORS[p] : "#D8DEE4", background: effectivePriority === p ? PRIORITY_COLORS[p] + "1A" : "#fff", color: effectivePriority === p ? PRIORITY_COLORS[p] : T.inkSoft }}>{p}</button>
              ))}
            </div>
          </Field>
          <div className="rounded px-3 py-2 mb-3 text-sm" style={{ background: suggestion ? PRIORITY_COLORS[suggestion] + "0D" : T.canvas, border: "1px solid " + (suggestion ? PRIORITY_COLORS[suggestion] + "55" : T.border) }}>
            <div className="flex items-center gap-1 mb-1 font-semibold text-xs"><Sparkles size={13} style={{ color: T.amber }} />Auto Priority Suggestion</div>
            {suggestion ? <span style={{ color: T.inkSoft }}>System recommends <strong style={{ color: PRIORITY_COLORS[suggestion] }}>{suggestion}</strong></span> : <span style={{ color: T.inkSoft }}>Select impact below to see a suggestion.</span>}
          </div>
          <Field label="Production impact" required hint={errors.impact}>
            <div className="flex flex-col gap-2">
              {IMPACT_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center justify-between px-3 py-2 rounded border cursor-pointer text-sm" style={{ borderColor: impact === opt.value ? T.amber : "#E2E6EA", background: impact === opt.value ? T.amberSoft : "#fff" }}>
                  <span className="flex items-center gap-2"><input type="radio" checked={impact === opt.value} onChange={() => setImpact(opt.value)} />{opt.label}</span>
                  <PriorityBadge p={opt.suggests} />
                </label>
              ))}
            </div>
          </Field>
          <Field label="Estimated downtime (hours)" required hint={errors.downtime}>
            <input type="number" value={downtimeValue} onChange={(e) => setDowntimeValue(e.target.value)} className={inputCls} style={inputStyle} />
          </Field>
          <Field label="Safety risk">
            <div className="flex gap-2">{["No", "Yes"].map((v) => (
              <button key={v} onClick={() => setSafetyFlag(v === "Yes")} className="px-4 py-1.5 rounded text-sm font-semibold border" style={{ borderColor: (v === "Yes") === safetyFlag ? T.red : "#D8DEE4", background: (v === "Yes") === safetyFlag ? "#FCE9E9" : "#fff", color: (v === "Yes") === safetyFlag ? T.red : T.inkSoft }}>{v}</button>
            ))}</div>
            {safetyFlag && <div className="flex gap-2 mt-2">{["Low", "Medium", "High"].map((s) => (
              <button key={s} onClick={() => setSafetySeverity(s)} className="flex-1 py-1 rounded text-xs font-semibold border" style={{ borderColor: safetySeverity === s ? T.red : "#D8DEE4", background: safetySeverity === s ? "#FCE9E9" : "#fff", color: safetySeverity === s ? T.red : T.inkSoft }}>{s}</button>
            ))}</div>}
          </Field>
          <Field label="Environmental risk">
            <div className="flex gap-2">{["No", "Yes"].map((v) => (
              <button key={v} onClick={() => setEnvFlag(v === "Yes")} className="px-4 py-1.5 rounded text-sm font-semibold border" style={{ borderColor: (v === "Yes") === envFlag ? T.amber : "#D8DEE4", background: (v === "Yes") === envFlag ? T.amberSoft : "#fff", color: (v === "Yes") === envFlag ? "#8A5A0A" : T.inkSoft }}>{v}</button>
            ))}</div>
          </Field>
        </Card>
        <div className="w-full md:w-64">
          <div className="rounded-lg p-4 text-white" style={{ background: T.navy }}>
            <div className="flex items-center gap-1 mb-2 font-bold text-sm"><AlertTriangle size={14} style={{ color: T.amber }} />SLA preview</div>
            {effectivePriority ? (
              <div className="text-sm space-y-1">
                <PriorityBadge p={effectivePriority} />
                {["ack", "response", "resolution"].map((k) => (
                  <div key={k} className="flex justify-between text-xs mt-1"><span style={{ color: "#B9C9E8" }}>{k}</span><span className="font-mono font-semibold">{SLA_MATRIX[effectivePriority][k]}</span></div>
                ))}
              </div>
            ) : <p className="text-xs" style={{ color: "#B9C9E8" }}>Fill in the form to see SLA targets.</p>}
          </div>
          <div className="flex gap-2 mt-3">
            <Btn variant="amber" icon={isEdit ? Save : Send} onClick={handleSubmit} className="flex-1 justify-center">{isEdit ? "Save Changes" : "Submit"}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Work Order Detail ------------------------- */
const TABS = [["overview", "Overview"], ["assignment", "Assignment"], ["comments", "Comments"], ["attachments", "Attachments"], ["timeline", "Status Timeline"], ["workflow", "Workflow"]];

function WorkOrderDetail({ user, wo, actions, goto }) {
  const [tab, setTab] = useState("overview");
  if (!wo) return <EmptyState>Work order not found.</EmptyState>;
  const remain = SLA_MATRIX[wo.priority].resolutionMs - (Date.now() - wo.created_at);
  const breached = remain < 0 && wo.status !== "closed";
  const canEdit = wo.status === "open" && (wo.requester_id === user.uid || user.role === ROLES.SUPERVISOR || ELEVATED.includes(user.role));

  return (
    <div className="max-w-4xl">
      <button onClick={() => goto("workorders")} className="flex items-center gap-1 text-sm mb-3" style={{ color: T.inkSoft }}><ArrowLeft size={15} />Back to Work Orders</button>
      <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm" style={{ color: T.inkSoft }}>{wo.wo_number}</span><PriorityBadge p={wo.priority} /><StatusBadge s={wo.status} />
          </div>
          <h1 className="text-xl font-bold mt-1" style={{ color: T.ink }}>{wo.asset_name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && <Btn variant="ghost" icon={PencilLine} onClick={() => goto("edit", wo.id)}>Edit</Btn>}
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: breached ? "#FCE9E9" : T.canvas }}>
            <Timer size={15} style={{ color: breached ? T.red : T.inkSoft }} />
            <div>
              <div className="text-xs" style={{ color: T.inkSoft }}>Resolution SLA</div>
              <div className="font-mono text-sm font-bold" style={{ color: breached ? T.red : T.ink }}>{wo.status === "closed" ? "Closed" : breached ? "Breached" : fmtDue(remain) + " left"}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-1 border-b mb-4 overflow-x-auto" style={{ borderColor: T.border }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className="px-3 py-2 text-sm font-semibold whitespace-nowrap" style={{ color: tab === k ? T.ink : T.inkSoft, borderBottom: tab === k ? "2px solid " + T.amber : "2px solid transparent" }}>{l}</button>
        ))}
      </div>
      <Card className="p-4">
        {tab === "overview" && <OverviewTab wo={wo} />}
        {tab === "assignment" && <AssignmentTab user={user} wo={wo} actions={actions} />}
        {tab === "comments" && <CommentsTab user={user} wo={wo} actions={actions} />}
        {tab === "attachments" && <AttachmentsTab wo={wo} actions={actions} />}
        {tab === "timeline" && <TimelineTab wo={wo} />}
        {tab === "workflow" && <WorkflowTab user={user} wo={wo} actions={actions} goto={goto} setTab={setTab} />}
      </Card>
    </div>
  );
}

function OverviewTab({ wo }) {
  const rows = [["Equipment", wo.asset_name], ["Department", DEPARTMENTS.find((d) => d.id === wo.department_id)?.name], ["Production impact", IMPACT_OPTIONS.find((i) => i.value === wo.impact)?.label || "—"], ["Downtime est.", `${wo.est_downtime_value} hrs`], ["Requested by", wo.requester_name], ["Safety risk", wo.safety_risk?.flag ? `Yes (${wo.safety_risk.severity})` : "No"]];
  return (
    <div className="flex flex-col md:flex-row gap-6">
      <div className="flex-1">{rows.map(([l, v]) => <div key={l} className="flex justify-between py-2 border-b text-sm" style={{ borderColor: "#F1F3F5" }}><span style={{ color: T.inkSoft }}>{l}</span><span className="font-medium" style={{ color: T.ink }}>{v}</span></div>)}</div>
      <div className="flex-1">
        <div className="text-xs font-semibold mb-1" style={{ color: T.ink }}>Complaint</div>
        <p className="text-sm mb-3" style={{ color: T.ink }}>{wo.description}</p>
        {wo.resolution_notes && <><div className="text-xs font-bold mb-1" style={{ color: T.good }}>Resolution notes</div><p className="text-sm" style={{ color: T.ink }}>{wo.resolution_notes}</p></>}
      </div>
    </div>
  );
}
function AssignmentTab({ user, wo, actions }) {
  const canAssign = user.role === ROLES.SUPERVISOR || ELEVATED.includes(user.role);
  const disabledStatus = ["completed", "verified", "closed"].includes(wo.status);
  return (
    <div>
      <div className="text-sm mb-3" style={{ color: T.inkSoft }}>Currently assigned: {wo.assigned_to_name ? <strong style={{ color: T.ink }}>{wo.assigned_to_name}</strong> : "Unassigned"}</div>
      {!canAssign && <div className="rounded px-3 py-2 mb-3 text-sm" style={{ background: T.canvas, color: T.inkSoft }}>Only a Supervisor, Manager, or Admin can assign a technician.</div>}
      {TECHNICIANS.map((t) => {
        const isAssigned = wo.assigned_to_id === t.id;
        return (
          <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded border mb-2" style={{ borderColor: isAssigned ? T.amber : T.border, background: isAssigned ? T.amberSoft : "#fff" }}>
            <div className="flex items-center gap-2">
              <div className="rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ width: 30, height: 30, background: T.navy }}>{t.name.split(" ").map((n) => n[0]).join("")}</div>
              <div><div className="text-sm font-medium" style={{ color: T.ink }}>{t.name}</div><div className="text-xs" style={{ color: T.inkSoft }}>{t.skills.join(" · ")}</div></div>
            </div>
            {canAssign && !disabledStatus && <Btn size="sm" variant={isAssigned ? "success" : "ghost"} icon={isAssigned ? CheckCircle2 : UserCheck} onClick={() => actions.assign(wo.id, t)}>{isAssigned ? "Assigned" : wo.assigned_to_id ? "Reassign" : "Assign"}</Btn>}
          </div>
        );
      })}
    </div>
  );
}
function CommentsTab({ user, wo, actions }) {
  const [text, setText] = useState("");
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment or progress update…" className={inputCls} style={{ ...inputStyle, flex: 1 }} onKeyDown={(e) => e.key === "Enter" && text.trim() && (actions.comment(wo.id, text.trim()), setText(""))} />
        <Btn variant="amber" icon={Send} onClick={() => { if (text.trim()) { actions.comment(wo.id, text.trim()); setText(""); } }}>Post</Btn>
      </div>
      {wo.comments.length === 0 && <EmptyState><MessageSquare size={16} className="mx-auto mb-1 opacity-50" />No comments yet.</EmptyState>}
      {wo.comments.slice().reverse().map((c) => (
        <div key={c.id} className="rounded px-3 py-2 mb-2" style={{ background: T.canvas }}>
          <div className="flex items-center gap-2 mb-0.5"><span className="text-sm font-semibold" style={{ color: T.ink }}>{c.author}</span><span className="text-xs rounded px-1 border" style={{ color: T.inkSoft, borderColor: T.border }}>{ROLE_LABELS[c.role]}</span></div>
          <div className="text-sm" style={{ color: T.ink }}>{c.text}</div>
          <div className="text-xs mt-1" style={{ color: T.inkSoft }}>{fmtRelative(c.at)}</div>
        </div>
      ))}
    </div>
  );
}
function AttachmentsTab({ wo, actions }) {
  function handleFiles(files, type) { Array.from(files).forEach((f) => actions.attach(wo.id, f, type)); }
  const photos = wo.attachments.filter((a) => a.type === "photo"); const videos = wo.attachments.filter((a) => a.type === "video");
  return (
    <div className="flex flex-col md:flex-row gap-6">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold">Photos ({photos.length})</span>
          <label className="cursor-pointer"><Btn variant="ghost" size="sm" icon={ImageIcon}>Upload</Btn><input type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files, "photo")} /></label>
        </div>
        <div className="flex gap-2 flex-wrap">
          {photos.length === 0 && <div className="text-sm" style={{ color: T.inkSoft }}>No photos uploaded yet.</div>}
          {photos.map((p) => <img key={p.id} src={p.url} alt="" className="rounded border object-cover" style={{ width: 64, height: 64, borderColor: T.border }} />)}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold">Videos ({videos.length})</span>
          <label className="cursor-pointer"><Btn variant="ghost" size="sm" icon={Video}>Upload</Btn><input type="file" accept="video/*" multiple hidden onChange={(e) => handleFiles(e.target.files, "video")} /></label>
        </div>
        {videos.length === 0 && <div className="text-sm" style={{ color: T.inkSoft }}>No videos uploaded yet.</div>}
        {videos.map((v) => <div key={v.id} className="flex items-center gap-2 text-sm rounded px-2 py-2 mb-1" style={{ background: T.canvas }}><Video size={14} style={{ color: T.inkSoft }} />{v.name}</div>)}
      </div>
    </div>
  );
}
function TimelineTab({ wo }) {
  const idx = STATUS_FLOW.indexOf(wo.status);
  return (
    <div>
      {STATUS_FLOW.map((s, i) => {
        const ev = wo.history.find((h) => h.to === s); const done = i <= idx; const current = s === wo.status;
        return (
          <div key={s} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="rounded-full flex items-center justify-center" style={{ width: 20, height: 20, background: done ? (current ? T.amber : T.good) : "#E7EAEE", border: current ? "2px solid " + T.amber : "none" }}>
                {done && !current && <CheckCircle2 size={11} className="text-white" />}
              </div>
              {i < STATUS_FLOW.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 24, background: i < idx ? T.good : "#E7EAEE" }} />}
            </div>
            <div className="pb-5">
              <div className="text-sm" style={{ fontWeight: current ? 700 : 500, color: done ? T.ink : T.inkSoft }}>{STATUS_LABELS[s]}</div>
              {ev ? <div className="text-xs mt-0.5" style={{ color: T.inkSoft }}>{ev.actor} · {fmtRelative(ev.at)}{ev.remarks && <div style={{ color: T.ink }}>{ev.remarks}</div>}</div> : <div className="text-xs mt-0.5" style={{ color: "#B7BEC6" }}>Pending</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function InfoBox({ children }) { return <div className="rounded px-3 py-2 mb-3 text-sm" style={{ background: T.canvas, color: T.inkSoft }}>{children}</div>; }

function WorkflowTab({ user, wo, actions, goto, setTab }) {
  const [decline, setDecline] = useState(""); const [showDecline, setShowDecline] = useState(false);
  const [spare, setSpare] = useState(""); const [showSpare, setShowSpare] = useState(false);
  const [testFail, setTestFail] = useState(""); const [showTestFail, setShowTestFail] = useState(false);
  const [notes, setNotes] = useState(""); const [showComplete, setShowComplete] = useState(false);
  const [reopen, setReopen] = useState(""); const [showReopen, setShowReopen] = useState(false);
  const isAssignee = user.role === ROLES.TECHNICIAN && wo.assigned_to_id === user.uid;
  const isRequester = user.role === ROLES.REQUESTER && wo.requester_id === user.uid;
  const isSupLike = user.role === ROLES.SUPERVISOR || ELEVATED.includes(user.role);
  const a = actions;

  if (wo.status === "open") return isSupLike ? <div><InfoBox>Needs a technician. Go to Assignment.</InfoBox><Btn variant="amber" icon={UserCheck} onClick={() => setTab("assignment")}>Assign a technician</Btn></div> : <InfoBox>Waiting for a Supervisor to assign a technician.</InfoBox>;

  if (wo.status === "assigned") {
    if (isAssignee) return (
      <div>
        <InfoBox>You've been assigned. Accept to start, or decline with a reason.</InfoBox>
        <div className="flex gap-2 mb-2"><Btn variant="success" icon={CheckCircle2} onClick={() => a.accept(wo.id)}>Accept</Btn><Btn variant="danger" icon={Ban} onClick={() => setShowDecline((s) => !s)}>Decline</Btn></div>
        {showDecline && <div className="flex gap-2"><input value={decline} onChange={(e) => setDecline(e.target.value)} placeholder="Reason…" className={inputCls} style={{ ...inputStyle, flex: 1 }} /><Btn variant="danger" disabled={!decline} onClick={() => { a.decline(wo.id, decline); setShowDecline(false); }}>Confirm</Btn></div>}
      </div>
    );
    return <InfoBox>Assigned to {wo.assigned_to_name} — waiting for acceptance.</InfoBox>;
  }
  if (wo.status === "accepted") return isAssignee ? <div><InfoBox>Accepted. Head out when ready.</InfoBox><Btn variant="amber" icon={Truck} onClick={() => a.travel(wo.id)}>On The Way</Btn></div> : <InfoBox>{wo.assigned_to_name} has accepted.</InfoBox>;
  if (wo.status === "on_the_way") return isAssignee ? <div><InfoBox>En route.</InfoBox><Btn variant="amber" icon={MapPin} onClick={() => a.arrive(wo.id)}>Arrived — On Site</Btn></div> : <InfoBox>{wo.assigned_to_name} is on the way.</InfoBox>;
  if (wo.status === "on_site") return isAssignee ? <div><InfoBox>On site.</InfoBox><Btn variant="amber" icon={Wrench} onClick={() => a.startRepair(wo.id)}>Start Repair</Btn></div> : <InfoBox>{wo.assigned_to_name} is on site.</InfoBox>;
  if (wo.status === "repairing") {
    if (!isAssignee) return <InfoBox>{wo.assigned_to_name} is repairing the equipment.</InfoBox>;
    return (
      <div>
        <InfoBox>Log progress in Comments. Mark waiting on a part, or move to testing.</InfoBox>
        <div className="flex gap-2 mb-2 flex-wrap"><Btn variant="ghost" icon={PackageSearch} onClick={() => setShowSpare((s) => !s)}>Waiting Spare Part</Btn><Btn variant="amber" icon={FlaskConical} onClick={() => a.startTesting(wo.id)}>Start Testing</Btn></div>
        {showSpare && <div className="flex gap-2"><input value={spare} onChange={(e) => setSpare(e.target.value)} placeholder="Which part?" className={inputCls} style={{ ...inputStyle, flex: 1 }} /><Btn variant="ghost" disabled={!spare} onClick={() => { a.sparePart(wo.id, spare); setShowSpare(false); }}>Confirm</Btn></div>}
      </div>
    );
  }
  if (wo.status === "waiting_spare_part") return isAssignee ? <div><InfoBox>Paused — waiting on a spare part.</InfoBox><Btn variant="amber" icon={PlayCircle} onClick={() => a.resume(wo.id)}>Resume Repair</Btn></div> : <InfoBox>Waiting on a spare part.</InfoBox>;
  if (wo.status === "testing") {
    if (!isAssignee) return <InfoBox>{wo.assigned_to_name} is testing the fix.</InfoBox>;
    return (
      <div>
        <InfoBox>Testing. Mark completed if it holds, or send back to repair.</InfoBox>
        <div className="flex gap-2 mb-2 flex-wrap"><Btn variant="danger" icon={RotateCcw} onClick={() => setShowTestFail((s) => !s)}>Test Failed</Btn><Btn variant="success" icon={CheckCircle2} onClick={() => setShowComplete((s) => !s)}>Mark Completed</Btn></div>
        {showTestFail && <div className="flex gap-2 mb-2"><input value={testFail} onChange={(e) => setTestFail(e.target.value)} placeholder="What failed?" className={inputCls} style={{ ...inputStyle, flex: 1 }} /><Btn variant="danger" disabled={!testFail} onClick={() => { a.testFailed(wo.id, testFail); setShowTestFail(false); }}>Back to Repair</Btn></div>}
        {showComplete && <div><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What did you do to fix it?" className={inputCls} style={{ ...inputStyle, marginBottom: 6 }} /><Btn variant="success" icon={Send} disabled={!notes} onClick={() => { a.complete(wo.id, notes); setShowComplete(false); }}>Submit for verification</Btn></div>}
      </div>
    );
  }
  if (wo.status === "completed") {
    if (isRequester) return (
      <div>
        <InfoBox>Technician marked this completed. Verify the fix.</InfoBox>
        <div className="flex gap-2 mb-2"><Btn variant="success" icon={ThumbsUp} onClick={() => a.verify(wo.id)}>Confirm fixed — Close</Btn><Btn variant="danger" icon={RotateCcw} onClick={() => setShowReopen((s) => !s)}>Not fixed</Btn></div>
        {showReopen && <div className="flex gap-2"><input value={reopen} onChange={(e) => setReopen(e.target.value)} placeholder="What's still wrong?" className={inputCls} style={{ ...inputStyle, flex: 1 }} /><Btn variant="danger" disabled={!reopen} onClick={() => { a.reopen(wo.id, reopen); setShowReopen(false); }}>Reopen</Btn></div>}
      </div>
    );
    if (ELEVATED.includes(user.role)) return <div><InfoBox>Awaiting requester verification. You may override.</InfoBox><Btn variant="ghost" icon={ThumbsUp} onClick={() => a.forceVerify(wo.id)}>Force verify & close</Btn></div>;
    return <InfoBox>Waiting for the requester to verify.</InfoBox>;
  }
  return <InfoBox>Closed. Verified and archived.</InfoBox>;
}

/* ------------------------- Login ------------------------- */
function Login({ onLogin }) {
  const roleList = [ROLES.REQUESTER, ROLES.TECHNICIAN, ROLES.SUPERVISOR, ROLES.MANAGER, ROLES.ADMIN];
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: T.navy }}>
      <div className="w-full max-w-sm bg-white rounded-xl p-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="rounded-lg flex items-center justify-center font-bold" style={{ width: 32, height: 32, background: T.navy, color: "#fff" }}>SI</div>
          <div><div className="font-extrabold" style={{ color: T.ink }}>Service Inside</div><div className="text-xs" style={{ color: T.inkSoft }}>Interactive preview</div></div>
        </div>
        <p className="text-sm mt-3 mb-4" style={{ color: T.inkSoft }}>Pick a role to sign in as — this is a mock preview, no real credentials needed.</p>
        <div className="flex flex-col gap-2">
          {roleList.map((r) => {
            const Icon = ROLE_ICON[r];
            return (
              <button key={r} onClick={() => onLogin(USERS[r])} className="flex items-center gap-3 px-3 py-3 rounded-lg border text-left hover:bg-gray-50" style={{ borderColor: T.border }}>
                <div className="rounded-full flex items-center justify-center" style={{ width: 36, height: 36, background: ROLE_COLOR[r] + "15", color: ROLE_COLOR[r] }}><Icon size={17} /></div>
                <div><div className="text-sm font-semibold" style={{ color: T.ink }}>{USERS[r].name}</div><div className="text-xs" style={{ color: T.inkSoft }}>{ROLE_LABELS[r]}</div></div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------- App Shell ------------------------- */
function AppShell({ user, screen, onSignOut, notifications, markRead, markAllRead, goto, children }) {
  const navItems = [["dashboard", "Dashboard", LayoutDashboard], ["workorders", "Work Orders", ClipboardList], ["notifications", "Notifications", Bell]];
  return (
    <div className="min-h-screen flex" style={{ background: T.canvas }}>
      <div className="w-56 flex flex-col p-4 flex-shrink-0" style={{ background: T.navy }}>
        <div className="flex items-center gap-2 px-1 mb-5">
          <div className="rounded-lg flex items-center justify-center font-bold text-sm" style={{ width: 28, height: 28, background: "#fff", color: T.navy }}>SI</div>
          <div className="text-white font-bold text-sm">Service Inside</div>
        </div>
        <nav className="flex flex-col gap-1">
          {navItems.map(([key, label, Icon]) => (
            <button key={key} onClick={() => goto(key)} className="rounded flex items-center gap-2 px-2 py-2 text-sm font-semibold text-left" style={{ background: screen === key ? T.navyMid : "transparent", color: screen === key ? "#fff" : "#9FB6E0" }}>
              <Icon size={16} />{label}
            </button>
          ))}
        </nav>
        <div className="mt-auto pt-3" style={{ borderTop: "1px solid #2C5AA8" }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-full flex items-center justify-center font-bold text-xs" style={{ width: 30, height: 30, background: T.amber, color: T.navyDeep }}>{user.name.split(" ").map((n) => n[0]).join("")}</div>
            <div><div className="text-white text-xs font-semibold">{user.name}</div><div className="text-xs" style={{ color: "#9FB6E0" }}>{ROLE_LABELS[user.role]}</div></div>
          </div>
          <button onClick={onSignOut} className="flex items-center gap-1 text-xs" style={{ color: "#9FB6E0" }}><LogOut size={12} />Switch role</button>
        </div>
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b" style={{ borderColor: T.border }}>
          <div className="flex items-center gap-2 rounded px-2 py-1" style={{ background: T.canvas, width: 260 }}>
            <Search size={14} style={{ color: T.inkSoft }} /><span className="text-sm" style={{ color: T.inkSoft }}>Search…</span>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell user={user} notifications={notifications} markRead={markRead} markAllRead={markAllRead} goto={goto} />
            <RoleBadge role={user.role} />
          </div>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------- Root App ------------------------- */
export default function App() {
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);
  const [workOrders, setWorkOrders] = useState(seedWorkOrders);
  const [notifications, setNotifications] = useState(seedNotifications);
  const [, forceTick] = useState(0);
  useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  function goto(s, id) { setScreen(s); if (id) setSelectedId(id); }
  function pushNotif(recipientId, type, title, body, entityId) {
    setNotifications((prev) => [...prev, { id: newId("n"), recipient_id: recipientId, type, title, body, status: "sent", created_at: Date.now(), entity_id: entityId }]);
  }
  function updateWo(id, patch, historyEntry) {
    setWorkOrders((prev) => prev.map((w) => w.id !== id ? w : { ...w, ...patch, updated_at: Date.now(), history: historyEntry ? [...w.history, { ...historyEntry, at: Date.now() }] : w.history }));
  }
  function findWo(id) { return workOrders.find((w) => w.id === id); }
  const supervisorsOfDept = () => [USERS.supervisor]; // single mock supervisor per department in this preview

  const actions = {
    createWorkOrder: (data) => {
      const id = newId("wo"); const wo_number = `WO-2026-${String(_id).padStart(6, "0")}`;
      const now = Date.now();
      const wo = {
        id, wo_number, department_id: data.departmentId, asset_id: data.assetId, asset_name: data.assetName,
        type: "breakdown", priority: data.priority, status: "open", impact: data.impact,
        est_downtime_value: Number(data.downtimeValue), est_downtime_unit: "hours", description: data.complaint,
        safety_risk: data.safety, environmental_risk: data.env, permit_required: data.safety.flag,
        requester_id: user.uid, requester_name: user.name, requester_phone: user.phone,
        assigned_to_id: null, assigned_to_name: null, created_at: now, updated_at: now,
        decline_count: 0, resolution_notes: null, reopen_reason: null,
        history: [{ from: null, to: "open", actor: user.name, role: user.role, remarks: "Work order raised", at: now }],
        comments: [], attachments: [],
      };
      setWorkOrders((prev) => [wo, ...prev]);
      pushNotif(user.uid, "submitted", "Work order submitted", `${wo_number} has been received.`, id);
      supervisorsOfDept().forEach((s) => pushNotif(s.uid, "needs_assignment", "New work order needs a technician", `${wo_number} — ${data.assetName} (${data.priority})`, id));
      goto("detail", id);
    },
    editWorkOrder: (id, data) => {
      updateWo(id, { department_id: data.departmentId, asset_id: data.assetId, asset_name: data.assetName, priority: data.priority, impact: data.impact, est_downtime_value: Number(data.downtimeValue), description: data.complaint, safety_risk: data.safety, environmental_risk: data.env });
      goto("detail", id);
    },
    assign: (id, tech) => {
      const wo = findWo(id); const preserves = !["open", "assigned"].includes(wo.status);
      updateWo(id, { status: preserves ? wo.status : "assigned", assigned_to_id: tech.id, assigned_to_name: tech.name }, { from: wo.status, to: preserves ? wo.status : "assigned", actor: user.name, role: user.role, remarks: `Assigned to ${tech.name}` });
      pushNotif(tech.id, "assigned", "You've been assigned a work order", `${wo.wo_number} — ${wo.asset_name}`, id);
    },
    accept: (id) => { const wo = findWo(id); updateWo(id, { status: "accepted" }, { from: "assigned", to: "accepted", actor: user.name, role: user.role, remarks: "Accepted by technician" }); pushNotif(wo.requester_id, "status_change", "Technician accepted your work order", `${wo.assigned_to_name} has accepted ${wo.wo_number}.`, id); },
    decline: (id, reason) => { const wo = findWo(id); updateWo(id, { status: "open", assigned_to_id: null, assigned_to_name: null, decline_count: wo.decline_count + 1 }, { from: "assigned", to: "open", actor: user.name, role: user.role, remarks: `Declined: ${reason}` }); supervisorsOfDept().forEach((s) => pushNotif(s.uid, "declined", "Technician declined — needs reassignment", `${wo.wo_number}`, id)); },
    travel: (id) => updateWo(id, { status: "on_the_way" }, { from: "accepted", to: "on_the_way", actor: user.name, role: user.role, remarks: "Technician en route" }),
    arrive: (id) => { const wo = findWo(id); updateWo(id, { status: "on_site" }, { from: "on_the_way", to: "on_site", actor: user.name, role: user.role, remarks: "Arrived on site" }); pushNotif(wo.requester_id, "status_change", "Technician has arrived", `${wo.assigned_to_name} is now on site for ${wo.wo_number}.`, id); },
    startRepair: (id) => updateWo(id, { status: "repairing" }, { from: "on_site", to: "repairing", actor: user.name, role: user.role, remarks: "Started repair" }),
    sparePart: (id, reason) => updateWo(id, { status: "waiting_spare_part" }, { from: "repairing", to: "waiting_spare_part", actor: user.name, role: user.role, remarks: reason }),
    resume: (id) => updateWo(id, { status: "repairing" }, { from: "waiting_spare_part", to: "repairing", actor: user.name, role: user.role, remarks: "Resumed repair" }),
    startTesting: (id) => updateWo(id, { status: "testing" }, { from: "repairing", to: "testing", actor: user.name, role: user.role, remarks: "Testing" }),
    testFailed: (id, reason) => updateWo(id, { status: "repairing" }, { from: "testing", to: "repairing", actor: user.name, role: user.role, remarks: `Test failed: ${reason}` }),
    complete: (id, notes) => { const wo = findWo(id); updateWo(id, { status: "completed", resolution_notes: notes }, { from: "testing", to: "completed", actor: user.name, role: user.role, remarks: "Awaiting verification" }); pushNotif(wo.requester_id, "completed", "Your work order was completed — please verify", `${wo.wo_number}`, id); },
    verify: (id) => { updateWo(id, { status: "closed", closed_at: Date.now() }, { from: "completed", to: "verified", actor: user.name, role: user.role, remarks: "Confirmed fixed" }); },
    forceVerify: (id) => { updateWo(id, { status: "closed", closed_at: Date.now() }, { from: "completed", to: "verified", actor: user.name, role: user.role, remarks: `Force-verified by ${user.name}` }); },
    reopen: (id, reason) => { const wo = findWo(id); updateWo(id, { status: "repairing", reopen_reason: reason }, { from: "completed", to: "repairing", actor: user.name, role: user.role, remarks: `Reopened: ${reason}` }); if (wo.assigned_to_id) pushNotif(wo.assigned_to_id, "reopened", "Work order reopened by requester", `${wo.wo_number}`, id); supervisorsOfDept().forEach((s) => pushNotif(s.uid, "reopened", "Work order reopened by requester", `${wo.wo_number}`, id)); },
    comment: (id, text) => setWorkOrders((prev) => prev.map((w) => w.id !== id ? w : { ...w, comments: [...w.comments, { id: newId("c"), author: user.name, role: user.role, text, at: Date.now() }] })),
    attach: (id, file, type) => { const url = URL.createObjectURL(file); setWorkOrders((prev) => prev.map((w) => w.id !== id ? w : { ...w, attachments: [...w.attachments, { id: newId("att"), type, url, name: file.name }] })); },
  };

  function markRead(id) { setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, status: "read" } : n)); }
  function markAllRead() { setNotifications((prev) => prev.map((n) => n.recipient_id === user.uid ? { ...n, status: "read" } : n)); }

  if (!user) return <Login onLogin={(u) => { setUser(u); setScreen("dashboard"); }} />;

  return (
    <AppShell user={user} screen={screen} onSignOut={() => setUser(null)} notifications={notifications} markRead={markRead} markAllRead={markAllRead} goto={goto}>
      {screen === "dashboard" && <Dashboard workOrders={workOrders} />}
      {screen === "workorders" && <WorkOrderList user={user} workOrders={workOrders} goto={goto} />}
      {screen === "new" && <RaiseEditForm user={user} onSubmit={actions.createWorkOrder} goto={goto} />}
      {screen === "edit" && <RaiseEditForm user={user} existing={findWo(selectedId)} onSubmit={(data) => actions.editWorkOrder(selectedId, data)} goto={goto} />}
      {screen === "detail" && <WorkOrderDetail user={user} wo={findWo(selectedId)} actions={actions} goto={goto} />}
      {screen === "notifications" && <NotificationsPage user={user} notifications={notifications} markRead={markRead} markAllRead={markAllRead} goto={goto} />}
    </AppShell>
  );
}
