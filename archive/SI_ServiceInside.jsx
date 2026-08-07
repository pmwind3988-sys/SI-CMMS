import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Wrench, LayoutGrid, ClipboardList, CalendarClock, Boxes, ShoppingCart,
  Users, BarChart3, Settings, Bell, ChevronDown, ChevronRight, Search, Eye, EyeOff,
  ArrowRight, ArrowLeft, AlertTriangle, Timer, PackageX, CheckCircle2,
  ShieldCheck, Loader2, Plus, Image as ImageIcon, Video, X, UserCheck,
  Factory, Layers, Gauge, Clock3, Filter, Download, MoreVertical, FileText,
  PauseCircle, PlayCircle, Send, ThumbsUp, RotateCcw, Ban, Sparkles,
  QrCode, Printer, PencilLine, PowerOff, List, GitBranch, Upload, Activity,
  Repeat, ListChecks, GripVertical, ClipboardCheck, ChevronLeft, CalendarDays,
  ToggleLeft, ToggleRight, Copy, FileDown, Mail, FileSpreadsheet, Save, Trash2
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, Legend, ComposedChart
} from "recharts";

/* ---------------------------------------------------------------
   DESIGN TOKENS  (unchanged system — graphite/steel + amber signal)
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

    @keyframes pulseDot { 0%, 100% { opacity: .25; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }
    @keyframes riseIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .rise { animation: riseIn .4s ease both; }
    input:focus, select:focus, textarea:focus { outline: none; }
    button { font-family: inherit; }
  `}</style>
);

/* ---------------------------------------------------------------
   SI LOGO — official mark. Navy rounded badge, letterform S/I,
   orange dot on the "I" ties the two secondary accent colors
   together without diluting the primary navy brand color.
----------------------------------------------------------------*/
function Logo({ size = 34, radius = 9, variant = "navy" }) {
  const s = size;
  const bg = variant === "navy" ? T.graphite : "#fff";
  const fg = variant === "navy" ? "#fff" : T.graphite;
  return (
    <svg width={s} height={s} viewBox="0 0 34 34" role="img" aria-label="SI logo">
      <rect x="0" y="0" width="34" height="34" rx={radius} fill={bg} />
      <path d="M9.2 13.4c0-2.1 1.9-3.6 4.6-3.6 2.4 0 4.1 1 4.8 2.7l-2.3 1.1c-.5-1-1.3-1.5-2.5-1.5-1.1 0-1.8.5-1.8 1.2 0 .8.8 1.1 2.3 1.5 2.5.6 4.3 1.4 4.3 3.8 0 2.2-2 3.7-4.9 3.7-2.6 0-4.5-1.1-5.2-2.9l2.3-1.1c.5 1.1 1.5 1.7 2.9 1.7 1.2 0 2-.5 2-1.3 0-.8-.8-1.1-2.5-1.5-2.4-.6-4-1.5-4-3.8z" fill={fg} />
      <rect x="22.4" y="10.1" width="2.5" height="12.9" rx="1.1" fill={fg} />
      <circle cx="23.65" cy="7.4" r="1.9" fill={T.amber} />
    </svg>
  );
}
function LogoMark({ size = 34 }) { return <Logo size={size} />; }

