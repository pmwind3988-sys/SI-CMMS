"use client";

import { useEffect, useMemo, useState } from "react";
// `Image as ImageIcon`, the same aliasing AttachmentsPanel uses — the bare name
// collides with the DOM's own Image constructor.
import { CheckCircle2, Image as ImageIcon, PauseCircle, RotateCcw } from "lucide-react";
import { listenWorkOrderHistory } from "../../lib/workOrders";
import { isTransition, historyEventLabel } from "../../lib/historyEvents";
import { useReferenceData } from "../../lib/referenceData";
import { ErrorBanner } from "../ui/Surfaces";

// Postgres timestamptz arrives as an ISO 8601 string over PostgREST, not as a
// Firebase Timestamp object — so test parseability, not for a .toDate method.
function fmtTime(ts) {
  if (!ts || Number.isNaN(Date.parse(ts))) return "just now";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function StatusTimeline({ wo }) {
  const { statusFlow, statusLabel, statuses } = useReferenceData();
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = listenWorkOrderHistory(wo.id, setHistory, () => setError("Couldn't load the full history — try again."));
    return unsub;
  }, [wo.id]);

  /* Order comes from wo_statuses.sort_order, so an admin reordering the ladder
     in Settings reorders this timeline too.

     `statusFlow` is the rungs a work order can still be moved through, which
     since migration 0039 excludes On The Way and On Site. Drawing that alone
     would be wrong for anything raised before the change: those work orders
     have real history rows on both, and rendering a ladder that omits them puts
     genuine events on no screen — the exact bug 0038 fixed for declines.

     So any retired rung this particular work order actually reached is spliced
     back in at its own sort_order. A work order raised after 0039 has no such
     rows and draws the short ladder; one raised before draws its full, truthful
     history. `statuses` is every row, retired included, which is why the labels
     and colours still resolve. */
  const STATUS_FLOW = useMemo(() => {
    const active = new Set(statusFlow);
    // Transitions only. A non-transition row (migration 0043) stamps the status
    // the work order is already sitting at, so it can never add a rung the flow
    // does not have — but "which rungs did this work order actually reach" is a
    // question about the flow, and answering it from rows that are not steps
    // through the flow is how that stops being true later.
    const reached = new Set((history || []).filter(isTransition).map((h) => h.to_status));
    return statuses
      .filter((s) => active.has(s.code) || reached.has(s.code))
      .map((s) => s.code);
  }, [statusFlow, statuses, history]);
  const flowIndex = STATUS_FLOW.indexOf(wo.status);
  /* The last row that MOVED the work order. It feeds the "waiting on a spare
     part" banner below, whose whole content is that transition's remarks — so a
     photo replaced during the wait would have retitled the banner with the
     photo's filename and hidden the reason the job is stopped. */
  const transitions = (history || []).filter(isTransition);
  const lastEvent = transitions.length ? transitions[transitions.length - 1] : null;

  return (
    <div>
      {error && <ErrorBanner message={error} />}
      {STATUS_FLOW.map((s, i) => {
        /* Every history row that landed on this status, not just the first.
           The ladder is one rung per status, but a real trail is not monotonic:
           `assigned -> open` (decline), `testing -> repairing` and
           `completed -> repairing` all revisit a rung that has already been
           passed. This used to be `.find()`, which returns the FIRST match — so
           a decline collided with the work order's original `open` row, lost to
           it, and the decline, its reason and every re-assignment after it were
           in work_order_history and rendered nowhere. One rule fixes all three.
           Ordering is the listener's (created_at ascending), so [0] is genuinely
           the first arrival and the rest are in the order they happened. */
        const rows = (history || []).filter((h) => h.to_status === s);
        /* Split before indexing, because since migration 0043 not every row on
           a rung is a step onto it. A photo replaced while the job sat at
           Repairing writes a row stamped `repairing` at both ends, and taken as
           a transition it would join the revisit list reading `Repairing →
           Repairing` — indistinguishable from a reassignment, which really is
           `assigned → assigned`. It would also outrank nothing but could still
           become events[0] on a rung whose own arrival was never recorded:
           raising a work order writes no history row at all, so `open` has none
           until it is left, and a photo replaced before then would have become
           the work order's "Open" entry, attributing it to whoever swapped the
           photo. Neither would have raised anything. */
        const events = rows.filter(isTransition);
        const notes = rows.filter((h) => !isTransition(h));
        const event = events[0];
        const revisits = events.slice(1);
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
            {/* pb-5.5 isn't in Tailwind's spacing scale — it compiled to nothing,
                so the timeline rows had no gap between them. */}
            <div className="min-w-0 pb-5">
              <div className="text-[13.5px]" style={{ fontWeight: isCurrent ? 700 : 500, color: done ? "#101828" : "#64748B" }}>
                {statusLabel(s)}
              </div>
              {event ? (
                <div className="text-[12px] text-ink-soft mt-0.5">
                  {event.actor_name} · {fmtTime(event.created_at)}
                  {event.remarks && <div className="mt-0.5 text-ink">{event.remarks}</div>}
                </div>
              ) : (
                <div className="text-[12px] text-[#B7BEC6] mt-0.5">Pending</div>
              )}

              {/* Return visits to this rung, in the order they happened. A
                  decline shows up here under Open as `Assigned → Open`, which
                  is what it literally is; a failed test and a reopen come out
                  right for free, without a branch for either. Amber and
                  indented so the rung still reads as one step that the work
                  order came back to, not as several separate steps. */}
              {revisits.map((r) => (
                <div key={r.id} className="mt-2 border-l-2 border-[#F59E0B] pl-2.5">
                  {/* The transition itself, not a word for its direction. The
                      obvious label was "Back from X" and it is wrong for half
                      these rows: `assigned -> open` is a step back, but
                      `repairing -> testing` on a second attempt is a step
                      forward that merely happens to revisit a rung. The arrow
                      is true of every case and editorialises none of them. */}
                  <div className="text-[11.5px] font-semibold text-[#B45309]">
                    <RotateCcw size={11} className="inline mb-0.5 mr-1" />
                    {statusLabel(r.from_status)} → {statusLabel(s)}
                  </div>
                  <div className="text-[12px] text-ink-soft">
                    {r.actor_name} · {fmtTime(r.created_at)}
                  </div>
                  {r.remarks && <div className="text-[12px] text-ink mt-0.5">{r.remarks}</div>}
                </div>
              ))}

              {/* Things that happened while the work order sat on this rung
                  without moving off it — a photo replaced, so far. Slate rather
                  than the amber above, because amber means "the work order came
                  back here" and this is not a movement at all. Rendered rather
                  than left to the Attachments tab: replacing a photo destroys
                  the original, and a destroyed record belongs on the trail the
                  work order is read from. */}
              {notes.map((n) => (
                <div key={n.id} className="mt-2 border-l-2 border-[#CBD5E1] pl-2.5">
                  <div className="text-[11.5px] font-semibold text-ink-soft">
                    <ImageIcon size={11} className="inline mb-0.5 mr-1" />
                    {historyEventLabel(n)}
                  </div>
                  <div className="text-[12px] text-ink-soft">
                    {n.actor_name} · {fmtTime(n.created_at)}
                  </div>
                  {n.remarks && <div className="text-[12px] text-ink mt-0.5">{n.remarks}</div>}
                </div>
              ))}
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
