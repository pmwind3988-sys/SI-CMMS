"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, PauseCircle } from "lucide-react";
import { listenWorkOrderHistory } from "../../lib/workOrders";
import { STATUS_FLOW, STATUS_LABELS } from "../../lib/constants";
import { ErrorBanner } from "../ui/Surfaces";

function fmtTime(ts) {
  if (!ts?.toDate) return "just now";
  return ts.toDate().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function StatusTimeline({ wo }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = listenWorkOrderHistory(wo.id, setHistory, () => setError("Couldn't load the full history — try again."));
    return unsub;
  }, [wo.id]);

  const flowIndex = STATUS_FLOW.indexOf(wo.status);
  const lastEvent = history && history.length ? history[history.length - 1] : null;

  return (
    <div>
      {error && <ErrorBanner message={error} />}
      {STATUS_FLOW.map((s, i) => {
        const event = (history || []).find((h) => h.to_status === s);
        const done = i <= flowIndex;
        const isCurrent = s === wo.status;
        return (
          <div key={s} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <div
                className="rounded-full flex items-center justify-center"
                style={{ background: done ? (isCurrent ? "#F59E0B" : "#22C55E") : "#E7EAEE", border: isCurrent ? "2px solid #F59E0B" : "none", width: 22, height: 22 }}
              >
                {done && !isCurrent && <CheckCircle2 size={13} className="text-white" />}
              </div>
              {i < STATUS_FLOW.length - 1 && <div className="w-0.5 flex-1 min-h-[28px]" style={{ background: i < flowIndex ? "#22C55E" : "#E7EAEE" }} />}
            </div>
            <div className="pb-5.5">
              <div className="text-[13.5px]" style={{ fontWeight: isCurrent ? 700 : 500, color: done ? "#101828" : "#64748B" }}>
                {STATUS_LABELS[s]}
              </div>
              {event ? (
                <div className="text-[12px] text-ink-soft mt-0.5">
                  {event.actor_name} · {fmtTime(event.created_at)}
                  {event.remarks && <div className="mt-0.5 text-ink">{event.remarks}</div>}
                </div>
              ) : (
                <div className="text-[12px] text-[#B7BEC6] mt-0.5">Pending</div>
              )}
            </div>
          </div>
        );
      })}
      {wo.status === "waiting_spare_part" && (
        <div className="flex items-center gap-2 bg-[#FCE9E9] rounded px-3.5 py-2.5 text-[12.5px] text-danger mt-1">
          <PauseCircle size={15} /> {lastEvent?.remarks || "Waiting on a spare part"}
        </div>
      )}
    </div>
  );
}