/* ---------------------------------------------------------------
   SIGNATURE ELEMENT: Plant Pulse — a field of asset-status dots
   that idle-breathe, echoing a live plant status board.
----------------------------------------------------------------*/
function PlantPulse({ size = 46, dot = 7, gap = 8 }) {
  const dots = useMemo(() => {
    const arr = [];
    for (let i = 0; i < size; i++) {
      const r = Math.random();
      let color = T.good;
      if (r > 0.94) color = T.p1;
      else if (r > 0.86) color = T.amber;
      else if (r > 0.8) color = T.p4;
      arr.push({ color, delay: Math.random() * 3, dur: 2 + Math.random() * 2 });
    }
    return arr;
  }, [size]);
  const cols = Math.ceil(Math.sqrt(size * 2.2));
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${dot}px)`, gap: `${gap}px` }}>
      {dots.map((d, i) => (
        <div key={i} style={{ width: dot, height: dot, borderRadius: "50%", background: d.color, animation: `pulseDot ${d.dur}s ease-in-out ${d.delay}s infinite` }} />
      ))}
    </div>
  );
}
function MiniPulse() { return <PlantPulse size={18} dot={4} gap={4} />; }

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
    "New": T.p4, "Triaged": T.p4, "Assigned": T.p4, "Scheduled": T.p4,
    "In Progress": T.amber, "On Hold": T.inkSoft, "Completed": T.good,
    "Pending Review": T.good, "Approved & Closed": T.good, "Rejected": T.p1,
  };
  const c = styles[s] || T.inkSoft;
  return <span style={{ color: c, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>● {s}</span>;
}
function CriticalityBadge({ c }) {
  const colors = { High: T.p1, Medium: T.p3, Low: T.p4 };
  const col = colors[c] || T.inkSoft;
  return <span style={{ background: `${col}1A`, color: col, border: `1px solid ${col}55`, borderRadius: 5, padding: "2px 8px", fontSize: 11.5, fontWeight: 600 }}>{c}</span>;
}
function AssetStatusBadge({ s }) {
  const styles = { "Active": T.good, "UnderMaintenance": T.amber, "Decommissioned": T.inkSoft, "Disposed": T.p1 };
  const label = { "Active": "Active", "UnderMaintenance": "Under Maintenance", "Decommissioned": "Decommissioned", "Disposed": "Disposed" };
  const c = styles[s] || T.inkSoft;
  return <span style={{ color: c, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>● {label[s] || s}</span>;
}

function Field({ label, required, children, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, display: "block", marginBottom: 6 }}>
        {label} {required && <span style={{ color: T.p1 }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 4 }}>{hint}</div>}
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
    amber: { background: T.amber, color: T.graphite },
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
    <div style={{
      position: "fixed", bottom: 24, right: 24, background: T.graphite, color: "#fff", padding: "12px 18px",
      borderRadius: 12, fontSize: 13, display: "flex", alignItems: "center", gap: 8, zIndex: 1000,
      animation: "toastIn .25s ease both", boxShadow: "0 8px 24px rgba(0,0,0,.25)",
    }}>
      <CheckCircle2 size={15} color={T.amber} /> {message}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,24,28,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ background: "#fff", borderRadius: 12, width: 440, padding: 24 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 15.5, color: T.ink }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.inkSoft }}><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* deterministic pseudo-QR pattern from a string */
function QRCode({ value, size = 88 }) {
  const cells = 9;
  const grid = useMemo(() => {
    let h = 0;
    for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
    const arr = [];
    for (let i = 0; i < cells * cells; i++) {
      h = (h * 1103515245 + 12345) >>> 0;
      arr.push(h % 5 === 0 || h % 7 === 0);
    }
    return arr;
  }, [value]);
  const cell = size / cells;
  return (
    <div style={{ width: size, height: size, background: "#fff", padding: 6, borderRadius: 6, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
      <svg width={size - 12} height={size - 12}>
        {grid.map((on, i) => on && (
          <rect key={i} x={(i % cells) * cell} y={Math.floor(i / cells) * cell} width={cell} height={cell} fill={T.ink} />
        ))}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------
   DOMAIN DATA
----------------------------------------------------------------*/
const DEPARTMENTS = ["Machining", "Assembly", "Press Shop", "Utilities", "Packaging", "Warehouse", "Quality"];
const CATEGORIES = ["Production Line", "CNC Machine", "Conveyor", "Robotics", "Press", "Utility", "Packaging", "Material Handling"];

function genMeterHistory(latest, unit, points = 6) {
  const arr = [];
  let v = latest - (unit === "Cycles" ? 4200 : 260);
  for (let i = 0; i < points; i++) {
    v += (unit === "Cycles" ? 700 : 45) + Math.round(Math.random() * 20);
    arr.push({ date: `W${i + 1}`, value: Math.min(v, latest) });
  }
  arr[arr.length - 1].value = latest;
  return arr;
}

const ASSETS_SEED = [
  { id: "LINE-01", code: "LINE-01", name: "Line 1 — Machining", parentId: null, department: "Machining", category: "Production Line", criticality: "High", status: "Active", manufacturer: "—", model: "—", serial: "—", installDate: "2018-03-01", warrantyExpiry: "", meterReading: null, meterUnit: "", lastPmDate: "2026-06-01", nextPmDueDate: "2026-08-01", downtimeYTD: 30, costYTD: 236000, documents: [] },
  { id: "AST-0412", code: "AST-0412", name: "CNC Lathe #04", parentId: "LINE-01", department: "Machining", category: "CNC Machine", criticality: "High", status: "Active", manufacturer: "Haas", model: "ST-20", serial: "HS20-88231", installDate: "2019-07-12", warrantyExpiry: "2027-07-12", meterReading: 14210, meterUnit: "Hours", lastPmDate: "2026-06-14", nextPmDueDate: "2026-07-20", downtimeYTD: 22, costYTD: 184000, documents: [{ name: "ST-20_Service_Manual.pdf", type: "Manual" }] },
  { id: "AST-0503", code: "AST-0503", name: "CNC Mill #02", parentId: "LINE-01", department: "Machining", category: "CNC Machine", criticality: "Medium", status: "Active", manufacturer: "Mazak", model: "VTC-20", serial: "MZ-4471", installDate: "2020-02-18", warrantyExpiry: "2026-02-18", meterReading: 9820, meterUnit: "Hours", lastPmDate: "2026-05-30", nextPmDueDate: "2026-07-30", downtimeYTD: 8, costYTD: 52000, documents: [] },
  { id: "LINE-02", code: "LINE-02", name: "Line 2 — Assembly", parentId: null, department: "Assembly", category: "Production Line", criticality: "Medium", status: "Active", manufacturer: "—", model: "—", serial: "—", installDate: "2017-11-01", warrantyExpiry: "", meterReading: null, meterUnit: "", lastPmDate: "2026-06-01", nextPmDueDate: "2026-08-10", downtimeYTD: 17, costYTD: 59000, documents: [] },
  { id: "AST-0288", code: "AST-0288", name: "Conveyor B-2", parentId: "LINE-02", department: "Assembly", category: "Conveyor", criticality: "Medium", status: "Active", manufacturer: "Dorner", model: "2200 Series", serial: "DN-2291", installDate: "2017-11-05", warrantyExpiry: "2023-11-05", meterReading: 38210, meterUnit: "Hours", lastPmDate: "2026-06-01", nextPmDueDate: "2026-07-15", downtimeYTD: 14, costYTD: 41000, documents: [] },
  { id: "AST-0640", code: "AST-0640", name: "Robotic Welder A1", parentId: "LINE-02", department: "Assembly", category: "Robotics", criticality: "High", status: "Active", manufacturer: "Fanuc", model: "ARC Mate 100", serial: "FN-7723", installDate: "2021-09-09", warrantyExpiry: "2026-09-09", meterReading: 5120, meterUnit: "Hours", lastPmDate: "2026-06-20", nextPmDueDate: "2026-08-05", downtimeYTD: 3, costYTD: 18000, documents: [] },
  { id: "AST-0157", code: "AST-0157", name: "Hydraulic Press 3", parentId: null, department: "Press Shop", category: "Press", criticality: "High", status: "UnderMaintenance", manufacturer: "Schuler", model: "MSP-315", serial: "SC-1188", installDate: "2016-04-22", warrantyExpiry: "2021-04-22", meterReading: 61200, meterUnit: "Cycles", lastPmDate: "2026-04-10", nextPmDueDate: "2026-07-10", downtimeYTD: 46, costYTD: 97000, documents: [{ name: "MSP-315_Wiring_Diagram.pdf", type: "Drawing" }] },
  { id: "AST-0330", code: "AST-0330", name: "Air Compressor 1", parentId: null, department: "Utilities", category: "Utility", criticality: "Medium", status: "Active", manufacturer: "Atlas Copco", model: "GA30", serial: "AC-5567", installDate: "2015-01-15", warrantyExpiry: "2020-01-15", meterReading: 52100, meterUnit: "Hours", lastPmDate: "2026-06-25", nextPmDueDate: "2026-07-25", downtimeYTD: 5, costYTD: 9000, documents: [] },
  { id: "AST-0212", code: "AST-0212", name: "Boiler Unit A", parentId: null, department: "Utilities", category: "Utility", criticality: "High", status: "Active", manufacturer: "Cleaver-Brooks", model: "CB200", serial: "CB-9012", installDate: "2014-06-01", warrantyExpiry: "2019-06-01", meterReading: 71500, meterUnit: "Hours", lastPmDate: "2026-06-05", nextPmDueDate: "2026-07-23", downtimeYTD: 0, costYTD: 12000, documents: [] },
  { id: "AST-0501", code: "AST-0501", name: "Packaging Line C", parentId: null, department: "Packaging", category: "Packaging", criticality: "Medium", status: "Active", manufacturer: "Bosch", model: "Pack 403", serial: "BS-3345", installDate: "2019-10-10", warrantyExpiry: "2024-10-10", meterReading: 22100, meterUnit: "Cycles", lastPmDate: "2026-06-10", nextPmDueDate: "2026-07-28", downtimeYTD: 9, costYTD: 26000, documents: [] },
  { id: "AST-0099", code: "AST-0099", name: "Overhead Crane 2", parentId: null, department: "Warehouse", category: "Material Handling", criticality: "Low", status: "Active", manufacturer: "Konecranes", model: "CXT", serial: "KC-2214", installDate: "2013-08-19", warrantyExpiry: "2018-08-19", meterReading: 15400, meterUnit: "Hours", lastPmDate: "2026-05-15", nextPmDueDate: "2026-07-22", downtimeYTD: 2, costYTD: 4000, documents: [] },
].map((a) => ({ ...a, meterHistory: a.meterReading ? genMeterHistory(a.meterReading, a.meterUnit) : [] }));

const TODAY = new Date("2026-07-22");
function daysBetween(dateStr) { return Math.round((new Date(dateStr) - TODAY) / 86400000); }

const CHECKLIST_TEMPLATES_SEED = [
  { id: "tpl1", name: "CNC Quarterly Service", category: "PM", plant: "Plant 01 — Chennai", version: 2, items: [
    { id: "i1", label: "Check spindle temperature at idle", inputType: "Number", required: true, help: "Should read below 45°C" },
    { id: "i2", label: "Inspect coolant lines for leaks", inputType: "Boolean", required: true, help: "" },
    { id: "i3", label: "Lubricate ball screws", inputType: "Boolean", required: true, help: "" },
    { id: "i4", label: "Photo of tool turret condition", inputType: "Photo", required: false, help: "" },
    { id: "i5", label: "Notes / anomalies observed", inputType: "Text", required: false, help: "" },
  ] },
  { id: "tpl2", name: "Hydraulic System Check", category: "PM", plant: "Global", version: 1, items: [
    { id: "i1", label: "Fluid level within range", inputType: "Boolean", required: true, help: "" },
    { id: "i2", label: "Fluid pressure reading", inputType: "Number", required: true, help: "PSI" },
    { id: "i3", label: "Check for fitting leaks", inputType: "Boolean", required: true, help: "" },
  ] },
  { id: "tpl3", name: "Utility Filter Replacement", category: "PM", plant: "Global", version: 1, items: [
    { id: "i1", label: "Remove and inspect old filter", inputType: "Boolean", required: true, help: "" },
    { id: "i2", label: "Install new filter", inputType: "Boolean", required: true, help: "" },
    { id: "i3", label: "Photo of installed filter", inputType: "Photo", required: false, help: "" },
  ] },
  { id: "tpl4", name: "Permit-to-Work Safety Check", category: "Safety", plant: "Global", version: 3, items: [
    { id: "i1", label: "LOTO applied and verified", inputType: "Boolean", required: true, help: "" },
    { id: "i2", label: "PPE confirmed for all crew", inputType: "Boolean", required: true, help: "" },
    { id: "i3", label: "Area barricaded", inputType: "Boolean", required: true, help: "" },
  ] },
];

const PM_SCHEDULES_SEED = [
  { id: "pm1", assetId: "AST-0412", title: "Quarterly Spindle Service", trigger: "Time", frequencyValue: 90, frequencyUnit: "Days", checklistTemplateId: "tpl1", assignedTeam: ["u3"], startDate: "2026-01-15", isActive: true, lastCompletedAt: "2026-04-15", nextDue: "2026-08-15" },
  { id: "pm2", assetId: "AST-0157", title: "Hydraulic Fluid Change", trigger: "Meter", frequencyValue: 5000, frequencyUnit: "Cycles", checklistTemplateId: "tpl2", assignedTeam: ["u1"], startDate: "2026-02-01", isActive: true, lastCompletedAt: "2026-06-01", nextDue: "2026-09-01" },
  { id: "pm3", assetId: "AST-0330", title: "Filter Replacement", trigger: "Time", frequencyValue: 30, frequencyUnit: "Days", checklistTemplateId: "tpl3", assignedTeam: ["u4"], startDate: "2026-06-25", isActive: true, lastCompletedAt: "2026-06-25", nextDue: "2026-07-25" },
  { id: "pm4", assetId: "AST-0412", title: "Coolant System Flush", trigger: "Time", frequencyValue: 180, frequencyUnit: "Days", checklistTemplateId: "tpl1", assignedTeam: ["u3", "u2"], startDate: "2026-05-06", isActive: true, lastCompletedAt: "2026-05-06", nextDue: "2026-11-02" },
  { id: "pm5", assetId: "AST-0212", title: "Boiler Safety Inspection", trigger: "Time", frequencyValue: 30, frequencyUnit: "Days", checklistTemplateId: "tpl4", assignedTeam: ["u4"], startDate: "2026-06-23", isActive: true, lastCompletedAt: "2026-06-23", nextDue: "2026-07-23" },
  { id: "pm6", assetId: "AST-0099", title: "Crane Cable Inspection", trigger: "Time", frequencyValue: 60, frequencyUnit: "Days", checklistTemplateId: "tpl4", assignedTeam: ["u5"], startDate: "2026-05-24", isActive: false, lastCompletedAt: "2026-05-24", nextDue: "2026-07-24" },
];

function machineById(id) {
  const a = ASSETS_SEED.find((x) => x.id === id);
  return a ? { id: a.id, name: a.name, dept: a.department, criticality: a.criticality } : null;
}
const MACHINES = ASSETS_SEED.filter((a) => a.category !== "Production Line").map((a) => ({ id: a.id, name: a.name, dept: a.department, criticality: a.criticality }));

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
const TECHNICIANS = [
  { id: "u1", name: "Arun Kumar", skills: ["Mechanical", "Hydraulics"], load: 2 },
  { id: "u2", name: "Meera Iyer", skills: ["Electrical", "PLC"], load: 4 },
  { id: "u3", name: "Sanjay Rao", skills: ["Mechanical", "CNC"], load: 1 },
  { id: "u4", name: "Divya Shah", skills: ["Utilities", "Boilers"], load: 3 },
  { id: "u5", name: "Karan Mehta", skills: ["Electrical", "Conveyors"], load: 2 },
];
const STATUS_FLOW = ["New", "Triaged", "Assigned", "Scheduled", "In Progress", "Completed", "Pending Review", "Approved & Closed"];
function suggestPriority(impactValue) { const found = IMPACT_OPTIONS.find((i) => i.value === impactValue); return found ? found.suggests : "P3"; }
function fmtDue(ms) {
  const h = Math.floor(ms / 3600e3); const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  if (h >= 1) return `${h}h ${Math.floor((ms % 3600e3) / 60000)}m`;
  return `${Math.floor(ms / 60000)}m`;
}

function seedWorkOrders() {
  const now = Date.now();
  return [
    { id: "wo1", woNumber: "PLT001-WO-2026-1187", machine: machineById("AST-0412"), department: "Machining", type: "Breakdown", priority: "P1", status: "In Progress", impact: "full_stoppage", estDowntime: { value: 3, unit: "Hours" }, description: "Spindle overheating, line stopped.", requestedBy: "Ravi (Operator)", assignedTo: [TECHNICIANS[2]], photos: [], videos: [], createdAt: now - 45 * 60000,
      history: [
        { status: "New", actor: "Ravi (Operator)", t: now - 45 * 60000, remarks: "Reported via floor terminal" },
        { status: "Triaged", actor: "System", t: now - 42 * 60000, remarks: "Priority auto-classified P1" },
        { status: "Assigned", actor: "Priya Nair", t: now - 38 * 60000, remarks: "Assigned to Sanjay Rao" },
        { status: "In Progress", actor: "Sanjay Rao", t: now - 20 * 60000, remarks: "Started diagnosis" },
      ] },
    { id: "wo2", woNumber: "PLT001-WO-2026-1183", machine: machineById("AST-0288"), department: "Assembly", type: "Breakdown", priority: "P2", status: "Assigned", impact: "reduced_capacity", estDowntime: { value: 6, unit: "Hours" }, description: "Belt slipping intermittently under load.", requestedBy: "Lena (Operator)", assignedTo: [TECHNICIANS[4]], photos: [], videos: [], createdAt: now - 2 * 3600e3,
      history: [
        { status: "New", actor: "Lena (Operator)", t: now - 2 * 3600e3 },
        { status: "Triaged", actor: "System", t: now - 118 * 60000 },
        { status: "Assigned", actor: "Priya Nair", t: now - 100 * 60000, remarks: "Assigned to Karan Mehta" },
      ] },
    { id: "wo3", woNumber: "PLT001-WO-2026-1179", machine: machineById("AST-0157"), department: "Press Shop", type: "Breakdown", priority: "P3", status: "On Hold", impact: "auxiliary", estDowntime: { value: 1, unit: "Days" }, description: "Minor hydraulic fluid leak at fitting.", requestedBy: "Operator Team", assignedTo: [TECHNICIANS[0]], photos: [], videos: [], createdAt: now - 5 * 3600e3,
      history: [
        { status: "New", actor: "Operator Team", t: now - 5 * 3600e3 },
        { status: "Triaged", actor: "System", t: now - 4.8 * 3600e3 },
        { status: "Assigned", actor: "Priya Nair", t: now - 4.5 * 3600e3 },
        { status: "In Progress", actor: "Arun Kumar", t: now - 3 * 3600e3 },
        { status: "On Hold", actor: "Arun Kumar", t: now - 2 * 3600e3, remarks: "Waiting on seal kit — low stock" },
      ] },
    { id: "wo4", woNumber: "PLT001-WO-2026-1174", machine: machineById("AST-0330"), department: "Utilities", type: "PM", priority: "P4", status: "Scheduled", impact: "none", estDowntime: { value: 2, unit: "Hours" }, description: "Scheduled quarterly filter replacement.", requestedBy: "PM Auto-Schedule", assignedTo: [], photos: [], videos: [], createdAt: now - 24 * 3600e3,
      history: [
        { status: "New", actor: "System", t: now - 24 * 3600e3, remarks: "Auto-generated from PM Schedule" },
        { status: "Triaged", actor: "System", t: now - 24 * 3600e3 },
        { status: "Scheduled", actor: "Planner", t: now - 20 * 3600e3 },
      ] },
    { id: "wo5", woNumber: "PLT001-WO-2026-1170", machine: machineById("AST-0501"), department: "Packaging", type: "Breakdown", priority: "P2", status: "Pending Review", impact: "reduced_capacity", estDowntime: { value: 4, unit: "Hours" }, description: "Sensor misalignment causing jam stoppages.", requestedBy: "Operator Team", assignedTo: [TECHNICIANS[4]], photos: [], videos: [], createdAt: now - 8 * 3600e3,
      history: [
        { status: "New", actor: "Operator Team", t: now - 8 * 3600e3 },
        { status: "Triaged", actor: "System", t: now - 7.8 * 3600e3 },
        { status: "Assigned", actor: "Priya Nair", t: now - 7.5 * 3600e3 },
        { status: "In Progress", actor: "Karan Mehta", t: now - 6 * 3600e3 },
        { status: "Completed", actor: "Karan Mehta", t: now - 40 * 60000, remarks: "Sensor realigned & tested" },
        { status: "Pending Review", actor: "Karan Mehta", t: now - 38 * 60000 },
      ] },
    { id: "wo6", woNumber: "PLT001-WO-2026-1052", machine: machineById("AST-0157"), department: "Press Shop", type: "Breakdown", priority: "P1", status: "Approved & Closed", impact: "full_stoppage", estDowntime: { value: 5, unit: "Hours" }, description: "Pressure valve failure, full stoppage.", requestedBy: "Operator Team", assignedTo: [TECHNICIANS[0]], photos: [], videos: [], createdAt: now - 20 * 24 * 3600e3,
      history: [
        { status: "New", actor: "Operator Team", t: now - 20 * 24 * 3600e3 },
        { status: "Assigned", actor: "Priya Nair", t: now - 20 * 24 * 3600e3 + 600000 },
        { status: "In Progress", actor: "Arun Kumar", t: now - 20 * 24 * 3600e3 + 1200000 },
        { status: "Completed", actor: "Arun Kumar", t: now - 20 * 24 * 3600e3 + 18000000, remarks: "Valve replaced" },
        { status: "Pending Review", actor: "Arun Kumar", t: now - 20 * 24 * 3600e3 + 18200000 },
        { status: "Approved & Closed", actor: "Priya Nair", t: now - 20 * 24 * 3600e3 + 19000000 },
      ] },
  ];
}

/* ================================================================
   APP SHELL
================================================================ */
const NAV = [
  { key: "dashboard", icon: LayoutGrid, label: "Dashboard" },
  { key: "assets", icon: Wrench, label: "Assets" },
  { key: "workorders", icon: ClipboardList, label: "Work Orders" },
  { key: "pm", icon: CalendarClock, label: "PM Schedules" },
  { key: "inventory", icon: Boxes, label: "Inventory" },
  { key: "procurement", icon: ShoppingCart, label: "Procurement" },
  { key: "reports", icon: BarChart3, label: "Reports" },
  { key: "users", icon: Users, label: "Users & Roles" },
  { key: "settings", icon: Settings, label: "Settings" },
];

function AppShell({ user, active, onNavigate, children }) {
  return (
    <div className="f-display" style={{ minHeight: "100vh", display: "flex", background: T.fog }}>
      <FontStyles />
      <div style={{ width: 224, background: T.graphite, padding: "20px 14px", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div className="flex items-center gap-2.5" style={{ padding: "0 8px", marginBottom: 28 }}>
          <Logo size={32} variant="light" />
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 16.5, lineHeight: 1 }}>SI</div>
            <div className="f-mono" style={{ color: "#9FB6E0", fontSize: 9.5, letterSpacing: "0.04em", marginTop: 1 }}>SERVICE INSIDE</div>
          </div>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((item) => (
            <button key={item.key} onClick={() => onNavigate(item.key)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 12,
              background: active === item.key ? T.steel : "transparent", border: "none", cursor: "pointer",
              color: active === item.key ? "#fff" : "#B9C9E8", fontSize: 13.5, fontWeight: 500, textAlign: "left",
            }}>
              <item.icon size={16} />{item.label}
            </button>
          ))}
        </nav>
        <div style={{ marginTop: "auto", padding: "12px 8px", borderTop: `1px solid ${T.steelLine}` }}>
          <div className="flex items-center gap-2">
            <MiniPulse /><span className="f-mono" style={{ color: "#7C93C4", fontSize: 10.5 }}>Live plant status</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="flex items-center justify-between" style={{ padding: "14px 26px", background: T.fogCard, borderBottom: `1px solid ${T.border}` }}>
          <div className="flex items-center gap-2" style={{ background: T.fog, borderRadius: 12, padding: "7px 12px", width: 320 }}>
            <Search size={15} color={T.inkSoft} />
            <input placeholder="Search assets, work orders…" style={{ border: "none", outline: "none", background: "transparent", fontSize: 13.5, width: "100%" }} />
          </div>
          <div className="flex items-center gap-4">
            <button className="flex items-center gap-1.5" style={{ background: "none", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: "7px 12px", fontSize: 13, color: T.ink, cursor: "pointer" }}>
              Plant 01 — Chennai <ChevronDown size={14} />
            </button>
            <button style={{ background: "none", border: "none", cursor: "pointer", position: "relative" }}>
              <Bell size={19} color={T.inkSoft} />
              <span style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: 4, background: T.p1 }} />
            </button>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: T.amber, display: "flex", alignItems: "center", justifyContent: "center", color: T.graphite, fontWeight: 700, fontSize: 13 }}>
              {user.name.split(" ").map((n) => n[0]).join("")}
            </div>
          </div>
        </div>
        <div style={{ padding: "24px 26px", overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

/* ================================================================
   ASSET MANAGEMENT MODULE
================================================================ */

/* ---- 1. Asset Register (List / Tree) -------------------------- */
function AssetTreeNode({ asset, all, depth, onOpen }) {
  const children = all.filter((a) => a.parentId === asset.id);
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div onClick={() => onOpen(asset.id)} className="flex items-center justify-between" style={{ padding: "10px 14px", paddingLeft: 14 + depth * 24, cursor: "pointer", borderBottom: "1px solid #F1F3F5" }}>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          {children.length > 0 ? (
            <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ background: "none", border: "none", cursor: "pointer", color: T.inkSoft, padding: 0 }}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : <span style={{ width: 14 }} />}
          {children.length > 0 ? <Layers size={14} color={T.p4} /> : <Wrench size={13} color={T.inkSoft} />}
          <span className="f-mono" style={{ fontSize: 11.5, color: T.inkSoft }}>{asset.code}</span>
          <span style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{asset.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <CriticalityBadge c={asset.criticality} />
          <AssetStatusBadge s={asset.status} />
        </div>
      </div>
      {open && children.map((c) => <AssetTreeNode key={c.id} asset={c} all={all} depth={depth + 1} onOpen={onOpen} />)}
    </div>
  );
}

function AssetRegister({ assets, onOpen, onCreate }) {
  const [view, setView] = useState("list"); // list | tree
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("All");
  const [crit, setCrit] = useState("All");
  const [status, setStatus] = useState("All");

  const filtered = assets.filter((a) => {
    if (q && !(a.name.toLowerCase().includes(q.toLowerCase()) || a.code.toLowerCase().includes(q.toLowerCase()))) return false;
    if (dept !== "All" && a.department !== dept) return false;
    if (crit !== "All" && a.criticality !== crit) return false;
    if (status !== "All" && a.status !== status) return false;
    return true;
  });
  const roots = filtered.filter((a) => !a.parentId || !filtered.some((f) => f.id === a.parentId));

  return (
    <div className="rise">
      <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink }}>Asset Register</h1>
          <p style={{ fontSize: 13, color: T.inkSoft }}>{filtered.length} of {assets.length} assets</p>
        </div>
        <Btn variant="amber" icon={Plus} onClick={onCreate}>Create Asset</Btn>
      </div>

      <div className="flex items-center gap-3" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <div className="flex items-center gap-2" style={{ background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: "7px 12px", width: 240 }}>
          <Search size={14} color={T.inkSoft} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code…" style={{ border: "none", outline: "none", fontSize: 13, width: "100%" }} />
        </div>
        <select value={dept} onChange={(e) => setDept(e.target.value)} style={{ ...inputStyle, width: 150, padding: "8px 10px" }}>
          <option>All</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select value={crit} onChange={(e) => setCrit(e.target.value)} style={{ ...inputStyle, width: 150, padding: "8px 10px" }}>
          <option>All</option><option>High</option><option>Medium</option><option>Low</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, width: 170, padding: "8px 10px" }}>
          <option>All</option><option>Active</option><option>UnderMaintenance</option><option>Decommissioned</option><option>Disposed</option>
        </select>
        <div style={{ marginLeft: "auto" }} className="flex items-center gap-1" >
          <button onClick={() => setView("list")} style={{ padding: "7px 10px", borderRadius: 7, border: `1.5px solid ${view === "list" ? T.ink : T.border}`, background: view === "list" ? T.ink : "#fff", color: view === "list" ? "#fff" : T.ink, cursor: "pointer" }}><List size={14} /></button>
          <button onClick={() => setView("tree")} style={{ padding: "7px 10px", borderRadius: 7, border: `1.5px solid ${view === "tree" ? T.ink : T.border}`, background: view === "tree" ? T.ink : "#fff", color: view === "tree" ? "#fff" : T.ink, cursor: "pointer" }}><GitBranch size={14} /></button>
          <Btn variant="ghost" icon={Download} size="sm" style={{ marginLeft: 6 }}>Export</Btn>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden" }}>
        {view === "list" ? (
          <>
            <div className="flex items-center" style={{ padding: "10px 18px", background: T.fog, fontSize: 11.5, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              <div style={{ flex: 2 }}>Asset</div>
              <div style={{ flex: 1.2 }}>Category</div>
              <div style={{ width: 90 }}>Criticality</div>
              <div style={{ flex: 1.3 }}>Status</div>
              <div style={{ flex: 1.3 }}>Next PM Due</div>
              <div style={{ width: 30 }}></div>
            </div>
            {filtered.map((a, i) => {
              const overdue = a.nextPmDueDate && new Date(a.nextPmDueDate) < new Date("2026-07-22");
              return (
                <div key={a.id} onClick={() => onOpen(a.id)} className="flex items-center" style={{ padding: "13px 18px", borderTop: i > 0 ? "1px solid #F1F3F5" : "none", cursor: "pointer" }}>
                  <div style={{ flex: 2, minWidth: 0 }}>
                    <div className="f-mono" style={{ fontSize: 11.5, color: T.inkSoft }}>{a.code}</div>
                    <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{a.name}</div>
                  </div>
                  <div style={{ flex: 1.2, fontSize: 13, color: T.inkSoft }}>{a.category}</div>
                  <div style={{ width: 90 }}><CriticalityBadge c={a.criticality} /></div>
                  <div style={{ flex: 1.3 }}><AssetStatusBadge s={a.status} /></div>
                  <div className="f-mono" style={{ flex: 1.3, fontSize: 12, color: overdue ? T.p1 : T.inkSoft, fontWeight: overdue ? 700 : 400 }}>
                    {a.nextPmDueDate || "—"} {overdue && "· overdue"}
                  </div>
                  <div style={{ width: 30, color: T.inkSoft }}><MoreVertical size={15} /></div>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: T.inkSoft, fontSize: 13 }}>No assets match these filters.</div>}
          </>
        ) : (
          <div>{roots.map((r) => <AssetTreeNode key={r.id} asset={r} all={filtered} depth={0} onOpen={onOpen} />)}</div>
        )}
      </div>
    </div>
  );
}

/* ---- 2. Create / Edit Asset ------------------------------------ */
function AssetForm({ existing, assets, onCancel, onSave }) {
  const [name, setName] = useState(existing?.name || "");
  const [code, setCode] = useState(existing?.code || "");
  const [parentId, setParentId] = useState(existing?.parentId || "");
  const [department, setDepartment] = useState(existing?.department || "");
  const [category, setCategory] = useState(existing?.category || "");
  const [criticality, setCriticality] = useState(existing?.criticality || "Medium");
  const [manufacturer, setManufacturer] = useState(existing?.manufacturer || "");
  const [model, setModel] = useState(existing?.model || "");
  const [serial, setSerial] = useState(existing?.serial || "");
  const [installDate, setInstallDate] = useState(existing?.installDate || "");
  const [warrantyExpiry, setWarrantyExpiry] = useState(existing?.warrantyExpiry || "");
  const [meterUnit, setMeterUnit] = useState(existing?.meterUnit || "Hours");
  const [meterReading, setMeterReading] = useState(existing?.meterReading ?? "");
  const [photo, setPhoto] = useState(null);
  const [specSheet, setSpecSheet] = useState(null);
  const [errors, setErrors] = useState({});
  const photoInput = useRef(null);
  const fileInput = useRef(null);

  function handleSubmit(addAnother) {
    const errs = {};
    if (!name) errs.name = "Asset name is required.";
    if (!code) errs.code = "Asset code is required.";
    if (!category) errs.category = "Select a category.";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const asset = {
      id: existing?.id || code.toUpperCase().replace(/\s+/g, "-"),
      code, name, parentId: parentId || null, department, category, criticality,
      status: existing?.status || "Active", manufacturer, model, serial, installDate, warrantyExpiry,
      meterUnit, meterReading: meterReading === "" ? null : Number(meterReading),
      meterHistory: existing?.meterHistory || (meterReading ? genMeterHistory(Number(meterReading), meterUnit) : []),
      lastPmDate: existing?.lastPmDate || "—", nextPmDueDate: existing?.nextPmDueDate || "—",
      downtimeYTD: existing?.downtimeYTD || 0, costYTD: existing?.costYTD || 0,
      documents: existing?.documents || [],
    };
    onSave(asset, addAnother);
    if (addAnother) {
      setName(""); setCode(""); setSerial(""); setMeterReading("");
    }
  }

  return (
    <div className="rise" style={{ maxWidth: 900 }}>
      <button onClick={onCancel} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}>
        <ArrowLeft size={15} /> Back to Asset Register
      </button>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink, marginBottom: 4 }}>{existing ? "Edit Asset" : "Create Asset"}</h1>
      <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 24 }}>Register equipment with its hierarchy, specs, and warranty details.</p>

      <div className="flex gap-6" style={{ flexWrap: "wrap" }}>
        <div style={{ flex: 2, minWidth: 380, background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 22 }}>
          <div className="flex gap-4">
            <div style={{ flex: 1 }}><Field label="Asset name" required hint={errors.name}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CNC Lathe #05" style={{ ...inputStyle, borderColor: errors.name ? T.p1 : "#D8DEE4" }} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Asset code" required hint={errors.code}><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. AST-0721" style={{ ...inputStyle, borderColor: errors.code ? T.p1 : "#D8DEE4" }} /></Field></div>
          </div>
          <div className="flex gap-4">
            <div style={{ flex: 1 }}>
              <Field label="Parent asset">
                <select value={parentId} onChange={(e) => setParentId(e.target.value)} style={inputStyle}>
                  <option value="">None (top-level)</option>
                  {assets.filter((a) => a.id !== existing?.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Plant">
                <input value="Plant 01 — Chennai" disabled style={{ ...inputStyle, background: T.fog, color: T.inkSoft }} />
              </Field>
            </div>
          </div>
          <div className="flex gap-4">
            <div style={{ flex: 1 }}>
              <Field label="Department">
                <select value={department} onChange={(e) => setDepartment(e.target.value)} style={inputStyle}>
                  <option value="">Select department…</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Category" required hint={errors.category}>
                <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, borderColor: errors.category ? T.p1 : "#D8DEE4" }}>
                  <option value="">Select category…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>
          </div>

          <Field label="Criticality" required>
            <div className="flex gap-2">
              {["High", "Medium", "Low"].map((c) => (
                <button key={c} onClick={() => setCriticality(c)} style={{
                  padding: "8px 16px", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 500,
                  border: `1.5px solid ${criticality === c ? PRIORITY_COLORS[{ High: "P1", Medium: "P3", Low: "P4" }[c]] : "#D8DEE4"}`,
                  background: criticality === c ? `${PRIORITY_COLORS[{ High: "P1", Medium: "P3", Low: "P4" }[c]]}1A` : "#fff",
                  color: criticality === c ? PRIORITY_COLORS[{ High: "P1", Medium: "P3", Low: "P4" }[c]] : T.ink,
                }}>{c}</button>
              ))}
            </div>
          </Field>

          <div className="flex gap-4">
            <div style={{ flex: 1 }}><Field label="Manufacturer"><input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} style={inputStyle} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Model"><input value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Serial number"><input value={serial} onChange={(e) => setSerial(e.target.value)} style={inputStyle} /></Field></div>
          </div>
          <div className="flex gap-4">
            <div style={{ flex: 1 }}><Field label="Install date"><input type="date" value={installDate} onChange={(e) => setInstallDate(e.target.value)} style={inputStyle} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Warranty expiry"><input type="date" value={warrantyExpiry} onChange={(e) => setWarrantyExpiry(e.target.value)} style={inputStyle} /></Field></div>
          </div>
          <div className="flex gap-4">
            <div style={{ flex: 1 }}>
              <Field label="Meter unit">
                <select value={meterUnit} onChange={(e) => setMeterUnit(e.target.value)} style={inputStyle}>
                  <option>Hours</option><option>Cycles</option><option>Km</option>
                </select>
              </Field>
            </div>
            <div style={{ flex: 1 }}><Field label="Initial meter reading"><input type="number" value={meterReading} onChange={(e) => setMeterReading(e.target.value)} style={inputStyle} /></Field></div>
          </div>

          <div className="flex gap-4">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, marginBottom: 8 }}>Photo</div>
              <button onClick={() => photoInput.current.click()} className="flex items-center justify-center gap-2" style={{ width: "100%", padding: "16px", border: "1.5px dashed #D8DEE4", borderRadius: 12, background: T.fog, cursor: "pointer", color: T.inkSoft, fontSize: 13 }}>
                <ImageIcon size={15} /> {photo ? photo.name : "Upload photo"}
              </button>
              <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files[0])} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, marginBottom: 8 }}>Spec sheet / manual</div>
              <button onClick={() => fileInput.current.click()} className="flex items-center justify-center gap-2" style={{ width: "100%", padding: "16px", border: "1.5px dashed #D8DEE4", borderRadius: 12, background: T.fog, cursor: "pointer", color: T.inkSoft, fontSize: 13 }}>
                <FileText size={15} /> {specSheet ? specSheet.name : "Upload document"}
              </button>
              <input ref={fileInput} type="file" accept=".pdf,.doc,.docx" hidden onChange={(e) => setSpecSheet(e.target.files[0])} />
            </div>
          </div>
        </div>

        {/* QR PREVIEW SIDEBAR */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="rise" style={{ background: T.graphite, borderRadius: 12, padding: 20, color: "#fff", position: "sticky", top: 24, textAlign: "center" }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 14, justifyContent: "center" }}>
              <QrCode size={15} color={T.amber} /><span style={{ fontWeight: 700, fontSize: 14 }}>Asset QR label</span>
            </div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <QRCode value={code || "ASSET"} size={110} />
            </div>
            <div className="f-mono" style={{ fontSize: 12, color: T.amberSoft }}>{code || "—"}</div>
            <div style={{ fontSize: 12, color: "#B9C9E8", marginTop: 2 }}>{name || "Unnamed asset"}</div>
            <div style={{ fontSize: 11.5, color: "#7C93C4", marginTop: 12 }}>Generated live as you type — printable after save.</div>
          </div>
          <div className="flex gap-2" style={{ marginTop: 16 }}>
            <Btn variant="amber" onClick={() => handleSubmit(false)} icon={CheckCircle2} style={{ flex: 1, justifyContent: "center" }}>Save</Btn>
            <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          </div>
          {!existing && <Btn variant="subtle" onClick={() => handleSubmit(true)} style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>Save & Add Another</Btn>}
        </div>
      </div>
    </div>
  );
}

/* ---- 3. Asset Detail (6 tabs) ----------------------------------- */
function OverviewTab({ asset, workOrders }) {
  const openCount = workOrders.filter((w) => w.machine?.id === asset.id && !["Approved & Closed", "Rejected"].includes(w.status)).length;
  const rows = [
    ["Category", asset.category], ["Department", asset.department], ["Criticality", null],
    ["Manufacturer", asset.manufacturer || "—"], ["Model", asset.model || "—"], ["Serial number", asset.serial || "—"],
    ["Install date", asset.installDate || "—"], ["Warranty expiry", asset.warrantyExpiry || "—"],
    ["Meter reading", asset.meterReading != null ? `${asset.meterReading.toLocaleString()} ${asset.meterUnit}` : "—"],
  ];
  return (
    <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 280 }}>
        {rows.map(([label, val]) => (
          <div key={label} className="flex justify-between" style={{ padding: "9px 0", borderBottom: "1px solid #F1F3F5", fontSize: 13.5 }}>
            <span style={{ color: T.inkSoft }}>{label}</span>
            <span style={{ color: T.ink, fontWeight: 500 }}>{label === "Criticality" ? <CriticalityBadge c={asset.criticality} /> : val}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 280 }}>
        <div className="flex gap-3">
          {[["Downtime YTD", `${asset.downtimeYTD} hrs`, T.p1], ["Maintenance Cost YTD", `₹${asset.costYTD.toLocaleString()}`, T.p4], ["Open Work Orders", openCount, T.amber]].map(([l, v, c]) => (
            <div key={l} style={{ flex: 1, background: T.fog, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 6 }}>{l}</div>
              <div className="f-mono" style={{ fontSize: 18, fontWeight: 700, color: c }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MaintenanceHistoryTab({ asset, workOrders, onOpenWO }) {
  const history = workOrders.filter((w) => w.machine?.id === asset.id);
  return (
    <div>
      {history.length === 0 && <div style={{ fontSize: 13, color: T.inkSoft }}>No work orders recorded yet for this asset.</div>}
      {history.map((w, i) => (
        <div key={w.id} onClick={() => onOpenWO(w.id)} className="flex items-center justify-between" style={{ padding: "12px 4px", borderBottom: i < history.length - 1 ? "1px solid #F1F3F5" : "none", cursor: "pointer" }}>
          <div>
            <div className="f-mono" style={{ fontSize: 11.5, color: T.inkSoft }}>{w.woNumber}</div>
            <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{w.type} — {w.description.slice(0, 46)}{w.description.length > 46 ? "…" : ""}</div>
          </div>
          <div className="flex items-center gap-4">
            <PriorityBadge p={w.priority} size="sm" /><StatusBadge s={w.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PMScheduleTab({ asset, schedules, onAddPM }) {
  const list = schedules.filter((s) => s.assetId === asset.id);
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: T.inkSoft }}>{list.length} PM schedule{list.length !== 1 ? "s" : ""} on this asset</span>
        <Btn size="sm" variant="ghost" icon={Plus} onClick={() => onAddPM(asset.id)}>Add PM Schedule</Btn>
      </div>
      {list.length === 0 && <div style={{ fontSize: 13, color: T.inkSoft }}>No PM schedules linked to this asset yet.</div>}
      {list.map((s) => (
        <div key={s.id} className="flex items-center justify-between" style={{ padding: "12px 14px", background: T.fog, borderRadius: 12, marginBottom: 8, opacity: s.isActive ? 1 : 0.55 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: T.ink }}>{s.title} {!s.isActive && <span style={{ fontSize: 11, color: T.inkSoft }}>(inactive)</span>}</div>
            <div style={{ fontSize: 12, color: T.inkSoft }}>{s.trigger}-based · every {s.frequencyValue} {s.frequencyUnit.toLowerCase()}</div>
          </div>
          <div className="f-mono" style={{ fontSize: 12, color: daysBetween(s.nextDue) < 0 ? T.p1 : T.p4, fontWeight: 600 }}>Next: {s.nextDue}</div>
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({ asset, onAdd }) {
  const fileInput = useRef(null);
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: T.inkSoft }}>{asset.documents.length} document{asset.documents.length !== 1 ? "s" : ""}</span>
        <Btn size="sm" variant="ghost" icon={Upload} onClick={() => fileInput.current.click()}>Upload Document</Btn>
        <input ref={fileInput} type="file" hidden onChange={(e) => { const f = e.target.files[0]; if (f) onAdd({ name: f.name, type: "Other" }); }} />
      </div>
      <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
        {asset.documents.map((d, i) => (
          <div key={i} style={{ width: 160, border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: 14 }}>
            <FileText size={20} color={T.p4} />
            <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 500, marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{d.type}</div>
          </div>
        ))}
        {asset.documents.length === 0 && <div style={{ fontSize: 13, color: T.inkSoft }}>No documents uploaded yet.</div>}
      </div>
    </div>
  );
}

const DOWNTIME_LOG = {
  "AST-0412": [{ start: "Jul 22, 08:15", end: "Ongoing", hrs: "0.7 (ongoing)", cause: "Spindle overheating", woId: "wo1" }],
  "AST-0288": [{ start: "Jul 21, 14:00", end: "Jul 21, 20:00", hrs: "6.0", cause: "Belt slipping", woId: "wo2" }],
  "AST-0157": [
    { start: "Jul 21, 11:00", end: "Ongoing", hrs: "5.0 (ongoing)", cause: "Hydraulic fluid leak", woId: "wo3" },
    { start: "Jul 2, 09:00", end: "Jul 2, 14:00", hrs: "5.0", cause: "Pressure valve failure", woId: "wo6" },
  ],
};
function DowntimeLogTab({ asset, onOpenWO }) {
  const log = DOWNTIME_LOG[asset.id] || [];
  return (
    <div>
      {log.length === 0 && <div style={{ fontSize: 13, color: T.inkSoft }}>No downtime events recorded for this asset.</div>}
      {log.length > 0 && (
        <div>
          <div className="flex" style={{ fontSize: 11.5, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", padding: "0 4px 8px" }}>
            <div style={{ flex: 1 }}>Start</div><div style={{ flex: 1 }}>End</div><div style={{ flex: 1 }}>Duration</div><div style={{ flex: 2 }}>Cause</div><div style={{ width: 90 }}>WO</div>
          </div>
          {log.map((d, i) => (
            <div key={i} className="flex items-center" style={{ padding: "10px 4px", borderTop: "1px solid #F1F3F5", fontSize: 13 }}>
              <div style={{ flex: 1, color: T.ink }}>{d.start}</div>
              <div style={{ flex: 1, color: T.ink }}>{d.end}</div>
              <div className="f-mono" style={{ flex: 1, color: T.p1, fontWeight: 600 }}>{d.hrs} hrs</div>
              <div style={{ flex: 2, color: T.inkSoft }}>{d.cause}</div>
              <div style={{ width: 90 }}><button onClick={() => onOpenWO(d.woId)} style={{ background: "none", border: "none", color: T.p4, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>View WO →</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MeterReadingsTab({ asset, onLog }) {
  const [value, setValue] = useState("");
  return (
    <div>
      <div style={{ height: 180, marginBottom: 20 }}>
        {asset.meterHistory.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={asset.meterHistory}>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: T.inkSoft }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: T.inkSoft }} axisLine={false} tickLine={false} width={44} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke={T.amber} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div style={{ fontSize: 13, color: T.inkSoft }}>No meter history for this asset (non-metered equipment).</div>}
      </div>
      <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
        <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`New reading (${asset.meterUnit || "units"})`} style={{ ...inputStyle, width: 220 }} />
        <Btn size="sm" variant="amber" icon={Activity} onClick={() => { if (value) { onLog(Number(value)); setValue(""); } }}>Log Reading</Btn>
      </div>
      <div>
        {asset.meterHistory.slice().reverse().map((r, i) => (
          <div key={i} className="flex justify-between" style={{ padding: "7px 0", borderBottom: "1px solid #F1F3F5", fontSize: 13 }}>
            <span style={{ color: T.inkSoft }}>{r.date}</span>
            <span className="f-mono" style={{ color: T.ink, fontWeight: 600 }}>{r.value.toLocaleString()} {asset.meterUnit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssetDetail({ asset, assets, workOrders, schedules, onBack, onEdit, onUpdate, onOpenWO, onCreateWO, onAddPM, onNotify }) {
  const [tab, setTab] = useState("overview");
  const [showDecommission, setShowDecommission] = useState(false);
  const [reason, setReason] = useState("");
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "history", label: "Maintenance History" },
    { key: "pm", label: "PM Schedules" },
    { key: "documents", label: "Documents" },
    { key: "downtime", label: "Downtime Log" },
    { key: "meters", label: "Meter Readings" },
  ];

  function confirmDecommission() {
    onUpdate({ ...asset, status: "Decommissioned" });
    setShowDecommission(false);
    onNotify(`${asset.code} marked as decommissioned.`);
  }

  return (
    <div className="rise" style={{ maxWidth: 980 }}>
      <button onClick={onBack} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}>
        <ArrowLeft size={15} /> Back to Asset Register
      </button>

      <div className="flex items-center justify-between" style={{ marginBottom: 6, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="flex items-center gap-3">
            <span className="f-mono" style={{ fontSize: 13, color: T.inkSoft }}>{asset.code}</span>
            <CriticalityBadge c={asset.criticality} /><AssetStatusBadge s={asset.status} />
          </div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink, marginTop: 6 }}>{asset.name}</h1>
        </div>
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <Btn variant="ghost" icon={PencilLine} onClick={onEdit}>Edit</Btn>
          <Btn variant="ghost" icon={Wrench} onClick={() => onCreateWO(asset.id)}>Create Work Order</Btn>
          <Btn variant="ghost" icon={Printer} onClick={() => onNotify("QR label sent to printer.")}>Print QR</Btn>
          {asset.status !== "Decommissioned" && <Btn variant="danger" icon={PowerOff} onClick={() => setShowDecommission(true)}>Decommission</Btn>}
        </div>
      </div>

      <div className="flex gap-1" style={{ borderBottom: `1px solid ${T.border}`, marginBottom: 20, marginTop: 18, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 600,
            color: tab === t.key ? T.ink : T.inkSoft, borderBottom: tab === t.key ? `2.5px solid ${T.amber}` : "2.5px solid transparent",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 24 }}>
        {tab === "overview" && <OverviewTab asset={asset} workOrders={workOrders} />}
        {tab === "history" && <MaintenanceHistoryTab asset={asset} workOrders={workOrders} onOpenWO={onOpenWO} />}
        {tab === "pm" && <PMScheduleTab asset={asset} schedules={schedules} onAddPM={onAddPM} />}
        {tab === "documents" && <DocumentsTab asset={asset} onAdd={(doc) => onUpdate({ ...asset, documents: [...asset.documents, doc] })} />}
        {tab === "downtime" && <DowntimeLogTab asset={asset} onOpenWO={onOpenWO} />}
        {tab === "meters" && <MeterReadingsTab asset={asset} onLog={(v) => onUpdate({ ...asset, meterReading: v, meterHistory: [...asset.meterHistory, { date: `Log ${asset.meterHistory.length + 1}`, value: v }] })} />}
      </div>

      {showDecommission && (
        <Modal title={`Decommission ${asset.code}?`} onClose={() => setShowDecommission(false)}>
          <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 14 }}>This marks the asset as decommissioned and removes it from active PM scheduling. This action is logged in the audit trail.</p>
          <Field label="Reason" required>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why is this asset being decommissioned?" style={{ ...inputStyle, resize: "vertical" }} />
          </Field>
          <div className="flex gap-2" style={{ justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={() => setShowDecommission(false)}>Cancel</Btn>
            <Btn variant="danger" icon={PowerOff} disabled={!reason} onClick={confirmDecommission}>Confirm Decommission</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================
   PREVENTIVE MAINTENANCE MODULE
================================================================ */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function PMListRow({ s, asset, onEdit, onToggleActive, onGenerate }) {
  const overdue = daysBetween(s.nextDue) < 0;
  const team = TECHNICIANS.filter((t) => s.assignedTeam.includes(t.id));
  return (
    <div className="flex items-center" style={{ padding: "13px 18px", borderTop: "1px solid #F1F3F5", opacity: s.isActive ? 1 : 0.55 }}>
      <div style={{ flex: 2, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{s.title}</div>
        <div style={{ fontSize: 12, color: T.inkSoft }}>{asset?.name || "Unknown asset"}</div>
      </div>
      <div style={{ flex: 1.3, fontSize: 12.5, color: T.inkSoft }}>
        <span className="flex items-center gap-1"><Repeat size={12} /> {s.trigger} · {s.frequencyValue} {s.frequencyUnit.toLowerCase()}</span>
      </div>
      <div style={{ flex: 1, fontSize: 12.5, color: T.inkSoft }}>{s.lastCompletedAt}</div>
      <div className="f-mono" style={{ flex: 1, fontSize: 12.5, color: overdue ? T.p1 : T.ink, fontWeight: overdue ? 700 : 500 }}>{s.nextDue}{overdue && " · overdue"}</div>
      <div style={{ flex: 1.1 }}>
        <div className="flex" style={{ marginLeft: -4 }}>
          {team.map((t) => <div key={t.id} title={t.name} style={{ width: 22, height: 22, borderRadius: 11, background: T.steel, color: "#fff", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", marginLeft: 4, border: "1.5px solid #fff" }}>{t.name.split(" ").map((n) => n[0]).join("")}</div>)}
          {team.length === 0 && <span style={{ fontSize: 12, color: T.inkSoft }}>Unassigned</span>}
        </div>
      </div>
      <div className="flex items-center gap-1" style={{ width: 150, justifyContent: "flex-end" }}>
        <Btn size="sm" variant="ghost" onClick={() => onGenerate(s)}>Generate Now</Btn>
        <button onClick={() => onEdit(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.inkSoft, padding: 4 }}><PencilLine size={14} /></button>
        <button onClick={() => onToggleActive(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: s.isActive ? T.good : T.inkSoft, padding: 4 }}>
          {s.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
        </button>
      </div>
    </div>
  );
}

function PMCalendar({ schedules, assets, onGenerate }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date(TODAY.getFullYear(), TODAY.getMonth() + monthOffset, 1);
  const year = base.getFullYear(), month = base.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function pmsOnDay(d) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return schedules.filter((s) => s.isActive && s.nextDue === dateStr);
  }
  const [selectedDay, setSelectedDay] = useState(null);
  const selectedPMs = selectedDay ? pmsOnDay(selectedDay) : [];

  return (
    <div className="flex gap-5" style={{ flexWrap: "wrap" }}>
      <div style={{ flex: 2, minWidth: 380, background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 18 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div className="flex items-center gap-2">
            <button onClick={() => setMonthOffset((m) => m - 1)} style={{ background: "none", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 6, cursor: "pointer", padding: 4 }}><ChevronLeft size={15} /></button>
            <span style={{ fontWeight: 700, fontSize: 15, color: T.ink }}>{MONTH_NAMES[month]} {year}</span>
            <button onClick={() => setMonthOffset((m) => m + 1)} style={{ background: "none", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 6, cursor: "pointer", padding: 4 }}><ChevronRight size={15} /></button>
          </div>
          {monthOffset !== 0 && <button onClick={() => setMonthOffset(0)} style={{ background: "none", border: "none", color: T.p4, fontSize: 12.5, cursor: "pointer" }}>Today</button>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} style={{ fontSize: 11, fontWeight: 700, color: T.inkSoft, textAlign: "center" }}>{d}</div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const pms = pmsOnDay(d);
            const isToday = monthOffset === 0 && d === TODAY.getDate();
            return (
              <button key={i} onClick={() => setSelectedDay(d)} style={{
                minHeight: 58, borderRadius: 12, border: isToday ? `1.5px solid ${T.amber}` : `1px solid ${T.border}`,
                background: selectedDay === d ? "#FEF6E9" : "#fff", padding: 6, cursor: "pointer", textAlign: "left",
              }}>
                <div style={{ fontSize: 11.5, color: isToday ? T.amber : T.inkSoft, fontWeight: isToday ? 700 : 500 }}>{d}</div>
                {pms.slice(0, 2).map((p) => (
                  <div key={p.id} style={{ fontSize: 9.5, background: daysBetween(p.nextDue) < 0 ? "#FCE9E9" : "#EAF1F7", color: daysBetween(p.nextDue) < 0 ? T.p1 : T.p4, borderRadius: 3, padding: "1px 4px", marginTop: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p.title}</div>
                ))}
                {pms.length > 2 && <div style={{ fontSize: 9, color: T.inkSoft, marginTop: 2 }}>+{pms.length - 2} more</div>}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 260, background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 12 }}>
          {selectedDay ? `${MONTH_NAMES[month]} ${selectedDay}` : "Select a day"}
        </div>
        {!selectedDay && <div style={{ fontSize: 13, color: T.inkSoft }}>Click a date to see PMs due that day.</div>}
        {selectedDay && selectedPMs.length === 0 && <div style={{ fontSize: 13, color: T.inkSoft }}>No PM due on this day.</div>}
        {selectedPMs.map((p) => {
          const asset = assets.find((a) => a.id === p.assetId);
          return (
            <div key={p.id} style={{ background: T.fog, borderRadius: 12, padding: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{p.title}</div>
              <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 8 }}>{asset?.name}</div>
              <Btn size="sm" variant="amber" icon={ClipboardCheck} onClick={() => onGenerate(p)}>Generate WO Now</Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PMSchedulesModule({ schedules, assets, templates, onOpenCreate, onOpenEdit, onToggleActive, onGenerate, onManageTemplates }) {
  const [view, setView] = useState("list");
  const [q, setQ] = useState("");
  const filtered = schedules.filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase()) || (assets.find((a) => a.id === s.assetId)?.name || "").toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="rise">
      <div className="flex items-center justify-between" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink }}>PM Schedules</h1>
          <p style={{ fontSize: 13, color: T.inkSoft }}>{schedules.filter((s) => s.isActive).length} active · {schedules.filter((s) => daysBetween(s.nextDue) < 0 && s.isActive).length} overdue</p>
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="ghost" icon={ListChecks} onClick={onManageTemplates}>Checklist Templates</Btn>
          <Btn variant="amber" icon={Plus} onClick={onOpenCreate}>Create PM Schedule</Btn>
        </div>
      </div>

      <div className="flex items-center gap-3" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <div className="flex items-center gap-2" style={{ background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: "7px 12px", width: 260 }}>
          <Search size={14} color={T.inkSoft} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PM title or asset…" style={{ border: "none", outline: "none", fontSize: 13, width: "100%" }} />
        </div>
        <div style={{ marginLeft: "auto" }} className="flex items-center gap-1">
          <button onClick={() => setView("list")} style={{ padding: "7px 10px", borderRadius: 7, border: `1.5px solid ${view === "list" ? T.ink : T.border}`, background: view === "list" ? T.ink : "#fff", color: view === "list" ? "#fff" : T.ink, cursor: "pointer" }}><List size={14} /></button>
          <button onClick={() => setView("calendar")} style={{ padding: "7px 10px", borderRadius: 7, border: `1.5px solid ${view === "calendar" ? T.ink : T.border}`, background: view === "calendar" ? T.ink : "#fff", color: view === "calendar" ? "#fff" : T.ink, cursor: "pointer" }}><CalendarDays size={14} /></button>
        </div>
      </div>

      {view === "list" ? (
        <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden" }}>
          <div className="flex items-center" style={{ padding: "10px 18px", background: T.fog, fontSize: 11.5, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", letterSpacing: "0.03em" }}>
            <div style={{ flex: 2 }}>PM Schedule</div><div style={{ flex: 1.3 }}>Trigger</div><div style={{ flex: 1 }}>Last Done</div><div style={{ flex: 1 }}>Next Due</div><div style={{ flex: 1.1 }}>Team</div><div style={{ width: 150 }}></div>
          </div>
          {filtered.map((s) => <PMListRow key={s.id} s={s} asset={assets.find((a) => a.id === s.assetId)} onEdit={onOpenEdit} onToggleActive={onToggleActive} onGenerate={onGenerate} />)}
          {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: T.inkSoft, fontSize: 13 }}>No PM schedules match this search.</div>}
        </div>
      ) : (
        <PMCalendar schedules={filtered} assets={assets} onGenerate={onGenerate} />
      )}
    </div>
  );
}

const FREQ_UNITS = { Time: ["Days", "Weeks", "Months"], Meter: ["Hours", "Cycles"], Condition: ["Days", "Weeks"] };

function PMForm({ existing, assets, templates, onCancel, onSave, onNewTemplate, prefillAssetId }) {
  const [title, setTitle] = useState(existing?.title || "");
  const [assetId, setAssetId] = useState(existing?.assetId || prefillAssetId || "");
  const [trigger, setTrigger] = useState(existing?.trigger || "Time");
  const [freqValue, setFreqValue] = useState(existing?.frequencyValue || "");
  const [freqUnit, setFreqUnit] = useState(existing?.frequencyUnit || "Days");
  const [templateId, setTemplateId] = useState(existing?.checklistTemplateId || "");
  const [team, setTeam] = useState(existing?.assignedTeam || []);
  const [startDate, setStartDate] = useState(existing?.startDate || "2026-07-22");
  const [active, setActive] = useState(existing?.isActive ?? true);
  const [errors, setErrors] = useState({});

  function toggleTeam(id) { setTeam((t) => t.includes(id) ? t.filter((x) => x !== id) : [...t, id]); }

  function handleSubmit(another) {
    const errs = {};
    if (!title) errs.title = "Give the schedule a name.";
    if (!assetId) errs.asset = "Select an asset.";
    if (!freqValue) errs.freq = "Set a frequency.";
    if (!templateId) errs.template = "Select a checklist template.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const next = new Date(startDate);
    const unitDays = { Days: 1, Weeks: 7, Months: 30, Hours: 0, Cycles: 0 }[freqUnit] || 0;
    if (trigger !== "Meter") next.setDate(next.getDate() + Number(freqValue) * unitDays);
    onSave({
      id: existing?.id || "pm" + Math.random().toString(36).slice(2, 7),
      title, assetId, trigger, frequencyValue: Number(freqValue), frequencyUnit: freqUnit,
      checklistTemplateId: templateId, assignedTeam: team, startDate,
      isActive: active, lastCompletedAt: existing?.lastCompletedAt || startDate,
      nextDue: trigger === "Meter" ? (existing?.nextDue || startDate) : next.toISOString().slice(0, 10),
    }, another);
    if (another) { setTitle(""); setFreqValue(""); }
  }

  return (
    <div className="rise" style={{ maxWidth: 780 }}>
      <button onClick={onCancel} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}><ArrowLeft size={15} /> Back to PM Schedules</button>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink, marginBottom: 4 }}>{existing ? "Edit PM Schedule" : "Create PM Schedule"}</h1>
      <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 24 }}>Define when this preventive task should recur and which checklist technicians must complete.</p>

      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 22 }}>
        <Field label="Schedule title" required hint={errors.title}><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Quarterly Spindle Service" style={{ ...inputStyle, borderColor: errors.title ? T.p1 : "#D8DEE4" }} /></Field>
        <Field label="Asset" required hint={errors.asset}>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ ...inputStyle, borderColor: errors.asset ? T.p1 : "#D8DEE4" }}>
            <option value="">Select asset…</option>{assets.filter((a) => a.category !== "Production Line").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>

        <Field label="Trigger type" required>
          <div className="flex gap-2">
            {["Time", "Meter", "Condition"].map((t) => (
              <button key={t} onClick={() => { setTrigger(t); setFreqUnit(FREQ_UNITS[t][0]); }} style={{ padding: "8px 16px", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 500, border: `1.5px solid ${trigger === t ? T.ink : "#D8DEE4"}`, background: trigger === t ? T.ink : "#fff", color: trigger === t ? "#fff" : T.ink }}>{t}</button>
            ))}
          </div>
        </Field>

        <Field label="Frequency" required hint={errors.freq}>
          <div className="flex gap-2">
            <input type="number" min="1" value={freqValue} onChange={(e) => setFreqValue(e.target.value)} placeholder="e.g. 90" style={{ ...inputStyle, flex: 1, borderColor: errors.freq ? T.p1 : "#D8DEE4" }} />
            <select value={freqUnit} onChange={(e) => setFreqUnit(e.target.value)} style={{ ...inputStyle, width: 150 }}>{FREQ_UNITS[trigger].map((u) => <option key={u}>{u}</option>)}</select>
          </div>
        </Field>

        <Field label="Checklist template" required hint={errors.template}>
          <div className="flex gap-2">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ ...inputStyle, borderColor: errors.template ? T.p1 : "#D8DEE4" }}>
              <option value="">Select template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>)}
            </select>
            <Btn variant="ghost" onClick={onNewTemplate}>+ New</Btn>
          </div>
        </Field>

        <Field label="Assigned team">
          <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
            {TECHNICIANS.map((t) => (
              <button key={t.id} onClick={() => toggleTeam(t.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, fontSize: 12.5, cursor: "pointer", border: `1.5px solid ${team.includes(t.id) ? T.amber : T.border}`, background: team.includes(t.id) ? "#FEF6E9" : "#fff", color: T.ink }}>
                <div style={{ width: 18, height: 18, borderRadius: 9, background: T.steel, color: "#fff", fontSize: 8.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{t.name.split(" ").map((n) => n[0]).join("")}</div>
                {t.name}
              </button>
            ))}
          </div>
        </Field>

        <div className="flex gap-4">
          <div style={{ flex: 1 }}><Field label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} /></Field></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, marginBottom: 6 }}>Active</div>
            <button onClick={() => setActive((a) => !a)} className="flex items-center gap-2" style={{ background: "none", border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer", width: "100%" }}>
              {active ? <ToggleRight size={20} color={T.good} /> : <ToggleLeft size={20} color={T.inkSoft} />}
              <span style={{ fontSize: 13, color: T.ink }}>{active ? "Schedule is active" : "Schedule is paused"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-2" style={{ marginTop: 16 }}>
        <Btn variant="amber" icon={CheckCircle2} onClick={() => handleSubmit(false)}>Save</Btn>
        {!existing && <Btn variant="subtle" onClick={() => handleSubmit(true)}>Save & Create Another</Btn>}
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

/* ---- Checklist Template Builder --------------------------------- */
function ChecklistTemplateList({ templates, onCreate, onEdit, onBack }) {
  return (
    <div className="rise">
      <button onClick={onBack} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}><ArrowLeft size={15} /> Back to PM Schedules</button>
      <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
        <div><h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink }}>Checklist Templates</h1><p style={{ fontSize: 13, color: T.inkSoft }}>Reusable checklists for PM, inspection, and safety work orders.</p></div>
        <Btn variant="amber" icon={Plus} onClick={onCreate}>New Template</Btn>
      </div>
      <div className="flex gap-4" style={{ flexWrap: "wrap" }}>
        {templates.map((t) => (
          <div key={t.id} onClick={() => onEdit(t.id)} style={{ width: 260, background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: 18, cursor: "pointer" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
              <span style={{ background: T.fog, color: T.inkSoft, fontSize: 11, borderRadius: 5, padding: "2px 7px" }}>{t.category}</span>
              <span className="f-mono" style={{ fontSize: 11, color: T.inkSoft }}>v{t.version}</span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: T.ink, marginBottom: 4 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 10 }}>{t.plant}</div>
            <div style={{ fontSize: 12, color: T.inkSoft }}>{t.items.length} checklist items</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const INPUT_TYPES = ["Boolean", "Number", "Text", "Photo"];
function ChecklistTemplateBuilder({ existing, onCancel, onSave }) {
  const [name, setName] = useState(existing?.name || "");
  const [category, setCategory] = useState(existing?.category || "PM");
  const [plant, setPlant] = useState(existing?.plant || "Global");
  const [items, setItems] = useState(existing?.items || [{ id: "i" + Date.now(), label: "", inputType: "Boolean", required: true, help: "" }]);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");

  function updateItem(id, patch) { setItems((list) => list.map((it) => it.id === id ? { ...it, ...patch } : it)); }
  function addItem() { setItems((list) => [...list, { id: "i" + Date.now() + Math.random(), label: "", inputType: "Boolean", required: false, help: "" }]); }
  function removeItem(id) { setItems((list) => list.filter((it) => it.id !== id)); }
  function moveItem(id, dir) {
    setItems((list) => {
      const idx = list.findIndex((it) => it.id === id);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= list.length) return list;
      const copy = [...list];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  }

  function handleSave() {
    if (!name) { setError("Give the template a name."); return; }
    if (items.length === 0 || items.some((i) => !i.label)) { setError("Every checklist item needs a label."); return; }
    setError("");
    onSave({ id: existing?.id || "tpl" + Math.random().toString(36).slice(2, 7), name, category, plant, items, version: existing ? existing.version + 1 : 1 });
  }

  return (
    <div className="rise" style={{ maxWidth: 860 }}>
      <button onClick={onCancel} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}><ArrowLeft size={15} /> Back to Templates</button>
      <div className="flex items-center justify-between" style={{ marginBottom: 4, flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink }}>{existing ? "Edit Checklist Template" : "New Checklist Template"}</h1>
        <Btn variant="ghost" icon={Eye} onClick={() => setPreview((p) => !p)}>{preview ? "Hide Preview" : "Preview"}</Btn>
      </div>
      <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 20 }}>Build the checklist technicians complete on-site. Reorder with the arrows — order matters on the mobile app.</p>

      <div className="flex gap-6" style={{ flexWrap: "wrap" }}>
        <div style={{ flex: 2, minWidth: 380 }}>
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 22, marginBottom: 16 }}>
            <div className="flex gap-4">
              <div style={{ flex: 2 }}><Field label="Template name" required><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CNC Quarterly Service" style={inputStyle} /></Field></div>
              <div style={{ flex: 1 }}><Field label="Category"><select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}><option>PM</option><option>Safety</option><option>Inspection</option></select></Field></div>
            </div>
            <Field label="Applicable plant"><select value={plant} onChange={(e) => setPlant(e.target.value)} style={inputStyle}><option>Global</option><option>Plant 01 — Chennai</option></select></Field>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((it, i) => (
              <div key={it.id} style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 14 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
                  <div className="flex" style={{ flexDirection: "column" }}>
                    <button onClick={() => moveItem(it.id, -1)} disabled={i === 0} style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#D8DEE4" : T.inkSoft, padding: 0, lineHeight: 0.7 }}>▲</button>
                    <button onClick={() => moveItem(it.id, 1)} disabled={i === items.length - 1} style={{ background: "none", border: "none", cursor: i === items.length - 1 ? "default" : "pointer", color: i === items.length - 1 ? "#D8DEE4" : T.inkSoft, padding: 0, lineHeight: 0.7 }}>▼</button>
                  </div>
                  <span className="f-mono" style={{ fontSize: 11, color: T.inkSoft, width: 18 }}>{i + 1}</span>
                  <input value={it.label} onChange={(e) => updateItem(it.id, { label: e.target.value })} placeholder="Checklist item label…" style={{ ...inputStyle, flex: 1 }} />
                  <select value={it.inputType} onChange={(e) => updateItem(it.id, { inputType: e.target.value })} style={{ ...inputStyle, width: 120 }}>{INPUT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                  <button onClick={() => removeItem(it.id)} style={{ background: "none", border: "none", cursor: "pointer", color: T.p1, padding: 6 }}><X size={15} /></button>
                </div>
                <div className="flex items-center gap-4" style={{ paddingLeft: 46 }}>
                  <label className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: T.inkSoft, cursor: "pointer" }}><input type="checkbox" checked={it.required} onChange={(e) => updateItem(it.id, { required: e.target.checked })} style={{ accentColor: T.amber }} /> Required</label>
                  <input value={it.help} onChange={(e) => updateItem(it.id, { help: e.target.value })} placeholder="Help text (optional)" style={{ ...inputStyle, flex: 1, padding: "6px 10px", fontSize: 12.5 }} />
                </div>
              </div>
            ))}
          </div>
          <Btn variant="ghost" icon={Plus} onClick={addItem} style={{ marginTop: 12 }}>Add Item</Btn>
          {error && <div style={{ color: T.p1, fontSize: 12.5, marginTop: 10 }}>{error}</div>}
          <div className="flex gap-2" style={{ marginTop: 16 }}>
            <Btn variant="amber" icon={CheckCircle2} onClick={handleSave}>Save Template</Btn>
            <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          </div>
        </div>

        {preview && (
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="rise" style={{ background: T.graphite, borderRadius: 16, padding: 16, position: "sticky", top: 24 }}>
              <div style={{ fontSize: 11.5, color: "#B9C9E8", marginBottom: 10, textAlign: "center" }}>MOBILE PREVIEW</div>
              <div style={{ background: "#fff", borderRadius: 12, padding: 16, maxHeight: 480, overflowY: "auto" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 4 }}>{name || "Untitled checklist"}</div>
                <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 14 }}>{items.length} items</div>
                {items.map((it, i) => (
                  <div key={it.id} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 500, marginBottom: 6 }}>{i + 1}. {it.label || "(untitled item)"} {it.required && <span style={{ color: T.p1 }}>*</span>}</div>
                    {it.inputType === "Boolean" && <div className="flex gap-2"><div style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 6, background: T.fog, fontSize: 12 }}>Pass</div><div style={{ flex: 1, textAlign: "center", padding: "6px 0", borderRadius: 6, background: T.fog, fontSize: 12 }}>Fail</div></div>}
                    {it.inputType === "Number" && <input disabled placeholder="0.00" style={{ ...inputStyle, background: T.fog }} />}
                    {it.inputType === "Text" && <textarea disabled rows={2} placeholder="Technician notes…" style={{ ...inputStyle, background: T.fog, resize: "none" }} />}
                    {it.inputType === "Photo" && <div style={{ border: `1.5px dashed #D8DEE4`, borderRadius: 12, padding: 14, textAlign: "center", color: T.inkSoft, fontSize: 12 }}><ImageIcon size={16} style={{ margin: "0 auto 4px" }} /> Capture photo</div>}
                    {it.help && <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>{it.help}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


/* ================================================================
   WORK ORDER MODULE (unchanged from previous build, prefill added)
================================================================ */
function AssignmentPanel({ wo, onAssign }) {
  const bestMatch = TECHNICIANS.filter((t) => t.skills.some((s) => wo.department.toLowerCase().includes(s.toLowerCase()) || wo.machine.name.toLowerCase().includes(s.toLowerCase())));
  return (
    <div>
      <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 14 }}>
        Currently assigned: {wo.assignedTo.length ? <strong style={{ color: T.ink }}>{wo.assignedTo.map((t) => t.name).join(", ")}</strong> : "Unassigned"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TECHNICIANS.map((t) => {
          const isAssigned = wo.assignedTo.some((a) => a.id === t.id);
          const isBest = bestMatch.some((b) => b.id === t.id);
          return (
            <div key={t.id} className="flex items-center justify-between" style={{ padding: "10px 14px", borderRadius: 12, border: `1.5px solid ${isAssigned ? T.amber : T.border}`, background: isAssigned ? "#FEF6E9" : "#fff" }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 30, height: 30, borderRadius: 15, background: T.steel, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                  {t.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{t.name} {isBest && <span style={{ background: "#E7F5EE", color: T.good, fontSize: 10.5, borderRadius: 4, padding: "1px 6px", marginLeft: 6, fontWeight: 700 }}>Best match</span>}</div>
                  <div style={{ fontSize: 11.5, color: T.inkSoft }}>{t.skills.join(" · ")} — {t.load} open jobs</div>
                </div>
              </div>
              <Btn size="sm" variant={isAssigned ? "success" : "ghost"} icon={isAssigned ? CheckCircle2 : UserCheck} onClick={() => onAssign(t)}>{isAssigned ? "Assigned" : "Assign"}</Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}
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
function StatusTimeline({ wo }) {
  const flowIndex = STATUS_FLOW.indexOf(wo.status);
  return (
    <div>
      {STATUS_FLOW.map((s, i) => {
        const event = wo.history.find((h) => h.status === s);
        const done = i <= flowIndex && wo.status !== "Rejected";
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
          <PauseCircle size={15} /> {wo.history[wo.history.length - 1].remarks || "On hold"}
        </div>
      )}
    </div>
  );
}
function ApprovalPanel({ wo, onAction }) {
  const actions = {
    "New": [["Acknowledge", "success", CheckCircle2, "Assigned"]],
    "Triaged": [["Acknowledge", "success", CheckCircle2, "Assigned"]],
    "Assigned": [["Start Job", "amber", PlayCircle, "In Progress"]],
    "Scheduled": [["Start Job", "amber", PlayCircle, "In Progress"]],
    "In Progress": [["Put On Hold", "ghost", PauseCircle, "On Hold"], ["Mark Complete", "success", CheckCircle2, "Completed"]],
    "On Hold": [["Resume", "amber", PlayCircle, "In Progress"]],
    "Completed": [["Submit for Review", "primary", Send, "Pending Review"]],
    "Pending Review": [["Reopen (rework)", "danger", RotateCcw, "Assigned"], ["Approve & Close", "success", ThumbsUp, "Approved & Closed"]],
    "Approved & Closed": [], "Rejected": [],
  };
  const opts = actions[wo.status] || [];
  return (
    <div>
      <div style={{ background: T.fog, borderRadius: 12, padding: "12px 16px", marginBottom: 18, fontSize: 12.5, color: T.inkSoft }}>
        {wo.status === "Pending Review" ? "This work order is complete and awaiting supervisor sign-off. P1 closures additionally require manager approval." : wo.status === "Approved & Closed" ? "This work order is closed. Cost and asset history have been finalized." : "Move this work order through its lifecycle. Every transition is recorded in the status timeline."}
      </div>
      <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
        {opts.map(([label, variant, Icon, next]) => <Btn key={label} variant={variant} icon={Icon} onClick={() => onAction(next, label)}>{label}</Btn>)}
        {wo.status === "New" && <Btn variant="danger" icon={Ban} onClick={() => onAction("Rejected", "Reject")}>Reject</Btn>}
        {opts.length === 0 && <span style={{ fontSize: 13, color: T.inkSoft }}>No further action required.</span>}
      </div>
    </div>
  );
}
function WorkOrderDetail({ wo, onBack, onUpdate }) {
  const [tab, setTab] = useState("overview");
  const tabs = [{ key: "overview", label: "Overview" }, { key: "assignment", label: "Technician Assignment" }, { key: "attachments", label: "Attachments" }, { key: "timeline", label: "Status Timeline" }, { key: "approval", label: "Approval" }];
  const elapsed = Date.now() - wo.createdAt;
  const remain = SLA_MATRIX[wo.priority].resolutionMs - elapsed;
  const breached = remain < 0 && !["Approved & Closed", "Rejected"].includes(wo.status);
  function pushHistory(status, remarks, actor = "Priya Nair") { onUpdate({ ...wo, status, history: [...wo.history, { status, actor, t: Date.now(), remarks }] }); }
  function handleAssign(t) {
    const already = wo.assignedTo.some((a) => a.id === t.id);
    const assignedTo = already ? wo.assignedTo.filter((a) => a.id !== t.id) : [...wo.assignedTo, t];
    const status = wo.status === "New" || wo.status === "Triaged" ? "Assigned" : wo.status;
    onUpdate({ ...wo, assignedTo, status, history: already ? wo.history : [...wo.history, { status, actor: "Priya Nair", t: Date.now(), remarks: `Assigned to ${t.name}` }] });
  }
  function handlePhoto(e) { const files = Array.from(e.target.files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f) })); onUpdate({ ...wo, photos: [...wo.photos, ...files] }); }
  function handleVideo(e) { const files = Array.from(e.target.files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f) })); onUpdate({ ...wo, videos: [...wo.videos, ...files] }); }

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
            <div className="f-mono" style={{ fontSize: 13, fontWeight: 700, color: breached ? T.p1 : T.ink }}>{["Approved & Closed", "Rejected"].includes(wo.status) ? "Closed" : breached ? "Breached" : fmtDue(remain) + " left"}</div>
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
              {[["Machine", wo.machine.name], ["Department", wo.department], ["Type", wo.type], ["Production impact", IMPACT_OPTIONS.find((i) => i.value === wo.impact)?.label || "—"], ["Estimated downtime", `${wo.estDowntime.value} ${wo.estDowntime.unit}`], ["Requested by", wo.requestedBy], ["Requester phone", wo.requesterPhone || "—"], ["Safety risk", wo.safetyRisk?.flag ? `Yes (${wo.safetyRisk.severity})` : "No"], ["Environmental risk", wo.environmentalRisk?.flag ? "Yes" : "No"], ["Permit / LOTO required", wo.permit ? "Yes" : "No"]].map(([label, val]) => (
                <div key={label} className="flex justify-between" style={{ padding: "9px 0", borderBottom: "1px solid #F1F3F5", fontSize: 13.5 }}><span style={{ color: T.inkSoft }}>{label}</span><span style={{ color: T.ink, fontWeight: 500, textAlign: "right" }}>{val}</span></div>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, marginBottom: 8 }}>Description</div>
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
        {tab === "assignment" && <AssignmentPanel wo={wo} onAssign={handleAssign} />}
        {tab === "attachments" && <AttachmentsPanel wo={wo} onAddPhoto={handlePhoto} onAddVideo={handleVideo} />}
        {tab === "timeline" && <StatusTimeline wo={wo} />}
        {tab === "approval" && <ApprovalPanel wo={wo} onAction={(next, label) => pushHistory(next, label + " action taken")} />}
      </div>
    </div>
  );
}
function WorkOrderList({ workOrders, onOpen, onCreate, initialPriority }) {
  const [fPriority, setFPriority] = useState(initialPriority || "All"); const [fStatus, setFStatus] = useState("All"); const [q, setQ] = useState("");
  const filtered = workOrders.filter((w) => {
    if (fPriority !== "All" && w.priority !== fPriority) return false;
    if (fStatus !== "All" && w.status !== fStatus) return false;
    if (q && !(w.machine.name.toLowerCase().includes(q.toLowerCase()) || w.woNumber.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });
  return (
    <div className="rise">
      <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
        <div><h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink }}>Work Orders</h1><p style={{ fontSize: 13, color: T.inkSoft }}>{filtered.length} of {workOrders.length} work orders</p></div>
        <Btn variant="amber" icon={Plus} onClick={onCreate}>Raise Work Order</Btn>
      </div>
      <div className="flex items-center gap-3" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <div className="flex items-center gap-2" style={{ background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: "7px 12px", width: 260 }}>
          <Search size={14} color={T.inkSoft} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search WO# or machine…" style={{ border: "none", outline: "none", fontSize: 13, width: "100%" }} />
        </div>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} style={{ ...inputStyle, width: 150, padding: "8px 10px" }}><option>All</option><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ ...inputStyle, width: 190, padding: "8px 10px" }}><option>All</option>{STATUS_FLOW.concat(["On Hold", "Rejected"]).map((s) => <option key={s}>{s}</option>)}</select>
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
              <div className="f-mono" style={{ width: 100, textAlign: "right", fontSize: 11.5, color: remain < 0 ? T.p1 : T.inkSoft, fontWeight: remain < 0 ? 700 : 400 }}>{["Approved & Closed", "Rejected"].includes(w.status) ? "—" : remain < 0 ? "Breached" : fmtDue(remain) + " left"}</div>
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: T.inkSoft, fontSize: 13 }}>No work orders match these filters.</div>}
      </div>
    </div>
  );
}

