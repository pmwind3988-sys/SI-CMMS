"use client";

/**
 * SI — Service Inside · Extending a work order's SLA
 * (migration 0072, corrected by 0073, second mode added by 0075)
 *
 * A confirm dialog, not a form. The decision it collects is "yes, give this
 * work order more time", and the arithmetic behind it — which priority, how
 * much longer, and whether that is even enough — is worked out before the
 * dialog opens and shown rather than asked.
 *
 * Since 0075 the list holds two kinds of thing, and the labels say which
 * rather than leaving the reader to infer it from a priority code: "Another 7
 * days, still Long-term (P7)" tops the stage up in place, "Re-grade to
 * Scheduled (P8)" moves the work order. The top-up leads, because it is the
 * answer that changes least about a work order whose grading nobody disputes.
 *
 * Four things here are deliberate:
 *
 *  - **No reason field.** Every other deliberate act on this schema carries a
 *    typed reason, and this one does not, because it is a two-tap action on a
 *    phone beside a machine. A ten-character floor on a confirm dialog produces
 *    "asdfasdfasdf", which is worse evidence than the sentence the server
 *    generates naming both priorities, the stage and the new deadline.
 *  - **The disclaimer is above the button, not after it.** What is recorded and
 *    who is told has to be readable before the decision, the same reason
 *    AttachmentViewer warns before the file picker opens rather than after.
 *  - **Every option names its own deadline, not only a delta.** Stage windows
 *    differ in kind — P4's response stage is 22 hours, P8's is five days — so
 *    "+4d" without a date is an arithmetic problem rather than an answer.
 *  - **A repeat top-up says which time it is, in red, above the button.**
 *    Topping up is deliberately uncapped (0075 note 4), so this sentence and
 *    the record it describes are the only things making a fourth one a
 *    decision rather than a reflex. It is shown for a top-up alone: a re-grade
 *    is a different act, and borrowing the warning for it would be false.
 */
import { useMemo, useState } from "react";
import { X, Clock, AlertTriangle } from "lucide-react";
import { Card, ErrorBanner, ModalOverlay } from "../ui/Surfaces";
import Button from "../ui/Button";
import { useReferenceData } from "../../lib/referenceData";
import { extendWorkOrderSla } from "../../lib/workOrders";
import { describeError } from "../../lib/errors";
import { suggestExtension, stageGrantedMs } from "../../lib/slaExtension";
import { STAGE_LABELS, openStageDueAt, openStageRemainMs, fmtElapsed } from "../../lib/slaStages";
import { fmtDue } from "../../lib/constants";
import { fmtDateTimeMY } from "../../lib/datetime";

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th. The teens are the exception every
 *  naive version gets wrong, and this one is read out loud in a warning. */
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}

