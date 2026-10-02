"use client";

/**
 * SI — Service Inside · Extending a work order's SLA (migration 0078)
 *
 * One list: pick how much time to add, named by priority — "P8 · 30 days" —
 * with the work order's own priority pre-selected. The priority itself never
 * moves; re-grading is Change priority's job, and offering it here too was
 * the confusion this dialog replaced.
 *
 *  - **No reason field.** The server writes the timeline remark itself, naming
 *    the overdue time absorbed, the amount and the new deadline.
 *  - **Overdue is absorbed.** The amount counts from now when the stage is
 *    already late, so every option's deadline is at least that far ahead.
 *  - **Repeat use says which time it is, in red, above the button**, because
 *    extending is uncapped and that sentence is the only friction.
 */
import { useMemo, useState } from "react";
import { X, Clock, AlertTriangle } from "lucide-react";
import { Card, ErrorBanner, ModalOverlay } from "../ui/Surfaces";
import Button from "../ui/Button";
import { useReferenceData } from "../../lib/referenceData";
import { extendSlaStage } from "../../lib/workOrders";
import { describeError } from "../../lib/errors";
import { suggestExtension, stageGrantedMs } from "../../lib/slaExtension";
import { STAGE_LABELS, openStageDueAt, openStageRemainMs, fmtElapsed } from "../../lib/slaStages";
import { fmtDue } from "../../lib/constants";
import { fmtDateTimeMY } from "../../lib/datetime";

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th. */
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}

export function ExtendSlaDialog({ wo, onClose }) {
  const { priorities, priorityLabel, slaForPriority } = useReferenceData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /* Computed once on open: `now` moving between renders would shift every
     deadline under the reader's finger. */
  const plan = useMemo(
    () => suggestExtension(wo, priorities, slaForPriority, Date.now()),
    [wo, priorities, slaForPriority]
  );

  const [choice, setChoice] = useState(plan.suggested?.key ?? "");
  const selected = plan.options.find((o) => o.key === choice) ?? null;

  const stageLabel = plan.stage ? STAGE_LABELS[plan.stage] : null;
  const currentDue = openStageDueAt(wo);
  const remain = openStageRemainMs(wo);
  const nth = (Number(wo?.sla_top_up_count) || 0) + 1;
  const grantedSoFarMs = stageGrantedMs(wo, plan.stage);

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await extendSlaStage(wo.id, selected.id);
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
          <h2 className="text-[15.5px] font-bold text-ink">
            Extend SLA{stageLabel && <> · {stageLabel} stage</>}
          </h2>
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
                  <strong className="text-danger">{fmtElapsed(Math.abs(remain))} overdue</strong>. The
                  time you add counts from now.
                </>
              ) : (
                <>
                  is due <strong className="text-ink">{fmtDateTimeMY(currentDue)}</strong>, in{" "}
                  {fmtDue(remain)}. The time you add goes on top.
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
            <fieldset className="mb-4">
              <legend className="mb-1.5 text-[12.5px] font-semibold text-ink">How much time to add</legend>
              <div className="flex flex-col gap-1">
                {plan.options.map((o) => (
                  <label
                    key={o.key}
                    className="flex items-start gap-2.5 rounded px-2 py-2 text-[13px] text-ink hover:bg-canvas"
                  >
                    <input
                      type="radio"
                      name="extend-by"
                      value={o.key}
                      checked={choice === o.key}
                      onChange={() => setChoice(o.key)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">
                        {o.id} · {fmtElapsed(o.grantMs)}
                      </span>
                      <span className="ml-1.5 text-ink-soft">{o.label}</span>
                      {o.own && (
                        <span className="ml-1.5 rounded bg-navy/[0.08] px-1.5 py-0.5 text-[10.5px] font-semibold text-navy">
                          This work order&apos;s priority
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        New deadline {fmtDateTimeMY(new Date(o.dueAt).toISOString())}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {selected && (
              <p className="mb-3 text-[12px] text-ink">
                Priority stays{" "}
                <strong>
                  {priorityLabel(wo.priority)} ({wo.priority})
                </strong>
                . Only the {stageLabel ? stageLabel.toLowerCase() : "current"} stage moves.
              </p>
            )}

            {nth > 1 && (
              <div className="mb-4 rounded border border-danger/40 bg-danger/[0.06] px-2.5 py-2 text-[12px] leading-relaxed text-danger">
                <AlertTriangle size={13} className="mr-1 inline align-[-2px]" />
                <strong className="font-semibold">
                  This would be the {ordinal(nth)} time this work order&apos;s SLA has been extended.
                </strong>{" "}
                {grantedSoFarMs > 0 && (
                  <>
                    Its {stageLabel ? stageLabel.toLowerCase() : "current"} stage has already been given{" "}
                    {fmtElapsed(grantedSoFarMs)} beyond its original target.{" "}
                  </>
                )}
                If the work keeps outrunning its deadline, the priority or the plan is likely the thing
                to change.
              </div>
            )}

            <div className="mb-4 rounded border border-border bg-canvas px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft">
              <Clock size={12} className="mr-1 inline align-[-1px]" />
              This is recorded on the work order&apos;s timeline with your name and the time, and the
              assigned technician and the person who raised it are both notified. Stages already
              missed stay on its record.
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!selected}>
                {selected ? `Extend by ${fmtElapsed(selected.grantMs)}` : "Extend"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </ModalOverlay>
  );
}

export default ExtendSlaDialog;