const RANK = { P1: 1, P2: 2, P3: 3, P4: 4 };
function computeSuggestion(impact, safety, env) {
  let level = impact ? RANK[suggestPriority(impact)] : null;
  if (safety.flag) { const esc = safety.severity === "High" ? 1 : 2; level = level ? Math.min(level, esc) : esc; }
  if (env.flag) { level = level ? Math.min(level, 2) : 2; }
  return level ? "P" + level : null;
}

function RaiseWorkOrder({ onCancel, onCreated, prefillMachineId }) {
  const [department, setDepartment] = useState(() => { const m = MACHINES.find((x) => x.id === prefillMachineId); return m ? m.dept : ""; });
  const [machineId, setMachineId] = useState(prefillMachineId || "");
  const [type, setType] = useState("Breakdown");
  const [complaint, setComplaint] = useState("");
  const [priority, setPriority] = useState(""); const [priorityTouched, setPriorityTouched] = useState(false);
  const [impact, setImpact] = useState("");
  const [photos, setPhotos] = useState([]); const [videos, setVideos] = useState([]);
  const [downtimeValue, setDowntimeValue] = useState(""); const [downtimeUnit, setDowntimeUnit] = useState("Hours");
  const [safetyFlag, setSafetyFlag] = useState(false); const [safetySeverity, setSafetySeverity] = useState("Medium");
  const [envFlag, setEnvFlag] = useState(false);
  const [requester, setRequester] = useState("Priya Nair");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState({});
  const photoInput = useRef(null); const videoInput = useRef(null);

  const machine = MACHINES.find((m) => m.id === machineId);
  const safety = { flag: safetyFlag, severity: safetySeverity };
  const env = { flag: envFlag };
  const suggestion = computeSuggestion(impact, safety, env);
  const effectivePriority = priorityTouched ? priority : suggestion;

  function handleMachineChange(id) { setMachineId(id); const m = MACHINES.find((x) => x.id === id); if (m && !department) setDepartment(m.dept); }
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
      safetyRisk: safety, environmentalRisk: env, permit: safetyFlag,
      requestedBy: requester, requesterPhone: phone, assignedTo: [], photos, videos, createdAt: now,
      history: [{ status: "New", actor: requester, t: now, remarks: "Raised via Work Order form" }],
    });
  }

  return (
    <div className="rise" style={{ maxWidth: 900 }}>
      <button onClick={onCancel} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}><ArrowLeft size={15} /> Back to Work Orders</button>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Raise Work Order</h1>
      <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 24 }}>Report a breakdown or request maintenance work. Priority is suggested automatically and escalates for safety or environmental risk.</p>

      <div className="flex gap-6" style={{ flexWrap: "wrap" }}>
        <div style={{ flex: 2, minWidth: 380 }}>
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 22 }}>

            {/* Department */}
            <Field label="Department" required hint={errors.department}>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ ...inputStyle, borderColor: errors.department ? T.p1 : "#D8DEE4" }}>
                <option value="">Select department…</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </Field>

            {/* Equipment */}
            <Field label="Equipment" required hint={errors.machine}>
              <select value={machineId} onChange={(e) => handleMachineChange(e.target.value)} style={{ ...inputStyle, borderColor: errors.machine ? T.p1 : "#D8DEE4" }}>
                <option value="">Select equipment…</option>{MACHINES.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
              </select>
            </Field>
            {machine && <div className="flex items-center gap-2" style={{ background: T.fog, borderRadius: 12, padding: "8px 12px", marginBottom: 16, fontSize: 12.5, color: T.inkSoft }}><Factory size={14} /> Criticality: <strong style={{ color: T.ink }}>{machine.criticality}</strong><span style={{ margin: "0 4px" }}>·</span> Asset ID: <span className="f-mono">{machine.id}</span></div>}

            <Field label="Work order type"><div className="flex gap-2">{["Breakdown", "Inspection", "Project"].map((t) => <button key={t} onClick={() => setType(t)} style={{ padding: "8px 14px", borderRadius: 12, fontSize: 13, cursor: "pointer", border: `1.5px solid ${type === t ? T.ink : "#D8DEE4"}`, background: type === t ? T.ink : "#fff", color: type === t ? "#fff" : T.ink, fontWeight: 500 }}>{t}</button>)}</div></Field>

            {/* Complaint */}
            <Field label="Complaint" required hint={errors.complaint}>
              <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={4} placeholder="What happened? Include symptoms, sounds, error codes…" style={{ ...inputStyle, resize: "vertical", borderColor: errors.complaint ? T.p1 : "#D8DEE4" }} />
            </Field>

            {/* Priority */}
            <Field label="Priority" required>
              <div className="flex gap-2">
                {["P1", "P2", "P3", "P4"].map((p) => (
                  <button key={p} onClick={() => { setPriority(p); setPriorityTouched(true); }} style={{ flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 700, border: `1.5px solid ${effectivePriority === p ? PRIORITY_COLORS[p] : "#D8DEE4"}`, background: effectivePriority === p ? `${PRIORITY_COLORS[p]}1A` : "#fff", color: effectivePriority === p ? PRIORITY_COLORS[p] : T.inkSoft }}>{p}</button>
                ))}
              </div>
            </Field>

            {/* Auto Priority Suggestion */}
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
              ) : (
                <span style={{ fontSize: 12.5, color: T.inkSoft }}>Select production impact below (and any risk flags) to see a suggestion.</span>
              )}
            </div>

            {/* Production Impact */}
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

            {/* Upload Photo / Video */}
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

            {/* Estimated Downtime */}
            <Field label="Estimated downtime" required hint={errors.downtime}>
              <div className="flex gap-2"><input type="number" min="0" value={downtimeValue} onChange={(e) => setDowntimeValue(e.target.value)} placeholder="e.g. 4" style={{ ...inputStyle, flex: 1, borderColor: errors.downtime ? T.p1 : "#D8DEE4" }} /><select value={downtimeUnit} onChange={(e) => setDowntimeUnit(e.target.value)} style={{ ...inputStyle, width: 130 }}><option>Hours</option><option>Days</option></select></div>
            </Field>

            {/* Safety Risk */}
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

            {/* Environmental Risk */}
            <Field label="Environmental risk">
              <div className="flex items-center gap-3">
                {["No", "Yes"].map((v) => (
                  <button key={v} onClick={() => setEnvFlag(v === "Yes")} style={{ padding: "8px 20px", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 600, border: `1.5px solid ${(v === "Yes") === envFlag ? T.amber : "#D8DEE4"}`, background: (v === "Yes") === envFlag ? "#FDE7C4" : "#fff", color: (v === "Yes") === envFlag ? "#8A5A0A" : T.inkSoft }}>{v}</button>
                ))}
              </div>
              {envFlag && <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 8 }}>e.g. chemical spill, emission, or leak risk — Environment, Health & Safety will be notified.</div>}
            </Field>

            {/* Requester + Phone Number */}
            <div className="flex gap-4">
              <div style={{ flex: 1 }}><Field label="Requester" required hint={errors.requester}><input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Full name" style={{ ...inputStyle, borderColor: errors.requester ? T.p1 : "#D8DEE4" }} /></Field></div>
              <div style={{ flex: 1 }}><Field label="Phone number" required hint={errors.phone}><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 98765 43210" style={{ ...inputStyle, borderColor: errors.phone ? T.p1 : "#D8DEE4" }} /></Field></div>
            </div>
          </div>
        </div>

        {/* SLA PREVIEW SIDEBAR */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="rise" style={{ background: T.graphite, borderRadius: 12, padding: 20, color: "#fff", position: "sticky", top: 24 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 14 }}><Timer size={15} color={T.amber} /><span style={{ fontWeight: 700, fontSize: 14 }}>SLA preview</span></div>
            {effectivePriority ? (
              <>
                <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
                  <PriorityBadge p={effectivePriority} />
                  <span style={{ fontSize: 12.5, color: "#B9C9E8" }}>{priorityTouched ? "Manually set" : "Auto-suggested"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}>
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
   LOGIN + DASHBOARD (unchanged)
================================================================ */
function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true); const [errors, setErrors] = useState({}); const [status, setStatus] = useState("idle");
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  function handleSubmit(e) {
    e.preventDefault(); const errs = {};
    if (!emailValid) errs.email = "Enter a valid work email.";
    if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    setErrors(errs); if (Object.keys(errs).length) return;
    setStatus("checking"); setTimeout(() => { setStatus("success"); setTimeout(() => onAuthenticated({ name: "Priya Nair", role: "Plant Manager" }), 550); }, 900);
  }
  function handleSSO() { setStatus("checking"); setTimeout(() => { setStatus("success"); setTimeout(() => onAuthenticated({ name: "Priya Nair", role: "Plant Manager" }), 550); }, 900); }
  return (
    <div className="f-display" style={{ minHeight: "100vh", display: "flex", background: T.graphite }}>
      <FontStyles />
      <div className="hidden md:flex" style={{ flex: "1.1", background: `linear-gradient(160deg, ${T.graphite} 0%, ${T.graphite2} 100%)`, flexDirection: "column", justifyContent: "space-between", padding: "48px" }}>
        <div className="flex items-center gap-3">
          <Logo size={38} variant="light" />
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 21, lineHeight: 1 }}>SI</div>
            <div className="f-mono" style={{ color: "#9FB6E0", fontSize: 10, letterSpacing: "0.05em", marginTop: 2 }}>SERVICE INSIDE</div>
          </div>
        </div>
        <div style={{ maxWidth: 440 }}>
          <div style={{ marginBottom: 28, opacity: 0.85 }}><PlantPulse size={72} dot={7} gap={9} /></div>
          <h1 style={{ color: "#fff", fontSize: 30, lineHeight: 1.25, fontWeight: 700, marginBottom: 14 }}>Enterprise Maintenance &amp; Facilities Management System</h1>
          <p style={{ color: "#B9C9E8", fontSize: 15, lineHeight: 1.6 }}>Live status across your plant floor — work orders, preventive schedules, and spares — in one system of record.</p>
        </div>
        <div className="f-mono" style={{ color: "#7C93C4", fontSize: 12 }}>v1.0 · 24 plants connected · SOC 2 Type II</div>
      </div>
      <div style={{ flex: "1", background: T.fog, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div className="rise" style={{ width: "100%", maxWidth: 380 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Sign in to your plant</h2>
          <p style={{ fontSize: 13.5, color: T.inkSoft, marginBottom: 28 }}>Use your work email or single sign-on.</p>
          <form onSubmit={handleSubmit} noValidate>
            <Field label="Work email" required hint={errors.email}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" style={{ ...inputStyle, borderColor: errors.email ? T.p1 : "#D8DEE4" }} /></Field>
            <Field label="Password" required hint={errors.password}><div style={{ position: "relative" }}><input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ ...inputStyle, paddingRight: 40, borderColor: errors.password ? T.p1 : "#D8DEE4" }} /><button type="button" onClick={() => setShowPw((s) => !s)} style={{ position: "absolute", right: 12, top: 11, background: "none", border: "none", cursor: "pointer", color: T.inkSoft }}>{showPw ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field>
            <div className="flex items-center justify-between" style={{ marginBottom: 22 }}><label className="flex items-center gap-2" style={{ fontSize: 13, color: T.inkSoft, cursor: "pointer" }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: T.amber }} /> Remember me</label><button type="button" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>Forgot password?</button></div>
            <button type="submit" disabled={status !== "idle"} style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", background: status === "success" ? T.good : T.ink, color: "#fff", fontWeight: 600, fontSize: 14, cursor: status === "idle" ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {status === "checking" && <><Loader2 size={16} className="animate-spin" /> Verifying…</>}{status === "success" && <><CheckCircle2 size={16} /> Signed in</>}{status === "idle" && <>Sign in <ArrowRight size={15} /></>}
            </button>
            <div className="flex items-center gap-3" style={{ margin: "20px 0" }}><div style={{ flex: 1, height: 1, background: "#DEE3E8" }} /><span style={{ fontSize: 11.5, color: T.inkSoft }}>OR</span><div style={{ flex: 1, height: 1, background: "#DEE3E8" }} /></div>
            <button type="button" onClick={handleSSO} disabled={status !== "idle"} style={{ width: "100%", padding: "11px", borderRadius: 12, border: "1.5px solid #D8DEE4", background: "#fff", color: T.ink, fontWeight: 600, fontSize: 13.5, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><ShieldCheck size={16} color={T.amber} /> Continue with single sign-on</button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   DASHBOARD — real-time ops board
================================================================ */
const TODAY_STR = TODAY.toISOString().slice(0, 10);
const sparkline = (base, vol, points = 8) => Array.from({ length: points }, (_, i) => ({ x: i, v: Math.round(base + Math.sin(i * 0.9) * vol + Math.random() * vol) }));
function sameDay(ts) { return new Date(ts).toISOString().slice(0, 10) === TODAY_STR; }

function StatTile({ icon: Icon, label, value, unit, color, sub, trend, onClick }) {
  return (
    <div onClick={onClick} className="rise" style={{ background: T.fogCard, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: "14px 16px", flex: 1, minWidth: 148, cursor: onClick ? "pointer" : "default" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 11.5, color: T.inkSoft, fontWeight: 600 }}>{label}</span>
        <Icon size={15} color={color} />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <span className="f-mono" style={{ fontSize: 23, fontWeight: 700, color: T.ink }}>{value}</span>
          {unit && <span style={{ fontSize: 11.5, color: T.inkSoft, marginLeft: 3 }}>{unit}</span>}
          {sub && <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{sub}</div>}
        </div>
        {trend && <div style={{ width: 52, height: 26 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>}
      </div>
    </div>
  );
}

function TrafficLightSLA({ workOrders }) {
  const active = workOrders.filter((w) => !["Approved & Closed", "Rejected"].includes(w.status));
  let breached = 0, atRisk = 0, onTrack = 0;
  active.forEach((w) => {
    const total = SLA_MATRIX[w.priority].resolutionMs;
    const remain = total - (Date.now() - w.createdAt);
    if (remain < 0) breached++; else if (remain / total <= 0.25) atRisk++; else onTrack++;
  });
  const rows = [
    { color: T.p1, label: "Breached", count: breached },
    { color: T.amber, label: "At risk (< 25% SLA left)", count: atRisk },
    { color: T.good, label: "On track", count: onTrack },
  ];
  return (
    <div className="rise" style={{ background: T.fogCard, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 18, flex: 1, minWidth: 260 }}>
      <div className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 14 }}><Timer size={15} color={T.amber} /> Traffic Light SLA</div>
      <div className="flex gap-4">
        <div style={{ background: T.graphite, borderRadius: 16, padding: "14px 10px", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          {rows.map((r) => <div key={r.label} style={{ width: 22, height: 22, borderRadius: 11, background: r.color, boxShadow: `0 0 10px ${r.color}88` }} />)}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between" style={{ padding: "6px 0" }}>
              <span style={{ fontSize: 12.5, color: T.inkSoft }}>{r.label}</span>
              <span className="f-mono" style={{ fontSize: 17, fontWeight: 700, color: r.color }}>{r.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuickRaiseWO({ onQuickCreate }) {
  const [machineId, setMachineId] = useState("");
  const [impact, setImpact] = useState("");
  const [desc, setDesc] = useState("");
  function submit() {
    if (!machineId || !impact || !desc) return;
    onQuickCreate({ machineId, impact, description: desc });
    setMachineId(""); setImpact(""); setDesc("");
  }
  return (
    <div className="rise" style={{ background: T.fogCard, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 18, flex: 1, minWidth: 300 }}>
      <div className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 14 }}><Plus size={15} color={T.amber} /> Quick Raise Work Order</div>
      <select value={machineId} onChange={(e) => setMachineId(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
        <option value="">Select machine…</option>{MACHINES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <div className="flex gap-1.5" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        {IMPACT_OPTIONS.map((opt) => (
          <button key={opt.value} onClick={() => setImpact(opt.value)} style={{ padding: "5px 10px", borderRadius: 12, fontSize: 11.5, cursor: "pointer", fontWeight: 600, border: `1.5px solid ${impact === opt.value ? PRIORITY_COLORS[opt.suggests] : T.border}`, background: impact === opt.value ? `${PRIORITY_COLORS[opt.suggests]}1A` : "#fff", color: impact === opt.value ? PRIORITY_COLORS[opt.suggests] : T.inkSoft }}>
            {opt.suggests}
          </button>
        ))}
      </div>
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="What's wrong?" style={{ ...inputStyle, resize: "none", marginBottom: 12 }} />
      <Btn variant="amber" icon={Send} onClick={submit} disabled={!machineId || !impact || !desc} style={{ width: "100%", justifyContent: "center" }}>Raise Work Order</Btn>
    </div>
  );
}

function LiveTechnicianStatus({ workOrders, onOpenWO }) {
  const rows = TECHNICIANS.map((t) => {
    const current = workOrders.find((w) => w.assignedTo.some((a) => a.id === t.id) && w.status === "In Progress");
    const status = t.load === 0 ? "Available" : t.load <= 2 ? "On Job" : "Overloaded";
    const color = status === "Available" ? T.good : status === "On Job" ? T.amber : T.p1;
    return { ...t, current, status, color };
  });
  return (
    <div className="rise" style={{ background: T.fogCard, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
      <div className="flex items-center gap-2" style={{ padding: "16px 18px", borderBottom: "1px solid #EEF0F3", fontWeight: 700, fontSize: 14.5, color: T.ink }}><Users size={16} color={T.amber} /> Live Technician Status</div>
      {rows.map((r, i) => (
        <div key={r.id} onClick={() => r.current && onOpenWO(r.current.id)} className="flex items-center justify-between" style={{ padding: "12px 18px", borderTop: i > 0 ? "1px solid #F1F3F5" : "none", cursor: r.current ? "pointer" : "default" }}>
          <div className="flex items-center gap-3">
            <div style={{ position: "relative" }}>
              <div style={{ width: 32, height: 32, borderRadius: 16, background: T.graphite, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{r.name.split(" ").map((n) => n[0]).join("")}</div>
              <div style={{ position: "absolute", bottom: -2, right: -2, width: 10, height: 10, borderRadius: 5, background: r.color, border: "2px solid #fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{r.name}</div>
              <div style={{ fontSize: 11.5, color: T.inkSoft }}>{r.skills.join(" · ")}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: r.color }}>{r.status}</div>
            <div style={{ fontSize: 11.5, color: T.inkSoft }}>{r.current ? r.current.machine.name : `${r.load} open job${r.load !== 1 ? "s" : ""}`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardScreen({ user, workOrders, assets, pmSchedules, onOpenWO, onOpenAsset, onGoToWorkOrders, onFilterWOPriority, onQuickCreate, onGeneratePM, onNotify }) {
  const active = workOrders.filter((w) => !["Approved & Closed", "Rejected"].includes(w.status));
  const countP = (p) => active.filter((w) => w.priority === p).length;
  const availableTechs = TECHNICIANS.filter((t) => t.load === 0).length;

  const machinesDownIds = new Set(active.filter((w) => w.type === "Breakdown").map((w) => w.machine.id));
  const operableAssets = assets.filter((a) => a.category !== "Production Line" && a.status !== "Decommissioned");
  const machinesRunning = operableAssets.filter((a) => !machinesDownIds.has(a.id)).length;
  const machinesDown = machinesDownIds.size;

  const fullStoppage = active.filter((w) => w.impact === "full_stoppage").length;
  const reducedCapacity = active.filter((w) => w.impact === "reduced_capacity").length;
  const impactLevel = fullStoppage > 0 ? { label: "Severe", color: T.p1 } : reducedCapacity > 0 ? { label: "Moderate", color: T.amber } : { label: "Minimal", color: T.good };

  const closedWOs = workOrders.filter((w) => w.status === "Approved & Closed");
  const mttr = useMemo(() => {
    if (closedWOs.length === 0) return 6.2;
    const totalHrs = closedWOs.reduce((sum, w) => {
      const closedEvent = w.history.find((h) => h.status === "Approved & Closed");
      return sum + (closedEvent.t - w.createdAt) / 3600e3;
    }, 0);
    return Math.round((totalHrs / closedWOs.length) * 10) / 10;
  }, [closedWOs]);
  const mtbf = 312;
  const mttrTrend = useMemo(() => sparkline(mttr, 1.2), [mttr]);
  const mtbfTrend = useMemo(() => sparkline(mtbf, 20), []);

  const todaysPM = pmSchedules.filter((s) => s.isActive && s.nextDue === TODAY_STR);
  const todaysBreakdowns = workOrders.filter((w) => w.type === "Breakdown" && sameDay(w.createdAt));

  const recentActivity = useMemo(() => {
    const all = [];
    workOrders.forEach((w) => w.history.forEach((h) => all.push({ t: h.t, wo: w, action: h.status, actor: h.actor })));
    return all.sort((a, b) => b.t - a.t).slice(0, 6);
  }, [workOrders]);
  const actionColor = { "New": T.p4, "Assigned": T.p4, "In Progress": T.amber, "On Hold": T.inkSoft, "Completed": T.good, "Pending Review": T.good, "Approved & Closed": T.good, "Rejected": T.p1 };

  function handleQuickCreate({ machineId, impact, description }) {
    const machine = MACHINES.find((m) => m.id === machineId);
    const priority = suggestPriority(impact);
    const now = Date.now();
    onQuickCreate({
      id: "wo" + Math.random().toString(36).slice(2, 8), woNumber: `PLT001-WO-2026-${Math.floor(1200 + Math.random() * 800)}`,
      machine, department: machine.dept, type: "Breakdown", priority, status: "New", impact,
      estDowntime: { value: 2, unit: "Hours" }, description, requestedBy: user.name, assignedTo: [], photos: [], videos: [], createdAt: now,
      history: [{ status: "New", actor: user.name, t: now, remarks: "Raised via Quick Raise on Dashboard" }],
    });
  }

  return (
    <div className="rise">
      <div className="flex items-center justify-between" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink }}>Good morning, {user.name.split(" ")[0]}</h1>
          <p style={{ fontSize: 13.5, color: T.inkSoft }}>Plant 01 — Chennai · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <Btn variant="ghost" icon={FileDown} onClick={() => onNotify("Dashboard exported as PDF.")}>Export PDF</Btn>
      </div>

      {/* TOP KPI STRIP */}
      <div className="flex gap-3" style={{ marginBottom: 20, flexWrap: "wrap" }}>
        <StatTile icon={ClipboardList} label="Open Work Orders" value={active.length} color={T.graphite} onClick={() => onFilterWOPriority(null, "workorders")} />
        <StatTile icon={AlertTriangle} label="P1 Critical" value={countP("P1")} color={T.p1} onClick={() => onFilterWOPriority("P1", "workorders")} />
        <StatTile icon={AlertTriangle} label="P2" value={countP("P2")} color={T.p2} onClick={() => onFilterWOPriority("P2", "workorders")} />
        <StatTile icon={AlertTriangle} label="P3" value={countP("P3")} color={T.p3} onClick={() => onFilterWOPriority("P3", "workorders")} />
        <StatTile icon={AlertTriangle} label="P4" value={countP("P4")} color={T.p4} onClick={() => onFilterWOPriority("P4", "workorders")} />
        <StatTile icon={UserCheck} label="Technicians Available" value={availableTechs} unit={`/ ${TECHNICIANS.length}`} color={T.good} />
        <StatTile icon={CheckCircle2} label="Machines Running" value={machinesRunning} unit={`/ ${operableAssets.length}`} color={T.good} onClick={() => onFilterWOPriority(null, "assets")} />
        <StatTile icon={PowerOff} label="Machines Down" value={machinesDown} color={T.p1} onClick={() => onFilterWOPriority(null, "assets")} />
        <StatTile icon={Gauge} label="Production Impact" value={impactLevel.label} color={impactLevel.color} />
        <StatTile icon={Timer} label="MTTR" value={mttr} unit="hrs" color={T.p4} trend={mttrTrend} />
        <StatTile icon={Repeat} label="MTBF" value={mtbf} unit="hrs" color={T.good} trend={mtbfTrend} />
      </div>

      {/* TODAY'S PM / BREAKDOWN / NOTIFICATIONS */}
      <div className="flex gap-4" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <div className="rise" style={{ flex: 1, minWidth: 280, background: T.fogCard, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 18 }}>
          <div className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 12 }}><CalendarClock size={15} color={T.p4} /> Today's PM</div>
          {todaysPM.length === 0 && <div style={{ fontSize: 12.5, color: T.inkSoft }}>No PM due today.</div>}
          {todaysPM.map((s) => {
            const asset = assets.find((a) => a.id === s.assetId);
            return (
              <div key={s.id} className="flex items-center justify-between" style={{ padding: "8px 0", borderBottom: "1px solid #F1F3F5" }}>
                <div><div style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{s.title}</div><div style={{ fontSize: 11.5, color: T.inkSoft }}>{asset?.name}</div></div>
                <Btn size="sm" variant="ghost" onClick={() => onGeneratePM(s)}>Generate</Btn>
              </div>
            );
          })}
        </div>

        <div className="rise" style={{ flex: 1, minWidth: 280, background: T.fogCard, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 18 }}>
          <div className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 12 }}><AlertTriangle size={15} color={T.p1} /> Today's Breakdowns</div>
          {todaysBreakdowns.length === 0 && <div style={{ fontSize: 12.5, color: T.inkSoft }}>No breakdowns reported today.</div>}
          {todaysBreakdowns.map((w) => (
            <div key={w.id} onClick={() => onOpenWO(w.id)} className="flex items-center justify-between" style={{ padding: "8px 0", borderBottom: "1px solid #F1F3F5", cursor: "pointer" }}>
              <div><div style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{w.machine.name}</div><div style={{ fontSize: 11.5, color: T.inkSoft }}>{w.woNumber}</div></div>
              <PriorityBadge p={w.priority} size="sm" />
            </div>
          ))}
        </div>

        <div className="rise" style={{ flex: 1, minWidth: 280, background: T.fogCard, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 18 }}>
          <div className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: 14, color: T.ink, marginBottom: 12 }}><Bell size={15} color={T.amber} /> Recent Notifications</div>
          {recentActivity.map((a, i) => (
            <div key={i} onClick={() => onOpenWO(a.wo.id)} className="flex items-start gap-2" style={{ padding: "7px 0", borderBottom: i < recentActivity.length - 1 ? "1px solid #F1F3F5" : "none", cursor: "pointer" }}>
              <div style={{ width: 7, height: 7, borderRadius: 4, background: actionColor[a.action] || T.inkSoft, marginTop: 5, flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: T.ink }}>
                <strong>{a.actor}</strong> moved <span className="f-mono">{a.wo.woNumber}</span> to <span style={{ color: actionColor[a.action], fontWeight: 600 }}>{a.action}</span>
                <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 1 }}>{new Date(a.t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* QUICK RAISE + TRAFFIC LIGHT SLA */}
      <div className="flex gap-4" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <QuickRaiseWO onQuickCreate={handleQuickCreate} />
        <TrafficLightSLA workOrders={workOrders} />
      </div>

      {/* LIVE TECHNICIAN STATUS */}
      <LiveTechnicianStatus workOrders={workOrders} onOpenWO={onOpenWO} />
    </div>
  );
}


const REPORT_DEFS = [
  { key: "wo_summary", label: "Work Order Summary", icon: ClipboardList, desc: "All work orders with status, cost, and duration filters." },
  { key: "sla_compliance", label: "SLA Compliance", icon: Timer, desc: "Breach analysis by priority and plant." },
  { key: "pm_compliance", label: "PM Compliance", icon: CalendarClock, desc: "Scheduled vs. completed PM, overdue list." },
  { key: "asset_downtime", label: "Asset Downtime", icon: Wrench, desc: "Downtime hours and top-failing assets (Pareto)." },
  { key: "maintenance_cost", label: "Maintenance Cost", icon: BarChart3, desc: "Cost by asset, category, and department." },
  { key: "inventory_valuation", label: "Inventory Valuation", icon: Boxes, desc: "Stock levels, usage trends, slow-moving parts." },
  { key: "technician_productivity", label: "Technician Productivity", icon: Users, desc: "Hours logged, jobs closed, first-time-fix rate." },
  { key: "failure_analysis", label: "Failure Analysis", icon: AlertTriangle, desc: "Failure code frequency and MTBF trend." },
  { key: "audit_trail", label: "Audit Trail", icon: FileText, desc: "Full change history for compliance audits." },
  { key: "procurement", label: "Procurement", icon: ShoppingCart, desc: "PR/PO cycle time and vendor performance." },
];

function isBreached(w) {
  const closedEvent = w.history.find((h) => h.status === "Approved & Closed");
  const endTime = closedEvent ? closedEvent.t : Date.now();
  return (endTime - w.createdAt) > SLA_MATRIX[w.priority].resolutionMs;
}
function estCost(w) {
  const hrs = Number(w.estDowntime.value) * (w.estDowntime.unit === "Days" ? 8 : 1);
  const rate = { P1: 650, P2: 500, P3: 400, P4: 300 }[w.priority] || 350;
  return Math.round(hrs * rate);
}
function classifyFailure(desc) {
  const d = desc.toLowerCase();
  if (d.includes("hydraulic") || d.includes("fluid") || d.includes("leak") || d.includes("valve")) return "Hydraulic";
  if (d.includes("sensor") || d.includes("plc") || d.includes("electr")) return "Electrical";
  if (d.includes("belt") || d.includes("bearing") || d.includes("spindle") || d.includes("mechanic")) return "Mechanical";
  if (d.includes("filter") || d.includes("service") || d.includes("scheduled")) return "Scheduled / Routine";
  return "Other";
}
const money = (n) => `₹${n.toLocaleString()}`;

function ReportShell({ def, children, onExport, onSave, onSchedule }) {
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 4, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="flex items-center gap-2"><def.icon size={17} color={T.amber} /><h2 style={{ fontSize: 17, fontWeight: 700, color: T.ink }}>{def.label}</h2></div>
          <p style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 2 }}>{def.desc}</p>
        </div>
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="ghost" icon={FileDown} onClick={() => onExport("PDF")}>PDF</Btn>
          <Btn size="sm" variant="ghost" icon={FileSpreadsheet} onClick={() => onExport("Excel")}>Excel</Btn>
          <Btn size="sm" variant="ghost" icon={Download} onClick={() => onExport("CSV")}>CSV</Btn>
          <Btn size="sm" variant="ghost" icon={Mail} onClick={onSchedule}>Schedule Email</Btn>
          <Btn size="sm" variant="subtle" icon={Save} onClick={onSave}>Save as View</Btn>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>{children}</div>
    </div>
  );
}

function ReportTable({ columns, rows, onRowClick }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, overflow: "hidden" }}>
      <div className="flex items-center" style={{ padding: "10px 16px", background: T.fog, fontSize: 11, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {columns.map((c) => <div key={c.label} style={{ flex: c.flex || 1, textAlign: c.align || "left" }}>{c.label}</div>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} onClick={() => onRowClick && onRowClick(r)} className="flex items-center" style={{ padding: "11px 16px", borderTop: i > 0 ? "1px solid #F1F3F5" : "none", cursor: onRowClick ? "pointer" : "default", fontSize: 13 }}>
          {columns.map((c) => <div key={c.label} style={{ flex: c.flex || 1, textAlign: c.align || "left", color: T.ink }}>{c.render ? c.render(r) : r[c.key]}</div>)}
        </div>
      ))}
      {rows.length === 0 && <div style={{ padding: 30, textAlign: "center", color: T.inkSoft, fontSize: 13 }}>No records match this report's filters.</div>}
    </div>
  );
}

function WOSummaryReport({ workOrders, onOpenWO }) {
  const [status, setStatus] = useState("All"); const [priority, setPriority] = useState("All");
  const rows = workOrders.filter((w) => (status === "All" || w.status === status) && (priority === "All" || w.priority === priority));
  return (
    <div>
      <div className="flex gap-2" style={{ marginBottom: 14 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inputStyle, width: 190, padding: "8px 10px" }}><option>All</option>{STATUS_FLOW.concat(["On Hold", "Rejected"]).map((s) => <option key={s}>{s}</option>)}</select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ ...inputStyle, width: 140, padding: "8px 10px" }}><option>All</option><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select>
      </div>
      <ReportTable
        onRowClick={(r) => onOpenWO(r.id)}
        columns={[
          { label: "WO #", key: "woNumber", flex: 1.4 },
          { label: "Asset", render: (r) => r.machine.name, flex: 1.4 },
          { label: "Type", key: "type" },
          { label: "Priority", render: (r) => <PriorityBadge p={r.priority} size="sm" /> },
          { label: "Status", render: (r) => <StatusBadge s={r.status} />, flex: 1.3 },
          { label: "Est. Cost", render: (r) => money(estCost(r)), align: "right" },
        ]}
        rows={rows}
      />
    </div>
  );
}

function SLAComplianceReport({ workOrders }) {
  const byPriority = ["P1", "P2", "P3", "P4"].map((p) => {
    const set = workOrders.filter((w) => w.priority === p);
    const breached = set.filter(isBreached).length;
    return { p, total: set.length, breached, pct: set.length ? Math.round(((set.length - breached) / set.length) * 100) : 100 };
  });
  const breachedWOs = workOrders.filter(isBreached);
  return (
    <div>
      <div className="flex gap-4" style={{ marginBottom: 20, flexWrap: "wrap" }}>
        {byPriority.map((b) => (
          <div key={b.p} style={{ flex: 1, minWidth: 140, background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: 14 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 6 }}><PriorityBadge p={b.p} size="sm" /><span style={{ fontSize: 11.5, color: T.inkSoft }}>{b.total} WOs</span></div>
            <div className="f-mono" style={{ fontSize: 22, fontWeight: 700, color: b.pct >= 90 ? T.good : b.pct >= 70 ? T.amber : T.p1 }}>{b.pct}%</div>
            <div style={{ fontSize: 11.5, color: T.inkSoft }}>{b.breached} breached</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 16, marginBottom: 20, height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byPriority}>
            <XAxis dataKey="p" tick={{ fontSize: 11.5, fill: T.inkSoft }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10.5, fill: T.inkSoft }} axisLine={false} tickLine={false} width={30} />
            <Tooltip />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]}>{byPriority.map((b) => <Cell key={b.p} fill={PRIORITY_COLORS[b.p]} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, marginBottom: 8 }}>Breached work orders</div>
      <ReportTable columns={[{ label: "WO #", key: "woNumber", flex: 1.4 }, { label: "Asset", render: (r) => r.machine.name, flex: 1.4 }, { label: "Priority", render: (r) => <PriorityBadge p={r.priority} size="sm" /> }, { label: "Status", render: (r) => <StatusBadge s={r.status} />, flex: 1.3 }]} rows={breachedWOs} />
    </div>
  );
}

function PMComplianceReport({ pmSchedules, assets, onOpenAsset }) {
  const active = pmSchedules.filter((s) => s.isActive);
  const overdue = active.filter((s) => daysBetween(s.nextDue) < 0);
  const pct = active.length ? Math.round(((active.length - overdue.length) / active.length) * 100) : 100;
  return (
    <div>
      <div className="flex gap-4" style={{ marginBottom: 20, flexWrap: "wrap" }}>
        <ChartCard title="PM compliance" height={150}><GaugeChart value={pct} color={pct >= 95 ? T.good : T.amber} label="Target ≥ 95%" /></ChartCard>
        <div style={{ flex: 1, minWidth: 200, background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 6 }}>Active schedules</div>
          <div className="f-mono" style={{ fontSize: 26, fontWeight: 700, color: T.ink }}>{active.length}</div>
        </div>
        <div style={{ flex: 1, minWidth: 200, background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 6 }}>Overdue</div>
          <div className="f-mono" style={{ fontSize: 26, fontWeight: 700, color: overdue.length ? T.p1 : T.good }}>{overdue.length}</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ink, marginBottom: 8 }}>Overdue PM schedules</div>
      <ReportTable
        onRowClick={(r) => onOpenAsset(r.assetId)}
        columns={[{ label: "Schedule", key: "title", flex: 1.6 }, { label: "Asset", render: (r) => assets.find((a) => a.id === r.assetId)?.name || "—", flex: 1.4 }, { label: "Next Due", key: "nextDue" }, { label: "Days Overdue", render: (r) => Math.abs(daysBetween(r.nextDue)), align: "right" }]}
        rows={overdue}
      />
    </div>
  );
}

function AssetDowntimeReport({ assets, onOpenAsset }) {
  const sorted = [...assets].filter((a) => a.category !== "Production Line").sort((a, b) => b.downtimeYTD - a.downtimeYTD);
  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 16, marginBottom: 20, height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sorted.slice(0, 8)}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: T.inkSoft }} axisLine={false} tickLine={false} interval={0} angle={-14} textAnchor="end" height={44} />
            <YAxis tick={{ fontSize: 10.5, fill: T.inkSoft }} axisLine={false} tickLine={false} width={28} />
            <Tooltip />
            <Bar dataKey="downtimeYTD" fill={T.p1} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ReportTable
        onRowClick={(r) => onOpenAsset(r.id)}
        columns={[{ label: "Asset", key: "name", flex: 1.6 }, { label: "Department", key: "department" }, { label: "Criticality", render: (r) => <CriticalityBadge c={r.criticality} /> }, { label: "Downtime YTD", render: (r) => `${r.downtimeYTD} hrs`, align: "right" }]}
        rows={sorted}
      />
    </div>
  );
}

function MaintenanceCostReport({ assets, onOpenAsset }) {
  const byCategory = useMemo(() => {
    const map = {};
    assets.forEach((a) => { map[a.category] = (map[a.category] || 0) + a.costYTD; });
    return Object.entries(map).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [assets]);
  const DONUT_COLORS = [T.amber, T.p4, T.good, T.p2, T.p3, T.p1, T.steel];
  const sorted = [...assets].filter((a) => a.costYTD > 0).sort((a, b) => b.costYTD - a.costYTD);
  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 16, marginBottom: 20, height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>{byCategory.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}</Pie>
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /><Tooltip formatter={(v) => money(v)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ReportTable onRowClick={(r) => onOpenAsset(r.id)} columns={[{ label: "Asset", key: "name", flex: 1.6 }, { label: "Category", key: "category" }, { label: "Department", key: "department" }, { label: "Cost YTD", render: (r) => money(r.costYTD), align: "right" }]} rows={sorted} />
    </div>
  );
}

const MOCK_INVENTORY = [
  { part: "Hydraulic Seal Kit — HS-220", warehouse: "Main Store", qty: 2, unitCost: 1450, reorder: 10 },
  { part: "Ball Bearing 6205-2RS", warehouse: "Main Store", qty: 5, unitCost: 320, reorder: 25 },
  { part: "V-Belt A-42", warehouse: "Main Store", qty: 1, unitCost: 680, reorder: 8 },
  { part: "Spindle Coolant (20L)", warehouse: "Machining Store", qty: 14, unitCost: 2200, reorder: 6 },
  { part: "PLC Relay Module", warehouse: "Electrical Store", qty: 22, unitCost: 950, reorder: 10 },
];
function InventoryValuationReport() {
  const rows = MOCK_INVENTORY.map((p) => ({ ...p, value: p.qty * p.unitCost, low: p.qty < p.reorder }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div>
      <div style={{ background: "#fff", border: `1px solid ${T.border}`, boxShadow: T.shadow, borderRadius: 12, padding: 16, marginBottom: 16, display: "inline-block" }}>
        <div style={{ fontSize: 11.5, color: T.inkSoft }}>Total inventory value</div>
        <div className="f-mono" style={{ fontSize: 22, fontWeight: 700, color: T.ink }}>{money(total)}</div>
      </div>
      <ReportTable columns={[{ label: "Part", key: "part", flex: 1.8 }, { label: "Warehouse", key: "warehouse", flex: 1.3 }, { label: "Qty on Hand", render: (r) => <span style={{ color: r.low ? T.p1 : T.ink, fontWeight: r.low ? 700 : 400 }}>{r.qty}{r.low && " ⚠"}</span>, align: "right" }, { label: "Unit Cost", render: (r) => money(r.unitCost), align: "right" }, { label: "Value", render: (r) => money(r.value), align: "right" }]} rows={rows} />
    </div>
  );
}

function TechnicianProductivityReport({ workOrders }) {
  const rows = TECHNICIANS.map((t) => {
    const assigned = workOrders.filter((w) => w.assignedTo.some((a) => a.id === t.id));
    const closed = assigned.filter((w) => w.status === "Approved & Closed").length;
    const ftf = Math.max(60, 96 - t.load * 6);
    return { ...t, assignedCount: assigned.length, closed, ftf, avgHrs: (3 + t.load * 0.6).toFixed(1) };
  });
  return <ReportTable columns={[{ label: "Technician", key: "name", flex: 1.5 }, { label: "Skills", render: (r) => r.skills.join(", "), flex: 1.6 }, { label: "Assigned", render: (r) => r.assignedCount, align: "right" }, { label: "Closed", render: (r) => r.closed, align: "right" }, { label: "First-Time-Fix %", render: (r) => `${r.ftf}%`, align: "right" }, { label: "Avg Hrs / Job", render: (r) => r.avgHrs, align: "right" }]} rows={rows} />;
}

function FailureAnalysisReport({ workOrders }) {
  const breakdowns = workOrders.filter((w) => w.type === "Breakdown");
  const byCategory = useMemo(() => {
    const map = {};
    breakdowns.forEach((w) => { const c = classifyFailure(w.description); map[c] = (map[c] || 0) + 1; });
    return Object.entries(map).map(([name, count]) => ({ name, count }));
  }, [breakdowns]);
  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 16, marginBottom: 20, height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byCategory} layout="vertical" margin={{ left: 20 }}>
            <XAxis type="number" tick={{ fontSize: 10.5, fill: T.inkSoft }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: T.ink }} axisLine={false} tickLine={false} width={110} />
            <Tooltip /><Bar dataKey="count" fill={T.p2} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ReportTable columns={[{ label: "WO #", key: "woNumber", flex: 1.3 }, { label: "Asset", render: (r) => r.machine.name, flex: 1.4 }, { label: "Category", render: (r) => classifyFailure(r.description), flex: 1.2 }, { label: "Description", key: "description", flex: 2 }]} rows={breakdowns} />
    </div>
  );
}

