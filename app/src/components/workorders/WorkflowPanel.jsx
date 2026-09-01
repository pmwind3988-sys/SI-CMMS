"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  PlayCircle,
  Send,
  RotateCcw,
  Ban,
  ThumbsUp,
  UserCheck,
  Wrench,
  PackageSearch,
  FlaskConical,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  acceptWorkOrder,
  declineWorkOrder,
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
import { isAssigneeOf, raisedBy, isManagerOrAdmin } from "../../lib/constants";
import { useReferenceData } from "../../lib/referenceData";
import { nextStep } from "../../lib/nextStep";
import { describeError } from "../../lib/errors";
import { ROLES, hasRole } from "../../lib/roles";
import { handoffToast } from "../../lib/toastHandoff";
import Button from "../ui/Button";
import { ModalOverlay, Toast } from "../ui/Surfaces";
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

/**
 * What happens next, and whose move it is.
 *
 * Sits above every branch below rather than inside any of them, which is the
 * point: the InfoBox in each branch explains the STATE the work order is in,
 * and this names the next MOVE and who is being waited on. Those are different
 * questions, and only the second one is missing on the screens where a reader
 * is a spectator — a Requester looking at a job in Repairing gets a sentence
 * about repairs happening and nothing at all about what has to happen for it
 * to reach them.
 *
 * Amber when it is yours, grey when it is somebody else's. That contrast is
 * most of the value here: "is this waiting on me right now?" is the question,
 * and it should be answerable without reading.
 */
function NextStepLine({ wo }) {
  const { user } = useAuth();
  const { transitions, statuses } = useReferenceData();
  const statusOrder = useMemo(
    () => new Map(statuses.map((s) => [s.code, s.sort_order])),
    [statuses]
  );
  const step = nextStep(wo, user, transitions, statusOrder);
  if (!step) return null;
  return (
    <div
      className={`mb-3 rounded px-3 py-2 text-[12.5px] ${
        step.isYours
          ? "bg-[#FEF3C7] text-[#92400E] font-semibold"
          : "bg-canvas text-ink-soft"
      }`}
    >
      {step.text}
    </div>
  );
}

export default function WorkflowPanel(props) {
  return (
    <div>
      <NextStepLine wo={props.wo} />
      <WorkflowActions {...props} />
    </div>
  );
}

