"use client";

import { useState } from "react";
import {
  CheckCircle2,
  PlayCircle,
  Send,
  RotateCcw,
  Ban,
  ThumbsUp,
  UserCheck,
  Truck,
  MapPin,
  Wrench,
  PackageSearch,
  FlaskConical,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  acceptWorkOrder,
  declineWorkOrder,
  startTravel,
  arriveOnSite,
  startRepair,
  markWaitingSparePart,
  resumeRepair,
  startTesting,
  testFailed,
  markCompleted,
  verifyAndClose,
  forceVerifyAndClose,
  reopenWorkOrder,
} from "../../lib/workOrders";
import { isAssigneeOf, isRequesterOf, isManagerOrAdmin } from "../../lib/constants";
import { describeError } from "../../lib/errors";
import { ROLES } from "../../lib/roles";
import Button from "../ui/Button";
import { inputClass } from "../ui/Field";

function InfoBox({ children }) {
  return <div className="bg-canvas rounded px-4 py-3 mb-4 text-[12.5px] text-ink-soft">{children}</div>;
}

/**
 * Layout note for the action rows below: the button pairs wrap, and each
 * reason-input row stacks its input above its confirm button under `sm`. Side by
 * side on a 360px screen the button took ~120px of a ~296px row, leaving the
 * input too narrow to read back a sentence the technician had just typed.
 */