function AuditTrailReport({ workOrders }) {
  const [actorFilter, setActorFilter] = useState("All");
  const rows = useMemo(() => {
    const all = [];
    workOrders.forEach((w) => w.history.forEach((h) => all.push({ t: h.t, entity: w.woNumber, action: h.status, actor: h.actor, remarks: h.remarks || "" })));
    return all.sort((a, b) => b.t - a.t);
  }, [workOrders]);
  const actors = ["All", ...Array.from(new Set(rows.map((r) => r.actor)))];
  const filtered = actorFilter === "All" ? rows : rows.filter((r) => r.actor === actorFilter);
  return (
    <div>
      <div className="flex gap-2" style={{ marginBottom: 14 }}>
        <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} style={{ ...inputStyle, width: 200, padding: "8px 10px" }}>{actors.map((a) => <option key={a}>{a}</option>)}</select>
      </div>
      <ReportTable columns={[{ label: "Timestamp", render: (r) => new Date(r.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), flex: 1.3 }, { label: "Entity", key: "entity", flex: 1.2 }, { label: "Action", key: "action", flex: 1.2 }, { label: "Performed By", key: "actor", flex: 1.2 }, { label: "Remarks", key: "remarks", flex: 1.8 }]} rows={filtered.slice(0, 60)} />
    </div>
  );
}

