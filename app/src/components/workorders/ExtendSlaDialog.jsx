"use client";

/**
 * SI — Service Inside · Extending a work order's SLA (migration 0071)
 *
 * A confirm dialog, not a form. The decision it collects is "yes, give this
 * work order more time", and the arithmetic behind it — which priority, how
 * much longer, and whether that is even enough — is worked out before the
 * dialog opens and shown rather than asked.
 *
 * Three things here are deliberate:
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
 */
import { useMemo, useState } from "react";
import { X, Clock } from "lucide-react";
import { Card, ErrorBanner, ModalOverlay } from "../ui/Surfaces";
import Button from "../ui/Button";
import { useReferenceData } from "../../lib/referenceData";
import { extendWorkOrderSla } from "../../lib/workOrders";
import { describeError } from "../../lib/errors";
import { suggestExtension } from "../../lib/slaExtension";
import { STAGE_LABELS, openStageDueAt, openStageRemainMs, fmtElapsed } from "../../lib/slaStages";
import { fmtDue } from "../../lib/constants";
import { fmtDateTimeMY } from "../../lib/datetime";

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

  const [choice, setChoice] = useState(plan.suggested?.id ?? "");
  const selected = plan.options.find((o) => o.id === choice) ?? null;

  const stageLabel = plan.stage ? STAGE_LABELS[plan.stage] : null;
  const currentDue = openStageDueAt(wo);
  const remain = openStageRemainMs(wo);

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await extendWorkOrderSla(wo.id, selected.id);
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
            There is no lower priority to move this work order to, so its SLA cannot be
            extended any further.
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
              <legend className="mb-1.5 text-[12.5px] font-semibold text-ink">Extend to</legend>
              <div className="flex flex-col gap-1">
                {plan.options.map((o) => (
                  <label
                    key={o.id}
                    className="flex items-start gap-2.5 rounded px-2 py-2 text-[13px] text-ink hover:bg-canvas"
                  >
                    <input
                      type="radio"
                      name="extend-to"
                      value={o.id}
                      checked={choice === o.id}
                      onChange={() => setChoice(o.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">
                        {o.label} ({o.id})
                      </span>
                      {o.id === plan.suggested?.id && (
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
                Yes, extend to {selected?.id ?? "…"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </ModalOverlay>
  );
}

export default ExtendSlaDialog;
