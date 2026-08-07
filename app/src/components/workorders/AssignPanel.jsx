"use client";

import { useState } from "react";
import { CheckCircle2, UserCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { assignTechnician, reassignTechnician } from "../../lib/workOrders";
import { TECHNICIANS, canAssign } from "../../lib/constants";
import Button from "../ui/Button";

export default function AssignPanel({ wo }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const allowed = canAssign(user);

  const bestMatch = TECHNICIANS.filter((t) => t.skills.some((s) => wo.department_id?.toLowerCase().includes(s.toLowerCase()) || wo.asset_name?.toLowerCase().includes(s.toLowerCase())));

  async function handleAssign(t) {
    setBusy(true);
    setError(null);
    try {
      const actor = { uid: user.uid, name: user.name, role: user.role };
      if (wo.assigned_to_id) {
        await reassignTechnician(wo.id, wo.status, t, actor);
      } else {
        await assignTechnician(wo.id, t, actor);
      }
    } catch (e) {
      setError("Couldn't assign — this work order may have just been updated. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }

  const disabledForStatus = ["completed", "verified", "closed"].includes(wo.status);

  return (
    <div>
      <div className="text-[13px] text-ink-soft mb-3.5">
        Currently assigned: {wo.assigned_to_name ? <strong className="text-ink">{wo.assigned_to_name}</strong> : "Unassigned — waiting on Supervisor"}
      </div>
      {!allowed && (
        <div className="bg-canvas rounded px-3.5 py-2.5 text-[12.5px] text-ink-soft mb-3.5">
          Only a Supervisor (within their department), Manager, or Admin can assign or reassign a technician.
        </div>
      )}
      {error && <div className="text-danger text-[12.5px] mb-3">{error}</div>}
      <div className="flex flex-col gap-2">
        {TECHNICIANS.map((t) => {
          const isAssigned = wo.assigned_to_id === t.id;
          const isBest = bestMatch.some((b) => b.id === t.id);
          return (
            <div key={t.id} className="flex items-center justify-between px-3.5 py-2.5 rounded border" style={{ borderColor: isAssigned ? "#F59E0B" : "#E5E9F0", background: isAssigned ? "#FDE7C4" : "#fff" }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center text-[12px] font-bold">
                  {t.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <div>
                  <div className="text-[13.5px] text-ink font-medium">
                    {t.name} {isBest && <span className="bg-[#E7F5EE] text-good text-[10.5px] rounded px-1.5 py-0.5 ml-1.5 font-bold">Best match</span>}
                  </div>
                  <div className="text-[11.5px] text-ink-soft">{t.skills.join(" · ")} — {t.load} open jobs</div>
                </div>
              </div>
              {allowed && !disabledForStatus && (
                <Button size="sm" variant={isAssigned ? "success" : "ghost"} icon={isAssigned ? CheckCircle2 : UserCheck} disabled={busy} onClick={() => handleAssign(t)}>
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