const MOCK_PROCUREMENT = [
  { po: "PO-2026-0088", vendor: "Atlas Copco India", status: "Received", cycleDays: 6, amount: 84000 },
  { po: "PO-2026-0091", vendor: "Haas Automation", status: "Sent", cycleDays: 3, amount: 156000 },
  { po: "PO-2026-0093", vendor: "Dorner Mfg.", status: "PartiallyReceived", cycleDays: 9, amount: 41200 },
  { po: "PO-2026-0095", vendor: "Fanuc India", status: "Draft", cycleDays: 0, amount: 220000 },
];
function ProcurementReport() {
  return <ReportTable columns={[{ label: "PO #", key: "po", flex: 1.2 }, { label: "Vendor", key: "vendor", flex: 1.5 }, { label: "Status", key: "status", flex: 1.2 }, { label: "Cycle Time", render: (r) => `${r.cycleDays} days`, align: "right" }, { label: "Amount", render: (r) => money(r.amount), align: "right" }]} rows={MOCK_PROCUREMENT} />;
}

function ReportsCenter({ workOrders, assets, pmSchedules, savedReports, onOpenWO, onOpenAsset, onNotify, onOpenBuilder }) {
  const [selected, setSelected] = useState("wo_summary");
  const def = REPORT_DEFS.find((r) => r.key === selected);

  function handleExport(fmt) { onNotify(`${def.label} exported as ${fmt}.`); }
  function handleSave() { onNotify(`"${def.label}" saved as a custom view.`); }
  function handleSchedule() { onNotify(`${def.label} will be emailed weekly.`); }

  return (
    <div className="rise flex gap-5" style={{ flexWrap: "wrap" }}>
      <div style={{ width: 250, flexShrink: 0 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <h1 style={{ fontSize: 19, fontWeight: 700, color: T.ink }}>Reports</h1>
        </div>
        <Btn variant="amber" icon={Plus} onClick={onOpenBuilder} style={{ width: "100%", justifyContent: "center", marginBottom: 14 }}>Custom Report</Btn>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {REPORT_DEFS.map((r) => (
            <button key={r.key} onClick={() => setSelected(r.key)} className="flex items-center gap-2.5" style={{ padding: "9px 12px", borderRadius: 12, border: "none", cursor: "pointer", textAlign: "left", background: selected === r.key ? T.fog : "transparent", color: selected === r.key ? T.ink : T.inkSoft, fontSize: 13, fontWeight: selected === r.key ? 600 : 500 }}>
              <r.icon size={15} /> {r.label}
            </button>
          ))}
        </div>
        {savedReports.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkSoft, textTransform: "uppercase", margin: "18px 0 8px", letterSpacing: "0.03em" }}>Saved custom views</div>
            {savedReports.map((sr) => (
              <div key={sr.id} style={{ padding: "8px 12px", fontSize: 12.5, color: T.ink, background: T.fog, borderRadius: 12, marginBottom: 4 }}>{sr.name}</div>
            ))}
          </>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 420 }}>
        <ReportShell def={def} onExport={handleExport} onSave={handleSave} onSchedule={handleSchedule}>
          {selected === "wo_summary" && <WOSummaryReport workOrders={workOrders} onOpenWO={onOpenWO} />}
          {selected === "sla_compliance" && <SLAComplianceReport workOrders={workOrders} />}
          {selected === "pm_compliance" && <PMComplianceReport pmSchedules={pmSchedules} assets={assets} onOpenAsset={onOpenAsset} />}
          {selected === "asset_downtime" && <AssetDowntimeReport assets={assets} onOpenAsset={onOpenAsset} />}
          {selected === "maintenance_cost" && <MaintenanceCostReport assets={assets} onOpenAsset={onOpenAsset} />}
          {selected === "inventory_valuation" && <InventoryValuationReport />}
          {selected === "technician_productivity" && <TechnicianProductivityReport workOrders={workOrders} />}
          {selected === "failure_analysis" && <FailureAnalysisReport workOrders={workOrders} />}
          {selected === "audit_trail" && <AuditTrailReport workOrders={workOrders} />}
          {selected === "procurement" && <ProcurementReport />}
        </ReportShell>
      </div>
    </div>
  );
}