export function ExtendSlaDialog({ wo, onClose }) {
  const { priorities, priorityLabel, slaForPriority } = useReferenceData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /* Computed once on open rather than on every render: `now` moving between
     renders would let the pre-selected option change under the reader's finger
     while they are looking at it. */
  const plan = useMemo(
    () => suggestExtension(wo, priorities, slaForPriority, Date.now()),
    [wo, priorities, slaForPriority]
  );

  /* Keyed on `key`, never on `id`: a top-up's id is the work order's CURRENT
     priority, so two options would answer to the same value and the radio
     group would select the wrong one (migration 0075). */
  const [choice, setChoice] = useState(plan.suggested?.key ?? "");
  const selected = plan.options.find((o) => o.key === choice) ?? null;

  const stageLabel = plan.stage ? STAGE_LABELS[plan.stage] : null;
  const currentDue = openStageDueAt(wo);
  const remain = openStageRemainMs(wo);

  const isTopUp = selected?.kind === "top-up";
  /* Which top-up this would be. Counts top-ups alone, not `sla_extension_count`
     — that one also counts re-grades, and announcing a "2nd time" because of an
     unrelated priority change would be a disclaimer about something that never
     happened. */
  const nth = (Number(wo?.sla_top_up_count) || 0) + 1;
  const grantedSoFarMs = stageGrantedMs(wo, plan.stage);

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await extendWorkOrderSla(wo.id, isTopUp ? null : selected.id, { topUp: isTopUp });
      onClose();
    } catch (err) {
      setError(describeError(err, "Couldn't extend the SLA."));
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose} label="Extend SLA" className="p-4">
      <Card className="rise max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">Extend SLA</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        <p className="mb-3.5 text-[12.5px] leading-relaxed text-ink-soft">
          <strong className="font-mono text-ink">{wo.wo_number || "This work order"}</strong> is{" "}
          <strong className="text-ink">
            {priorityLabel(wo.priority)} ({wo.priority})
          </strong>
          {stageLabel && (
            <>
              , and its <strong className="text-ink">{stageLabel.toLowerCase()}</strong> stage{" "}
              {remain != null && remain < 0 ? (
                <>
                  was due <strong className="text-danger">{fmtDateTimeMY(currentDue)}</strong> —{" "}
                  {fmtElapsed(Math.abs(remain))} ago.
                </>
              ) : (
                <>
                  is due <strong className="text-ink">{fmtDateTimeMY(currentDue)}</strong>, in{" "}
                  {fmtDue(remain)}.
                </>
              )}
            </>
          )}
        </p>

        {plan.options.length === 0 ? (
          <p className="mb-4 text-[12.5px] text-ink-soft">
            This work order has no SLA stage running, so there is no deadline to extend.
          </p>
        ) : (
          <form onSubmit={submit}>
            {!plan.anyClears && (
              <p className="mb-3 rounded border border-accent/40 bg-accent-soft px-2.5 py-2 text-[12px] leading-relaxed text-[#8A5A0A]">
                Every option below still leaves this work order past its deadline. Extending
                it will give it more time, but it will stay overdue.
              </p>
            )}

            <fieldset className="mb-4">
              <legend className="mb-1.5 text-[12.5px] font-semibold text-ink">
                Give it more time
              </legend>
              <div className="flex flex-col gap-1">
                {plan.options.map((o) => (
                  <label
                    key={o.key}
                    className="flex items-start gap-2.5 rounded px-2 py-2 text-[13px] text-ink hover:bg-canvas"
                  >
                    <input
                      type="radio"
                      name="extend-to"
                      value={o.key}
                      checked={choice === o.key}
                      onChange={() => setChoice(o.key)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">
                        {o.kind === "top-up" ? (
                          <>
                            Another {fmtElapsed(o.grantMs)}, still {o.label} ({o.id})
                          </>
                        ) : (
                          <>
                            Re-grade to {o.label} ({o.id})
                          </>
                        )}
                      </span>
                      {o.key === plan.suggested?.key && (
                        <span className="ml-1.5 rounded bg-navy/[0.08] px-1.5 py-0.5 text-[10.5px] font-semibold text-navy">
                          Suggested
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        {o.dueAt == null ? (
                          <>This stage has not started, so there is no deadline to move yet.</>
                        ) : (
                          <>
                            {stageLabel} due {fmtDateTimeMY(new Date(o.dueAt).toISOString())}
                            {o.gainMs != null && o.gainMs > 0 && <> · +{fmtElapsed(o.gainMs)}</>}
                            {!o.clears && <> · still overdue</>}
                          </>
                        )}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Friction on repeat use, which is the only thing standing in for a
                cap — topping up is deliberately unlimited (migration 0075 note 4),
                so the record and this sentence are what keep it deliberate. Shown
                from the SECOND top-up onward, and only when a top-up is what is
                actually selected: a re-grade is a different decision and borrowing
                this warning for it would be false. */}
            {isTopUp && nth > 1 && (
              <div className="mb-4 rounded border border-danger/40 bg-danger/[0.06] px-2.5 py-2 text-[12px] leading-relaxed text-danger">
                <AlertTriangle size={13} className="mr-1 inline align-[-2px]" />
                <strong className="font-semibold">
                  This would be the {ordinal(nth)} time this work order has been topped up.
                </strong>{" "}
                {/* Only stated when this STAGE has actually been given time. The count is
                    per work order and the minutes are per stage, so a job topped up at
                    acknowledge and now sitting in resolution would otherwise be told it
                    had been given nothing — a sentence that reads as a bug. */}
                {grantedSoFarMs > 0 && (
                  <>
                    Its {stageLabel ? stageLabel.toLowerCase() : "current"} stage has already
                    been given {fmtElapsed(grantedSoFarMs)} beyond its original target.{" "}
                  </>
                )}
                Every top-up is recorded with your name, and the stages it has already
                missed stay missed — if the work keeps outrunning its deadline, the
                priority or the plan is likely the thing to change.
              </div>
            )}

            <div className="mb-4 rounded border border-border bg-canvas px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft">
              <Clock size={12} className="mr-1 inline align-[-1px]" />
              This is recorded on the work order&apos;s timeline with your name and the time,
              and the assigned technician and the person who raised it are both notified. The
              stages this work order has already missed stay on its record — extending gives
              it more time from here, it does not erase what happened.
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                No, leave it
              </Button>
              <Button type="submit" loading={busy} disabled={!selected}>
                {isTopUp
                  ? `Yes, add ${fmtElapsed(selected.grantMs)}`
                  : `Yes, extend to ${selected?.id ?? "…"}`}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </ModalOverlay>
  );
}

export default ExtendSlaDialog;
