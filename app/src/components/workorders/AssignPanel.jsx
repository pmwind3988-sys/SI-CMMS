"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, UserCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { assignTechnician, reassignTechnician, listenTechnicians } from "../../lib/workOrders";
import { canAssign } from "../../lib/constants";
import { describeError } from "../../lib/errors";
import Button from "../ui/Button";

/**
 * The roster comes from the technicians table rather than the frozen
 * TECHNICIANS array that used to live in lib/constants.js. That array held
 * placeholder slugs ("tech-arun"); work_orders.assigned_to_id is now a uuid
 * foreign key onto users(id), so a slug cannot be assigned at all. This closes
 * README open item #3 for the assignment path.
 */
export default function AssignPanel({ wo }) {
  const { user } = useAuth();
  const [technicians, setTechnicians] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const allowed = canAssign(user);

  useEffect(() => {
    const unsub = listenTechnicians(setTechnicians, () =>
      setError("Couldn't load the technician roster.")
    );
    return unsub;
  }, []);

  const roster = technicians || [];

  const bestMatch = roster.filter((t) =>
    (t.skills || []).some(
      (s) =>
        wo.department_id?.toLowerCase().includes(s.toLowerCase()) ||
        wo.asset_name?.toLowerCase().includes(s.toLowerCase())
    )
  );

  async function handleAssign(t) {
    setBusy(true);
    setError(null);
    try {
      // No actor argument: si_transition_work_order derives the acting user from
      // the session, so the history row can't disagree with who is signed in.
      const technician = { id: t.user_id, name: t.name };
      if (wo.assigned_to_id) {
        await reassignTechnician(wo.id, wo.status, technician);
      } else {
        await assignTechnician(wo.id, technician);
      }
    } catch (e) {
      setError(
        describeError(
          e,
          "Couldn't assign — this work order may have just been updated. Refresh and try again."
        )
      );
    } finally {
      setBusy(false);
    }
  }

  const disabledForStatus = ["completed", "verified", "closed"].includes(wo.status);

  return (
    <div>
      <div className="text-[13px] text-ink-soft mb-3.5">
        Currently assigned:{" "}
        {wo.assigned_to_name ? (
          <strong className="text-ink">{wo.assigned_to_name}</strong>
        ) : (
          "Unassigned — waiting on Supervisor"
        )}
      </div>
      {!allowed && (
        <div className="bg-canvas rounded px-3.5 py-2.5 text-[12.5px] text-ink-soft mb-3.5">
          Only a Supervisor (within their department), Manager, or Admin can assign or reassign a technician.
        </div>
      )}
      {error && <div className="text-danger text-[12.5px] mb-3">{error}</div>}
      {technicians === null && (
        <div className="text-[12.5px] text-ink-soft">Loading technicians…</div>
      )}
      {technicians !== null && roster.length === 0 && (
        <div className="bg-canvas rounded px-3.5 py-2.5 text-[12.5px] text-ink-soft">
          No technicians have been provisioned yet. An Administrator needs to create technician
          accounts before work orders can be assigned.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {roster.map((t) => {
          const isAssigned = wo.assigned_to_id === t.user_id;
          const isBest = bestMatch.some((b) => b.user_id === t.user_id);
          return (
            <div
              key={t.user_id}
              // Wraps rather than overflowing: a technician with three skills
              // listed plus an Assign button needs more than a phone's width.
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5 rounded border"
              style={{
                borderColor: isAssigned ? "#F59E0B" : "#E5E9F0",
                background: isAssigned ? "#FDE7C4" : "#fff",
              }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-8 h-8 flex-shrink-0 rounded-full bg-navy text-white flex items-center justify-center text-[12px] font-bold">
                  {(t.name || "?")
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div className="min-w-0">
                  <div className="text-[13.5px] text-ink font-medium">
                    {t.name}{" "}
                    {isBest && (
                      <span className="bg-[#E7F5EE] text-good text-[10.5px] rounded px-1.5 py-0.5 ml-1.5 font-bold">
                        Best match
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-ink-soft">
                    {(t.skills || []).join(" · ")} — {t.current_load ?? 0} open jobs
                  </div>
                </div>
              </div>
              {allowed && !disabledForStatus && (
                <Button
                  size="sm"
                  variant={isAssigned ? "success" : "ghost"}
                  icon={isAssigned ? CheckCircle2 : UserCheck}
                  // "Assigned" is a state, not an action. Left clickable it
                  // reassigned the technician to themselves: the assigned ->
                  // assigned row permits it (requires_assignee_change is false
                  // pre-acceptance), so the database accepted a no-op that still
                  // wrote a history row and re-notified the technician.
                  disabled={busy || isAssigned}
                  onClick={() => handleAssign(t)}
                >
                  {isAssigned ? "Assigned" : wo.assigned_to_id ? "Reassign" : "Assign"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