export default function WorkflowPanel({ wo, onGotoAssign }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [declineReason, setDeclineReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [sparePartReason, setSparePartReason] = useState("");
  const [showSparePart, setShowSparePart] = useState(false);
  const [testFailReason, setTestFailReason] = useState("");
  const [showTestFail, setShowTestFail] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [showComplete, setShowComplete] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [showReopen, setShowReopen] = useState(false);

  const assignee = isAssigneeOf(wo, user);
  const requester = isRequesterOf(wo, user);
  const isSupervisorLike = user.role === ROLES.SUPERVISOR || isManagerOrAdmin(user);
  const actor = { uid: user.uid, name: user.name, role: user.role };

  async function run(fn, ...args) {
    setBusy(true);
    setError(null);
    try {
      await fn(wo.id, actor, ...args);
    } catch (e) {
      // The transition trigger and the column guards raise messages written for
      // the person who hit them ("a requester may not perform \"Assign
      // technician\"", "\"resolution_notes\" is required for \"Mark completed\"").
      // Those are far more useful than a generic connection warning.
      setError(describeError(e, "Not saved — try again."));
    } finally {
      setBusy(false);
    }
  }

  const ErrorLine = () => (error ? <div className="text-danger text-[12.5px] mb-2">{error}</div> : null);

  if (wo.status === "open") {
    if (isSupervisorLike)
      return (
        <div>
          <InfoBox>This work order needs a technician. Go to the Assignment tab to assign one.</InfoBox>
          <Button variant="amber" icon={UserCheck} onClick={onGotoAssign}>Assign a technician</Button>
        </div>
      );
    return <InfoBox>Waiting for a Supervisor to assign a technician.</InfoBox>;
  }

  if (wo.status === "assigned") {
    if (assignee) {
      return (
        <div>
          <InfoBox>You've been assigned this work order. Accept it to start, or decline with a reason so the Supervisor can reassign.</InfoBox>
          <ErrorLine />
          <div className="flex flex-wrap gap-2 mb-3">
            <Button variant="success" icon={CheckCircle2} disabled={busy} onClick={() => run(acceptWorkOrder)}>Accept</Button>
            <Button variant="danger" icon={Ban} onClick={() => setShowDecline((s) => !s)}>Decline</Button>
          </div>
          {showDecline && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason for declining…" className={`${inputClass} flex-1`} />
              <Button variant="danger" disabled={!declineReason || busy} onClick={async () => { await run(declineWorkOrder, declineReason); setShowDecline(false); }}>Confirm decline</Button>
            </div>
          )}
        </div>
      );
    }
    if (isSupervisorLike)
      return (
        <div>
          <InfoBox>Waiting for {wo.assigned_to_name || "the technician"} to accept.</InfoBox>
          <Button variant="ghost" icon={UserCheck} onClick={onGotoAssign}>Reassign</Button>
        </div>
      );
    return <InfoBox>Assigned to {wo.assigned_to_name || "a technician"} — waiting for them to accept.</InfoBox>;
  }

  if (wo.status === "accepted") {
    if (assignee)
      return (
        <div>
          <InfoBox>Accepted. Head to the equipment when you're ready.</InfoBox>
          <ErrorLine />
          <Button variant="amber" icon={Truck} disabled={busy} onClick={() => run(startTravel)}>On The Way</Button>
        </div>
      );
    return <InfoBox>{wo.assigned_to_name || "Technician"} has accepted and will head over shortly.</InfoBox>;
  }

  if (wo.status === "on_the_way") {
    if (assignee)
      return (
        <div>
          <InfoBox>En route. Mark arrival once you're at the equipment.</InfoBox>
          <ErrorLine />
          <Button variant="amber" icon={MapPin} disabled={busy} onClick={() => run(arriveOnSite)}>Arrived — On Site</Button>
        </div>
      );
    return <InfoBox>{wo.assigned_to_name || "Technician"} is on the way.</InfoBox>;
  }

  if (wo.status === "on_site") {
    if (assignee)
      return (
        <div>
          <InfoBox>On site. Start repair when you've assessed the issue.</InfoBox>
          <ErrorLine />
          <Button variant="amber" icon={Wrench} disabled={busy} onClick={() => run(startRepair)}>Start Repair</Button>
        </div>
      );
    return <InfoBox>{wo.assigned_to_name || "Technician"} is on site, assessing the issue.</InfoBox>;
  }

  if (wo.status === "repairing") {
    if (assignee) {
      return (
        <div>
          <InfoBox>Log progress in Comments as you work. If you need a part, mark it — otherwise move to testing once you believe it's fixed.</InfoBox>
          <ErrorLine />
          <div className="flex gap-2 mb-3 flex-wrap">
            <Button variant="ghost" icon={PackageSearch} onClick={() => setShowSparePart((s) => !s)}>Waiting Spare Part</Button>
            <Button variant="amber" icon={FlaskConical} disabled={busy} onClick={() => run(startTesting)}>Start Testing</Button>
          </div>
          {showSparePart && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={sparePartReason} onChange={(e) => setSparePartReason(e.target.value)} placeholder="Which part, and why?" className={`${inputClass} flex-1`} />
              <Button variant="ghost" disabled={!sparePartReason || busy} onClick={async () => { await run(markWaitingSparePart, sparePartReason); setShowSparePart(false); }}>Confirm</Button>
            </div>
          )}
        </div>
      );
    }
    return <InfoBox>{wo.assigned_to_name || "Technician"} is repairing the equipment.</InfoBox>;
  }

  if (wo.status === "waiting_spare_part") {
    if (assignee)
      return (
        <div>
          <InfoBox>Paused — waiting on a spare part.</InfoBox>
          <ErrorLine />
          <Button variant="amber" icon={PlayCircle} disabled={busy} onClick={() => run(resumeRepair)}>Part Received — Resume Repair</Button>
        </div>
      );
    return <InfoBox>Waiting on a spare part before repair can continue.</InfoBox>;
  }

  if (wo.status === "testing") {
    if (assignee) {
      return (
        <div>
          <InfoBox>Testing the fix. If it holds, mark completed; if not, send it back to repair.</InfoBox>
          <ErrorLine />
          <div className="flex gap-2 mb-3 flex-wrap">
            <Button variant="danger" icon={RotateCcw} onClick={() => setShowTestFail((s) => !s)}>Test Failed</Button>
            <Button variant="success" icon={CheckCircle2} onClick={() => setShowComplete((s) => !s)}>Mark Completed</Button>
          </div>
          {showTestFail && (
            <div className="flex flex-col gap-2 mb-3 sm:flex-row">
              <input value={testFailReason} onChange={(e) => setTestFailReason(e.target.value)} placeholder="What failed?" className={`${inputClass} flex-1`} />
              <Button variant="danger" disabled={!testFailReason || busy} onClick={async () => { await run(testFailed, testFailReason); setShowTestFail(false); }}>Back to Repair</Button>
            </div>
          )}
          {showComplete && (
            <div>
              <textarea value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} rows={3} placeholder="What did you do to fix it? (visible to requester)" className={`${inputClass} resize-y mb-2`} />
              <Button variant="success" icon={Send} disabled={!completionNotes || busy} onClick={async () => { await run(markCompleted, completionNotes); setShowComplete(false); }}>Submit for verification</Button>
            </div>
          )}
        </div>
      );
    }
    return <InfoBox>{wo.assigned_to_name || "Technician"} is testing the fix.</InfoBox>;
  }

  if (wo.status === "completed") {
    if (requester) {
      return (
        <div>
          <InfoBox>The technician marked this completed. Please verify the fix before it's closed.</InfoBox>
          <ErrorLine />
          <div className="flex flex-wrap gap-2 mb-3">
            <Button variant="success" icon={ThumbsUp} disabled={busy} onClick={() => run(verifyAndClose)}>Confirm fixed — Close</Button>
            <Button variant="danger" icon={RotateCcw} onClick={() => setShowReopen((s) => !s)}>Not fixed</Button>
          </div>
          {showReopen && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="What's still wrong?" className={`${inputClass} flex-1`} />
              <Button variant="danger" disabled={!reopenReason || busy} onClick={async () => { await run(reopenWorkOrder, reopenReason); setShowReopen(false); }}>Reopen</Button>
            </div>
          )}
        </div>
      );
    }
    if (isManagerOrAdmin(user))
      return (
        <div>
          <InfoBox>Awaiting requester verification. As {user.role === ROLES.ADMIN ? "Admin" : "Manager"} you can override and close directly if the requester is unresponsive.</InfoBox>
          <Button variant="ghost" icon={ThumbsUp} disabled={busy} onClick={() => run(forceVerifyAndClose)}>Force verify & close</Button>
        </div>
      );
    return <InfoBox>Waiting for the requester to verify the fix.</InfoBox>;
  }

  return <InfoBox>This work order is closed. Verified and archived — cost and history have been finalized.</InfoBox>;
}
