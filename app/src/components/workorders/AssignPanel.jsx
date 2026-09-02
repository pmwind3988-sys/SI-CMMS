"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, UserCheck, Send, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { assignTechnician, reassignTechnician, listenTechnicians } from "../../lib/workOrders";
import { canAssign } from "../../lib/constants";
import { describeError } from "../../lib/errors";
import { useReferenceData } from "../../lib/referenceData";
import Button from "../ui/Button";
import { Card, ModalOverlay } from "../ui/Surfaces";

/**
 * The roster comes from the technicians table rather than the frozen
 * TECHNICIANS array that used to live in lib/constants.js. That array held
 * placeholder slugs ("tech-arun"); work_orders.assigned_to_id is now a uuid
 * foreign key onto users(id), so a slug cannot be assigned at all. This closes
 * README open item #3 for the assignment path.
 */
/**
 * The statuses a reassignment routes back through `assigned` from, so the new
 * technician accepts afresh. Mirrors PRE_ACCEPTANCE_STATUSES in lib/workOrders
 * — this copy exists only to word the receipt dialog correctly, and the two say
 * the same thing about the same rule, so change them together.
 */
const PRE_ACCEPTANCE = ["open", "assigned"];

export default function AssignPanel({ wo }) {
  const { user } = useAuth();
  const { statusLabel } = useReferenceData();
  const [technicians, setTechnicians] = useState(null);
  /**
   * WHICH technician is being assigned, not merely that one is.
   *
   * A plain boolean disabled every button in the roster and put a spinner on
   * none of them, so the press you actually made produced no visible response
   * at all — on a slow connection the button read as dead, and the only signal
   * that anything had happened was the row turning amber a round trip later
   * when Realtime delivered the change back. Holding the id lets the pressed
   * button say "Assigning…" while the rest simply go quiet.
   */
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState(null);
  /** Set on success: { name, status } — the receipt dialog below. */
  const [sent, setSent] = useState(null);
  const allowed = canAssign(user);
  const busy = pendingId !== null;

  useEffect(() => {
    // The roster is an inner join onto `users`, and only Supervisor+ may read
    // that table (users_select, migration 0020). For a Requester or Technician
    // the query would come back empty and read as "no technicians exist" — and
    // they cannot assign anyway, so don't ask the question.
    if (!allowed) return undefined;
    const unsub = listenTechnicians(setTechnicians, () =>
      setError("Couldn't load the technician roster.")
    );
    return unsub;
  }, [allowed]);

  // You cannot assign a work order to yourself — si_guard_work_order_transition
  // refuses it (migration 0020), above the admin bypass, so this holds for every
  // role. Removing yourself from the roster makes the rule visible instead of
  // something discovered as an error after choosing a name.
  //
  // Only ever non-empty for a multi-role account: a plain Supervisor has no
  // technicians row and was never in this list to begin with.
  const roster = (technicians || []).filter((t) => t.user_id !== user?.uid);

  const bestMatch = roster.filter((t) =>
    (t.skills || []).some(
      (s) =>
        wo.department_id?.toLowerCase().includes(s.toLowerCase()) ||
        wo.asset_name?.toLowerCase().includes(s.toLowerCase())
    )
  );

  async function handleAssign(t) {
    setPendingId(t.user_id);
    setError(null);
    try {
      // No actor argument: si_transition_work_order derives the acting user from
      // the session, so the history row can't disagree with who is signed in.
      const technician = { id: t.user_id, name: t.name };
      const handover = !!wo.assigned_to_id;
      if (handover) {
        await reassignTechnician(wo.id, wo.status, technician);
      } else {
        await assignTechnician(wo.id, technician);
      }
      /* The status the work order is in AFTER the move, which is what decides
         whether the technician has an Accept step waiting. A pre-acceptance
         reassignment re-enters `assigned`; one at `accepted` or later keeps the
         status it had (FSD Business Rule 6, and reassignTechnician mirrors it).
         Read from the row we already have rather than waiting for Realtime, so
         the dialog is right the moment it opens. */
      const landedOn = !handover || PRE_ACCEPTANCE.includes(wo.status) ? "assigned" : wo.status;
      setSent({ name: t.name, status: landedOn, handover });
    } catch (e) {
      setError(
        describeError(
          e,
          "Couldn't assign — this work order may have just been updated. Refresh and try again."
        )
      );
    } finally {
      setPendingId(null);
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
      {error && <div className="text-danger-text text-[12.5px] mb-3">{error}</div>}
      {allowed && technicians === null && (
        <div className="text-[12.5px] text-ink-soft">Loading technicians…</div>
      )}
      {allowed && technicians !== null && roster.length === 0 && (
        <div className="bg-canvas rounded px-3.5 py-2.5 text-[12.5px] text-ink-soft">
          Nobody is available to assign. An account has to hold the Technician role and be active
          to appear here — check Admin → Users. Someone whose Technician role was revoked keeps
          their skills on file but can no longer be assigned work.
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
                      <span className="bg-[#E7F5EE] text-good-text text-[10.5px] rounded px-1.5 py-0.5 ml-1.5 font-bold">
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
                  // Only the pressed row spins. The others are disabled without
                  // a spinner, so the screen shows one thing happening rather
                  // than four.
                  loading={pendingId === t.user_id}
                  // "Assigned" is a state, not an action. Left clickable it
                  // reassigned the technician to themselves: the assigned ->
                  // assigned row permits it (requires_assignee_change is false
                  // pre-acceptance), so the database accepted a no-op that still
                  // wrote a history row and re-notified the technician.
                  disabled={busy || isAssigned}
                  onClick={() => handleAssign(t)}
                >
                  {pendingId === t.user_id
                    ? wo.assigned_to_id
                      ? "Reassigning…"
                      : "Assigning…"
                    : isAssigned
                      ? "Assigned"
                      : wo.assigned_to_id
                        ? "Reassign"
                        : "Assign"}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {sent && <SentDialog {...sent} wo={wo} statusLabel={statusLabel} onClose={() => setSent(null)} />}
    </div>
  );
}

/**
 * The receipt: what was sent, to whom, and what happens next.
 *
 * A dialog rather than a toast, and rather than nothing. Assignment is the
 * moment responsibility for a fault transfers to a named person, and until now
 * the only confirmation was the roster row turning amber — which arrives a
 * round trip later over Realtime, and on a phone may well be off-screen. A
 * modal is also the honest shape for something that has already happened and
 * cannot be undone from here.
 *
 * The two wordings are not decoration. A pre-acceptance assignment leaves an
 * Accept step waiting for the technician, and they can decline it — which sends
 * the work order back to this queue, so the person who just assigned it needs
 * to know that is possible. A handover at `accepted` or later has no Accept step
 * (FSD Business Rule 6: ownership changes, the flow does not restart), so
 * promising one would send them looking for a button the workflow will never
 * offer. Migration 0052 makes the notification itself say the same two things.
 */
function SentDialog({ name, status, handover, wo, statusLabel, onClose }) {
  const needsAccept = status === "assigned";
  return (
    <ModalOverlay onClose={onClose} label="Request sent" className="p-4">
      <Card className="rise w-full max-w-md p-4 sm:p-5">
        <div className="mb-3.5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#E7F5EE]">
              <Send size={15} className="text-good-text" />
            </span>
            <h2 className="text-[15.5px] font-bold text-ink">Request sent to {name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <p className="mb-3.5 text-[13px] leading-relaxed text-ink-soft">
          <strong className="font-mono text-ink">{wo.wo_number || "This work order"}</strong> —{" "}
          {wo.asset_name} {handover ? "has been handed to" : "is now assigned to"}{" "}
          <strong className="text-ink">{name}</strong>. They have been notified in the app.
        </p>

        <div className="mb-4 rounded bg-canvas px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-soft">
          {needsAccept ? (
            <>
              <strong className="text-ink">What happens next:</strong> {name} accepts the job to
              start it, or declines it with a reason — a decline sends it back here as unassigned
              for you to re-triage, and you&apos;ll be notified if that happens.
            </>
          ) : (
            <>
              <strong className="text-ink">What happens next:</strong> the work order stays at{" "}
              <strong className="text-ink">{statusLabel(status)}</strong> and carries on from where
              it was — there is no acceptance step, because the work is already under way.{" "}
              {name} picks it up from here.
            </>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </Card>
    </ModalOverlay>
  );
}
