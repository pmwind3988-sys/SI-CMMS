"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Timer, PencilLine } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { listenWorkOrder } from "../../lib/workOrders";
import { SLA_MATRIX, IMPACT_OPTIONS, fmtDue, departmentById, canEditWhileOpen } from "../../lib/constants";
import { PriorityBadge, StatusBadge } from "../ui/Badges";
import { Card, ErrorBanner } from "../ui/Surfaces";
import Button from "../ui/Button";
import AssignPanel from "./AssignPanel";
import CommentsPanel from "./CommentsPanel";
import AttachmentsPanel from "./AttachmentsPanel";
import StatusTimeline from "./StatusTimeline";
import WorkflowPanel from "./WorkflowPanel";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "assignment", label: "Assignment" },
  { key: "comments", label: "Comments" },
  { key: "attachments", label: "Attachments" },
  { key: "timeline", label: "Status Timeline" },
  { key: "workflow", label: "Workflow" },
];

export default function WorkOrderDetail({ woId }) {
  const { user } = useAuth();
  const router = useRouter();
  const [wo, setWo] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    const unsub = listenWorkOrder(woId, setWo, () => setError("This work order couldn't be found or you no longer have access to it."));
    return unsub;
  }, [woId]);

  if (error) {
    return (
      <div className="max-w-md">
        <ErrorBanner message={error} />
        <button onClick={() => router.push("/work-orders")} className="text-navy text-[13px] font-semibold">
          ← Back to Work Orders
        </button>
      </div>
    );
  }

  if (wo === undefined) return <div className="text-ink-soft text-[13px]">Loading…</div>;
  if (wo === null) return null;

  const createdMs = wo.created_at ? new Date(wo.created_at).getTime() : Date.now();
  const remain = wo.priority ? SLA_MATRIX[wo.priority].resolutionMs - (Date.now() - createdMs) : null;
  const breached = remain != null && remain < 0 && wo.status !== "closed";
  const showEdit = wo.status === "open" && canEditWhileOpen(wo, user);

  return (
    <div className="max-w-5xl">
      <button onClick={() => router.push("/work-orders")} className="flex items-center gap-1.5 text-ink-soft text-[13px] mb-3.5">
        <ArrowLeft size={15} /> Back to Work Orders
      </button>

      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2.5">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[13px] text-ink-soft">{wo.wo_number || "Pending…"}</span>
            <PriorityBadge p={wo.priority} />
            <StatusBadge s={wo.status} />
          </div>
          <h1 className="text-xl font-bold text-ink mt-1.5">{wo.asset_name}</h1>
        </div>
        <div className="flex items-center gap-2.5">
          {showEdit && (
            <Button variant="ghost" icon={PencilLine} onClick={() => router.push(`/work-orders/edit?id=${woId}`)}>
              Edit
            </Button>
          )}
          <div className="flex items-center gap-2 rounded px-3.5 py-2.5" style={{ background: breached ? "#FCE9E9" : "#F6F8FB" }}>
            <Timer size={15} className={breached ? "text-danger" : "text-ink-soft"} />
            <div>
              <div className="text-[11px] text-ink-soft">Resolution SLA</div>
              <div className="font-mono text-[13px] font-bold" style={{ color: breached ? "#EF4444" : "#101828" }}>
                {wo.status === "closed" ? "Closed" : breached ? "Breached" : remain != null ? fmtDue(remain) + " left" : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border mb-5 mt-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-4 py-2.5 text-[13.5px] font-semibold whitespace-nowrap"
            style={{ color: tab === t.key ? "#101828" : "#64748B", borderBottom: tab === t.key ? "2.5px solid #F59E0B" : "2.5px solid transparent" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-6">
        {tab === "overview" && <OverviewTab wo={wo} />}
        {tab === "assignment" && <AssignPanel wo={wo} />}
        {tab === "comments" && <CommentsPanel wo={wo} />}
        {tab === "attachments" && <AttachmentsPanel wo={wo} />}
        {tab === "timeline" && <StatusTimeline wo={wo} />}
        {tab === "workflow" && <WorkflowPanel wo={wo} onGotoAssign={() => setTab("assignment")} />}
      </Card>
    </div>
  );
}

function OverviewTab({ wo }) {
  const rows = [
    ["Equipment", wo.asset_name],
    ["Department", departmentById(wo.department_id)?.name || wo.department_id],
    ["Type", wo.type],
    ["Production impact", IMPACT_OPTIONS.find((i) => i.value === wo.impact)?.label || "—"],
    ["Estimated downtime", `${wo.est_downtime_value} ${wo.est_downtime_unit}`],
    ["Requested by", wo.requester_name],
    ["Requester phone", wo.requester_phone || "—"],
    ["Safety risk", wo.safety_risk?.flag ? `Yes (${wo.safety_risk.severity})` : "No"],
    ["Environmental risk", wo.environmental_risk?.flag ? "Yes" : "No"],
    ["Permit / LOTO required", wo.permit_required ? "Yes" : "No"],
  ];
  return (
    <div className="flex gap-8 flex-wrap">
      <div className="flex-1 min-w-[280px]">
        {rows.map(([label, val]) => (
          <div key={label} className="flex justify-between py-2.5 border-b border-[#F1F3F5] text-[13.5px]">
            <span className="text-ink-soft">{label}</span>
            <span className="text-ink font-medium text-right">{val}</span>
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-[280px]">
        <div className="text-[12.5px] font-semibold text-ink mb-2">Complaint</div>
        <p className="text-[13.5px] text-ink leading-relaxed mb-5">{wo.description}</p>
        <div className="bg-canvas rounded p-3.5">
          <div className="text-[12px] font-bold text-ink mb-2.5">SLA targets ({wo.priority})</div>
          {wo.priority &&
            [
              ["Acknowledge", SLA_MATRIX[wo.priority].ack],
              ["Response", SLA_MATRIX[wo.priority].response],
              ["Resolution", SLA_MATRIX[wo.priority].resolution],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between text-[12.5px] py-1">
                <span className="text-ink-soft">{l}</span>
                <span className="font-mono font-semibold text-ink">{v}</span>
              </div>
            ))}
        </div>
        {wo.resolution_notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-[12px] font-bold text-good mb-1.5">Resolution notes</div>
            <div className="text-[13px] text-ink leading-relaxed">{wo.resolution_notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