function WorkflowActions({ wo, onGotoAssign }) {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [declineReason, setDeclineReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [toast, setToast] = useState(null);
  const [sparePartReason, setSparePartReason] = useState("");
  const [showSparePart, setShowSparePart] = useState(false);
  const [testFailReason, setTestFailReason] = useState("");
  const [showTestFail, setShowTestFail] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [showComplete, setShowComplete] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [showReopen, setShowReopen] = useState(false);

  const assignee = isAssigneeOf(wo, user);
  const requester = raisedBy(wo, user);
  const isSupervisorLike = hasRole(user, ROLES.SUPERVISOR) || isManagerOrAdmin(user);
  const actor = { uid: user.uid, name: user.name, role: user.role };

  /** Returns whether the transition went through, for the callers that have to
      leave the page afterwards — see the decline below. */
  async function run(fn, ...args) {
    setBusy(true);
    setError(null);
    try {
      await fn(wo.id, actor, ...args);
      return true;
    } catch (e) {
      // The transition trigger and the column guards raise messages written for
      // the person who hit them ("a requester may not perform \"Assign
      // technician\"", "\"resolution_notes\" is required for \"Mark completed\"").
      // Those are far more useful than a generic connection warning.
      setError(describeError(e, "Not saved — try again."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const ErrorLine = () => (error ? <div className="text-danger-text text-[12.5px] mb-2">{error}</div> : null);

  /* Matches the dismissal used in UsersAdmin and SettingsAdmin — Toast has no
     timer of its own, deliberately, so each caller owns the lifetime. */
  function flash(message) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

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
          {/* Accept and Decline are NOT a matched pair, and they used to be
              drawn as one: same size (99x40 and 101x40), same tinted
              treatment, 12px apart, on a phone held in a gloved hand. Accept
              happens dozens of times a day; Decline hands the job back,
              notifies every Supervisor, Manager and Administrator, and cannot
              be undone from this screen. Giving them equal weight invites the
              mis-tap whose cost is entirely one-sided.

              So Accept is now the filled, full-width, 48px primary action and
              Decline is a quiet control beneath it, separated by a rule rather
              than by 12px of gap. Decline keeps its typed reason and its
              confirmation step. */}
          <div className="mb-3 flex flex-col gap-3">
            <Button
              variant="successSolid"
              size="lg"
              icon={CheckCircle2}
              className="w-full justify-center"
              disabled={busy}
              onClick={async () => {
                const ok = await run(acceptWorkOrder);
                /* Accept keeps the technician on the row, and the panel visibly
                   re-renders into the accepted state — but that redraw is easy to
                   miss on a phone held at arm's length next to a machine, and
                   tapping twice because nothing seemed to happen is how a
                   technician ends up unsure whether the job is theirs. */
                if (ok) flash("Accepted — " + (wo.wo_number || "work order") + " is yours.");
              }}
            >
              {busy ? "Accepting…" : "Accept this job"}
            </Button>

            <div className="flex items-center justify-center border-t border-border pt-3">
              <Button
                variant="ghost"
                size="sm"
                icon={Ban}
                aria-expanded={showDecline}
                onClick={() => setShowDecline((v) => !v)}
              >
                Can&rsquo;t take this one
              </Button>
            </div>
          </div>
          {showDecline && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Reason for declining…" className={`${inputClass} flex-1`} />
              <Button variant="danger" disabled={!declineReason.trim() || busy} onClick={() => setConfirmDecline(true)}>Confirm decline</Button>
            </div>
          )}

          {/* Decline is the one transition that ends outside the caller's own
              scope, cannot be undone from this screen, and puts the job back on
              somebody else's desk — so it gets the extra step that Accept does
              not, and reads the typed reason back before it goes. */}
          {confirmDecline && (
            <ModalOverlay onClose={() => setConfirmDecline(false)} label={`Decline ${wo.wo_number || "this work order"}`}>
              <div className="bg-white rounded-t-xl sm:rounded-xl w-full sm:max-w-sm p-5">
                <h2 className="text-[15px] font-bold text-ink mb-1.5">Decline {wo.wo_number}?</h2>
                <p className="text-[12.5px] text-ink-soft mb-3">
                  It goes back to the queue for a Supervisor to reassign, and leaves your list. Your Supervisor, the Managers and the Administrators are told, with your reason.
                </p>
                <div className="bg-canvas rounded px-3 py-2 mb-4 text-[12.5px] text-ink italic">“{declineReason.trim()}”</div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDecline(false)}>Keep it</Button>
                  <Button variant="danger" size="sm" icon={Ban} disabled={busy} onClick={async () => {
                    const ok = await run(declineWorkOrder, declineReason.trim());
                    setConfirmDecline(false);
                    setShowDecline(false);
                    /* A decline hands the work order back to the Supervisor and
                       clears the assignee, so work_orders_select stops returning it
                       to the technician who declined — and Realtime stops delivering
                       its changes too, since it filters by the same policy. Staying
                       here would leave the last row this component saw frozen on
                       screen, still offering Accept on a job that is no longer
                       theirs. So the technician goes back to their list, where it is
                       correctly absent.

                       Which is also why the confirmation cannot be a toast in
                       this component: it unmounts. The message is handed to the
                       destination page through sessionStorage instead — see
                       takeHandoffToast() in lib/toastHandoff.js. */
                    if (ok) {
                      handoffToast(`Declined — ${wo.wo_number} sent back for reassignment.`);
                      router.push("/work-orders/");
                    }
                  }}>{busy ? "Declining…" : "Decline it"}</Button>
                </div>
              </div>
            </ModalOverlay>
          )}
          <Toast message={toast} />
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

  /* Migration 0039 removed the On The Way and On Site rungs, so Accepted leads
     straight here. The two branches that sat between them are gone with the
     matrix rows they wrote against — leaving them would have left buttons the
     transition guard refuses. */
  if (wo.status === "accepted") {
    if (assignee)
      return (
        <div>
          <InfoBox>Accepted. Start work once you're at the equipment.</InfoBox>
          <ErrorLine />
          <Button variant="amber" icon={Wrench} disabled={busy} onClick={() => run(startRepair)}>Start Work</Button>
        </div>
      );
    return <InfoBox>{wo.assigned_to_name || "Technician"} has accepted and will start shortly.</InfoBox>;
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
    /* Only reached when somebody ELSE raised this work order — the branch above
       has already taken every case where the reader raised it themselves,
       whatever roles they hold. That ordering is the fix in migration 0040: an
       Administrator who reports a fault used to fall through to here and be
       offered an override on their own job, stamping the history
       "Force-verified — requester unresponsive" about somebody standing right
       there. Overriding an unresponsive requester and being the requester are
       different acts, and the audit trail has to tell them apart. */
    if (isManagerOrAdmin(user))
      return (
        <div>
          <InfoBox>Awaiting verification by {wo.requester_name || "the requester"}. As {hasRole(user, ROLES.ADMIN) ? "Admin" : "Manager"} you can override and close directly if they are unresponsive.</InfoBox>
          <ErrorLine />
          <Button variant="ghost" icon={ThumbsUp} disabled={busy} onClick={() => run(forceVerifyAndClose)}>Force verify & close</Button>
        </div>
      );
    return <InfoBox>Waiting for {wo.requester_name || "the requester"} to verify the fix.</InfoBox>;
  }

  return <InfoBox>This work order is closed. Verified and archived — cost and history have been finalized.</InfoBox>;
}