/* ---- Custom Report Builder --------------------------------------- */
const BUILDER_SOURCES = {
  "Work Orders": {
    columns: [
      { key: "woNumber", label: "WO #" }, { key: "machine.name", label: "Asset" }, { key: "department", label: "Department" },
      { key: "type", label: "Type" }, { key: "priority", label: "Priority" }, { key: "status", label: "Status" },
    ],
  },
  "Assets": {
    columns: [
      { key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "department", label: "Department" },
      { key: "category", label: "Category" }, { key: "criticality", label: "Criticality" }, { key: "status", label: "Status" },
      { key: "downtimeYTD", label: "Downtime YTD" }, { key: "costYTD", label: "Cost YTD" },
    ],
  },
};
function getField(row, path) { return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), row); }
function applyOp(raw, op, value) {
  if (raw == null) return op === "!=";
  const numVal = Number(value); const isNum = !isNaN(numVal) && value !== "";
  const a = isNum ? Number(raw) : String(raw).toLowerCase();
  const b = isNum ? numVal : String(value).toLowerCase();
  switch (op) {
    case "=": return a === b;
    case "!=": return a !== b;
    case ">": return a > b;
    case "<": return a < b;
    case "contains": return String(raw).toLowerCase().includes(String(value).toLowerCase());
    default: return true;
  }
}

