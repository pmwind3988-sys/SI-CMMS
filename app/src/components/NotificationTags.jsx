"use client";

import { useReferenceData } from "../lib/referenceData";
import { NOTIFICATION_META, NOTIFICATION_SOURCES, notificationSource } from "../lib/notifications";

/**
 * The two labels every notification row carries: what phase of the work order
 * it is about, and whose action produced it.
 *
 * One component used by both the bell and the full page, because the whole
 * point is that the categories read identically in the two places somebody
 * meets them — two copies of this markup is how the bell ends up calling
 * something "Technician" that the page calls "Field work".
 *
 * THE PHASE COMES FROM THE ROW, not from the type. `notifications.wo_status`
 * is stamped per notification by si_notify() (migration 0056); a phase derived
 * from `type` would be wrong for every `status_change`, which covers accept,
 * start-work and resume-after-a-part. Rows written before 0056 have none and
 * render no phase chip at all — an unlabelled old row is honest, and inventing
 * a phase for it from the work order's status today would date-stamp last
 * month's event with this morning's answer.
 *
 * The label itself is `statusLabel()` from reference data rather than the raw
 * enum, so a relabelled status follows here too — the same reason 0052's
 * handover notification looks the label up instead of printing `repairing`.
 */
export default function NotificationTags({ notification, className = "" }) {
  const { statusLabel } = useReferenceData();
  const src = NOTIFICATION_SOURCES[notificationSource(notification)];
  const meta = NOTIFICATION_META[notification?.type];
  const phase = notification?.wo_status;

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {phase && (
        <span className="rounded-full bg-slate-100 px-1.5 py-[1px] text-[10px] font-semibold text-ink-soft">
          {statusLabel(phase)}
        </span>
      )}
      <span
        className="rounded-full px-1.5 py-[1px] text-[10px] font-semibold"
        style={{ background: `${src.color}14`, color: src.color }}
      >
        {src.short}
      </span>
      {/* The type's own name, last and quietest: it is the most specific of the
          three and the least often the thing being scanned for. */}
      {meta?.label && <span className="text-[10px] text-ink-soft">· {meta.label}</span>}
    </div>
  );
}