function CustomReportBuilder({ workOrders, assets, onCancel, onSaved }) {
  const [source, setSource] = useState("Work Orders");
  const availableColumns = BUILDER_SOURCES[source].columns;
  const [selectedCols, setSelectedCols] = useState(availableColumns.slice(0, 4).map((c) => c.key));
  const [filters, setFilters] = useState([]);
  const [sortBy, setSortBy] = useState(""); const [sortDir, setSortDir] = useState("asc");
  const [showResults, setShowResults] = useState(false);
  const [reportName, setReportName] = useState("");

  function changeSource(s) { setSource(s); setSelectedCols(BUILDER_SOURCES[s].columns.slice(0, 4).map((c) => c.key)); setFilters([]); setShowResults(false); }
  function toggleCol(key) { setSelectedCols((c) => c.includes(key) ? c.filter((k) => k !== key) : [...c, key]); }
  function addFilter() { setFilters((f) => [...f, { field: availableColumns[0].key, op: "=", value: "" }]); }
  function updateFilter(i, patch) { setFilters((f) => f.map((row, idx) => idx === i ? { ...row, ...patch } : row)); }
  function removeFilter(i) { setFilters((f) => f.filter((_, idx) => idx !== i)); }

  const rawData = source === "Work Orders" ? workOrders : assets;
  const result = useMemo(() => {
    let data = rawData.filter((row) => filters.every((f) => f.value === "" || applyOp(getField(row, f.field), f.op, f.value)));
    if (sortBy) data = [...data].sort((a, b) => { const av = getField(a, sortBy), bv = getField(b, sortBy); return (av > bv ? 1 : av < bv ? -1 : 0) * (sortDir === "asc" ? 1 : -1); });
    return data;
  }, [rawData, filters, sortBy, sortDir]);

  return (
    <div className="rise" style={{ maxWidth: 980 }}>
      <button onClick={onCancel} className="flex items-center gap-1.5" style={{ background: "none", border: "none", color: T.inkSoft, fontSize: 13, cursor: "pointer", marginBottom: 14 }}><ArrowLeft size={15} /> Back to Reports</button>
      <h1 style={{ fontSize: 21, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Custom Report Builder</h1>
      <p style={{ fontSize: 13, color: T.inkSoft, marginBottom: 24 }}>Choose a data source, the columns to include, and any filters — then preview before saving.</p>

      <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.shadow, padding: 22, marginBottom: 16 }}>
        <Field label="Data source" required>
          <div className="flex gap-2">{Object.keys(BUILDER_SOURCES).map((s) => <button key={s} onClick={() => changeSource(s)} style={{ padding: "8px 16px", borderRadius: 12, fontSize: 13, cursor: "pointer", fontWeight: 500, border: `1.5px solid ${source === s ? T.ink : "#D8DEE4"}`, background: source === s ? T.ink : "#fff", color: source === s ? "#fff" : T.ink }}>{s}</button>)}</div>
        </Field>

        <Field label="Columns to include">
          <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
            {availableColumns.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5" style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 7, border: `1.5px solid ${selectedCols.includes(c.key) ? T.amber : T.border}`, background: selectedCols.includes(c.key) ? "#FEF6E9" : "#fff", cursor: "pointer" }}>
                <input type="checkbox" checked={selectedCols.includes(c.key)} onChange={() => toggleCol(c.key)} style={{ accentColor: T.amber }} /> {c.label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Filters">
          {filters.map((f, i) => (
            <div key={i} className="flex gap-2" style={{ marginBottom: 8 }}>
              <select value={f.field} onChange={(e) => updateFilter(i, { field: e.target.value })} style={{ ...inputStyle, flex: 1.4 }}>{availableColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
              <select value={f.op} onChange={(e) => updateFilter(i, { op: e.target.value })} style={{ ...inputStyle, width: 110 }}><option value="=">=</option><option value="!=">≠</option><option value=">">&gt;</option><option value="<">&lt;</option><option value="contains">contains</option></select>
              <input value={f.value} onChange={(e) => updateFilter(i, { value: e.target.value })} placeholder="Value" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => removeFilter(i)} style={{ background: "none", border: "none", cursor: "pointer", color: T.p1 }}><Trash2 size={16} /></button>
            </div>
          ))}
          <Btn size="sm" variant="ghost" icon={Plus} onClick={addFilter}>Add Filter</Btn>
        </Field>

        <div className="flex gap-4">
          <div style={{ flex: 1 }}>
            <Field label="Sort by">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={inputStyle}><option value="">None</option>{availableColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Direction">
              <div className="flex gap-2">{["asc", "desc"].map((d) => <button key={d} onClick={() => setSortDir(d)} style={{ flex: 1, padding: "8px 0", borderRadius: 12, fontSize: 13, cursor: "pointer", border: `1.5px solid ${sortDir === d ? T.ink : "#D8DEE4"}`, background: sortDir === d ? T.ink : "#fff", color: sortDir === d ? "#fff" : T.ink }}>{d === "asc" ? "Ascending" : "Descending"}</button>)}</div>
            </Field>
          </div>
        </div>
      </div>

      <div className="flex gap-2" style={{ marginBottom: 16 }}>
        <Btn variant="amber" icon={Eye} onClick={() => setShowResults(true)}>Preview</Btn>
        <input value={reportName} onChange={(e) => setReportName(e.target.value)} placeholder="Name this view to save it…" style={{ ...inputStyle, width: 240 }} />
        <Btn variant="subtle" icon={Save} disabled={!reportName} onClick={() => { onSaved({ id: "rpt" + Date.now(), name: reportName, source, selectedCols, filters, sortBy, sortDir }); setReportName(""); }}>Save View</Btn>
      </div>

      {showResults && (
        <ReportTable
          columns={selectedCols.map((key) => ({ label: availableColumns.find((c) => c.key === key)?.label || key, render: (r) => { const v = getField(r, key); return typeof v === "number" && key.toLowerCase().includes("cost") ? money(v) : String(v ?? "—"); } }))}
          rows={result}
        />
      )}
    </div>
  );
}
/* ================================================================
   ROOT APP
================================================================ */
export default function App() {
  const [user, setUser] = useState(null);
  const [nav, setNav] = useState("dashboard");
  const [woView, setWoView] = useState("list");
  const [assetView, setAssetView] = useState("list");
  const [pmView, setPmView] = useState("list");
  const [activeWoId, setActiveWoId] = useState(null);
  const [activeAssetId, setActiveAssetId] = useState(null);
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [editingPmId, setEditingPmId] = useState(null);
  const [editingTplId, setEditingTplId] = useState(null);
  const [pmPrefillAssetId, setPmPrefillAssetId] = useState(null);
  const [prefillMachineId, setPrefillMachineId] = useState(null);
  const [woInitialPriority, setWoInitialPriority] = useState(null);
  const [workOrders, setWorkOrders] = useState(seedWorkOrders());
  const [assets, setAssets] = useState(ASSETS_SEED);
  const [pmSchedules, setPmSchedules] = useState(PM_SCHEDULES_SEED);
  const [templates, setTemplates] = useState(CHECKLIST_TEMPLATES_SEED);
  const [reportsView, setReportsView] = useState("center");
  const [savedReports, setSavedReports] = useState([]);
  const [toast, setToast] = useState(null);

  function notify(msg) { setToast(msg); setTimeout(() => setToast(null), 2600); }

  if (!user) return <LoginScreen onAuthenticated={setUser} />;

  function handleNavigate(key) {
    setNav(key);
    if (key === "workorders") { setWoView("list"); setPrefillMachineId(null); setWoInitialPriority(null); }
    if (key === "assets") setAssetView("list");
    if (key === "pm") { setPmView("list"); setPmPrefillAssetId(null); }
    if (key === "reports") setReportsView("center");
  }
  function openWO(id) { setActiveWoId(id); setWoView("detail"); setNav("workorders"); }
  function filterWOPriority(priority, targetNav) {
    if (targetNav === "assets") { setNav("assets"); setAssetView("list"); return; }
    setWoInitialPriority(priority); setWoView("list"); setNav("workorders");
  }
  function updateWO(updated) { setWorkOrders((list) => list.map((w) => (w.id === updated.id ? updated : w))); }
  function createWO(wo) { setWorkOrders((list) => [wo, ...list]); setActiveWoId(wo.id); setWoView("detail"); setNav("workorders"); notify(`Work order ${wo.woNumber} created.`); }

  function openAsset(id) { setActiveAssetId(id); setAssetView("detail"); setNav("assets"); }
  function editAsset(id) { setEditingAssetId(id); setAssetView("edit"); }
  function updateAsset(updated) { setAssets((list) => list.map((a) => (a.id === updated.id ? updated : a))); }
  function saveAsset(asset, addAnother) {
    setAssets((list) => {
      const exists = list.some((a) => a.id === asset.id);
      return exists ? list.map((a) => (a.id === asset.id ? asset : a)) : [asset, ...list];
    });
    notify(`Asset ${asset.code} ${editingAssetId ? "updated" : "created"}.`);
    setEditingAssetId(null);
    if (addAnother) { setAssetView("create"); }
    else { setActiveAssetId(asset.id); setAssetView("detail"); }
  }
  function createWorkOrderForAsset(assetId) { setPrefillMachineId(assetId); setNav("workorders"); setWoView("create"); }

  function addPMFromAsset(assetId) { setPmPrefillAssetId(assetId); setEditingPmId(null); setNav("pm"); setPmView("create"); }
  function openPmCreate() { setEditingPmId(null); setPmPrefillAssetId(null); setPmView("create"); }
  function openPmEdit(id) { setEditingPmId(id); setPmView("edit"); }
  function togglePmActive(id) { setPmSchedules((list) => list.map((s) => s.id === id ? { ...s, isActive: !s.isActive } : s)); }
  function savePmSchedule(schedule, another) {
    setPmSchedules((list) => { const exists = list.some((s) => s.id === schedule.id); return exists ? list.map((s) => s.id === schedule.id ? schedule : s) : [schedule, ...list]; });
    notify(`PM schedule "${schedule.title}" ${editingPmId ? "updated" : "created"}.`);
    setEditingPmId(null);
    if (!another) setPmView("list");
  }
  function generatePmWorkOrder(schedule) {
    const asset = assets.find((a) => a.id === schedule.assetId);
    if (!asset) return;
    const now = Date.now();
    const wo = {
      id: "wo" + Math.random().toString(36).slice(2, 8), woNumber: `PLT001-WO-2026-${Math.floor(1200 + Math.random() * 800)}`,
      machine: { id: asset.id, name: asset.name, dept: asset.department, criticality: asset.criticality }, department: asset.department,
      type: "PM", priority: "P4", status: "New", impact: "none", estDowntime: { value: 2, unit: "Hours" },
      description: `Scheduled preventive maintenance: ${schedule.title}`, requestedBy: "PM Auto-Schedule", assignedTo: schedule.assignedTeam.map((id) => TECHNICIANS.find((t) => t.id === id)).filter(Boolean),
      photos: [], videos: [], createdAt: now,
      history: [{ status: "New", actor: "System", t: now, remarks: `Auto-generated from PM schedule "${schedule.title}"` }],
    };
    setWorkOrders((list) => [wo, ...list]);
    notify(`Work order ${wo.woNumber} generated from "${schedule.title}".`);
  }

  function openTemplateManager() { setPmView("templates"); }
  function openTemplateCreate() { setEditingTplId(null); setPmView("templateEditor"); }
  function openTemplateEdit(id) { setEditingTplId(id); setPmView("templateEditor"); }
  function saveTemplate(tpl) {
    setTemplates((list) => { const exists = list.some((t) => t.id === tpl.id); return exists ? list.map((t) => t.id === tpl.id ? tpl : t) : [tpl, ...list]; });
    notify(`Checklist template "${tpl.name}" saved.`);
    setPmView("templates");
  }

  const activeWo = workOrders.find((w) => w.id === activeWoId);
  const activeAsset = assets.find((a) => a.id === activeAssetId);
  const editingAsset = assets.find((a) => a.id === editingAssetId);

  return (
    <>
      <AppShell user={user} active={nav} onNavigate={handleNavigate}>
        {nav === "dashboard" && (
          <DashboardScreen
            user={user} workOrders={workOrders} assets={assets} pmSchedules={pmSchedules}
            onOpenWO={openWO} onOpenAsset={openAsset} onGoToWorkOrders={() => handleNavigate("workorders")}
            onFilterWOPriority={filterWOPriority} onQuickCreate={createWO} onGeneratePM={generatePmWorkOrder} onNotify={notify}
          />
        )}

        {nav === "workorders" && woView === "list" && <WorkOrderList workOrders={workOrders} onOpen={openWO} onCreate={() => setWoView("create")} initialPriority={woInitialPriority} />}
        {nav === "workorders" && woView === "create" && <RaiseWorkOrder onCancel={() => setWoView("list")} onCreated={createWO} prefillMachineId={prefillMachineId} />}
        {nav === "workorders" && woView === "detail" && activeWo && <WorkOrderDetail wo={activeWo} onBack={() => setWoView("list")} onUpdate={updateWO} />}

        {nav === "assets" && assetView === "list" && <AssetRegister assets={assets} onOpen={openAsset} onCreate={() => setAssetView("create")} />}
        {nav === "assets" && assetView === "create" && <AssetForm assets={assets} existing={null} onCancel={() => setAssetView("list")} onSave={saveAsset} />}
        {nav === "assets" && assetView === "edit" && editingAsset && <AssetForm assets={assets} existing={editingAsset} onCancel={() => setAssetView("detail")} onSave={saveAsset} />}
        {nav === "assets" && assetView === "detail" && activeAsset && (
          <AssetDetail
            asset={activeAsset} assets={assets} workOrders={workOrders} schedules={pmSchedules}
            onBack={() => setAssetView("list")} onEdit={() => editAsset(activeAsset.id)} onUpdate={updateAsset}
            onOpenWO={openWO} onCreateWO={createWorkOrderForAsset} onAddPM={addPMFromAsset} onNotify={notify}
          />
        )}

        {nav === "pm" && pmView === "list" && (
          <PMSchedulesModule schedules={pmSchedules} assets={assets} templates={templates} onOpenCreate={openPmCreate} onOpenEdit={openPmEdit} onToggleActive={togglePmActive} onGenerate={generatePmWorkOrder} onManageTemplates={openTemplateManager} />
        )}
        {nav === "pm" && (pmView === "create" || pmView === "edit") && (
          <PMForm existing={pmSchedules.find((s) => s.id === editingPmId)} assets={assets} templates={templates} prefillAssetId={pmPrefillAssetId} onCancel={() => setPmView("list")} onSave={savePmSchedule} onNewTemplate={openTemplateCreate} />
        )}
        {nav === "pm" && pmView === "templates" && (
          <ChecklistTemplateList templates={templates} onCreate={openTemplateCreate} onEdit={openTemplateEdit} onBack={() => setPmView("list")} />
        )}
        {nav === "pm" && pmView === "templateEditor" && (
          <ChecklistTemplateBuilder existing={templates.find((t) => t.id === editingTplId)} onCancel={() => setPmView("templates")} onSave={saveTemplate} />
        )}

        {nav === "reports" && reportsView === "center" && (
          <ReportsCenter workOrders={workOrders} assets={assets} pmSchedules={pmSchedules} savedReports={savedReports} onOpenWO={openWO} onOpenAsset={openAsset} onNotify={notify} onOpenBuilder={() => setReportsView("builder")} />
        )}
        {nav === "reports" && reportsView === "builder" && (
          <CustomReportBuilder workOrders={workOrders} assets={assets} onCancel={() => setReportsView("center")} onSaved={(r) => { setSavedReports((list) => [...list, r]); notify(`Custom view "${r.name}" saved.`); setReportsView("center"); }} />
        )}

        {!["dashboard", "workorders", "assets", "pm", "reports"].includes(nav) && (
          <div className="rise" style={{ padding: 60, textAlign: "center", color: T.inkSoft }}>
            <Boxes size={32} style={{ margin: "0 auto 14px", opacity: 0.4 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: T.ink, marginBottom: 4 }}>{NAV.find((n) => n.key === nav)?.label} module</div>
            <div style={{ fontSize: 13 }}>Not built yet — next up after Assets.</div>
          </div>
        )}
      </AppShell>
      <Toast message={toast} />
    </>
  );
}
