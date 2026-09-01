"use client";

/**
 * SI — Service Inside · Dashboard card drill-down
 *
 * The rows behind one stat card. Every dashboard feeds it the same normalised
 * row shape, so the Manager cards (rows from si_dashboard_card_rows) and the
 * role dashboards (rows already in memory from listenWorkOrderList) render
 * identically.
 *
 * Row shape:
 *   { id, href?, title, subtitle?, meta?, priority?, status?, tags?,
 *     metricKind?, metricValue? }
 *
 * metricKind mirrors the column si_dashboard_card_rows returns:
 *   'sla_remaining' — minutes to the resolution deadline, negative once passed
 *   'duration'      — minutes elapsed
 *   'count'         — a plain tally, rendered with `metricUnit`
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowRight } from "lucide-react";
import { fmtDue } from "../../lib/constants";
import { PriorityBadge, StatusBadge } from "../ui/Badges";
import { Card, ErrorBanner, EmptyState, ModalOverlay } from "../ui/Surfaces";
import { usePaged, useAutoPageSize, PagerFooter } from "../ui/Paged";

export default function CardDetail({
  title,
  blurb,
  rows,
  loading,
  error,
  emptyText = "Nothing to show here.",
  metricUnit = "",
  footnote,
  onClose,
}) {
  const router = useRouter();

  // Esc closes, and the body must not scroll behind a sheet that owns the
  // whole screen on a phone.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const list = rows ?? [];

  /* The heading keeps printing `list.length`, so the true total stays visible
     while only part of it is rendered. Keyed on the title: the sheet is reused
     for whichever card was opened. */
  /* Measured against the sheet, not the window: this scrolls inside itself and
     is capped at 88dvh, so the viewport is the wrong ruler. `reserve` is small
     because the footnote strip is the only thing under the rows. */
  const listRef = useRef(null);
  const pageSize = useAutoPageSize(listRef, { min: 3, ready: !loading && !error, signature: list.length });

  const pager = usePaged(list, { pageSize, resetKey: title });

  return (
    <ModalOverlay onClose={onClose} label={title || "Work order details"}>
      {/* Bottom sheet on a phone, centred dialog from `sm` up. The height cap
          is on the sheet itself so the header and footnote stay put and only
          the row list scrolls; the safe-area padding keeps that footnote clear
          of Android's gesture pill. */}
      <Card className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-b-none pb-[env(safe-area-inset-bottom)] sm:rounded-b sm:pb-0">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[15.5px] font-bold text-ink">
              {title}
              {!loading && !error && (
                <span className="ml-2 font-mono text-[13px] font-bold text-ink-soft">{list.length}</span>
              )}
            </h2>
            {blurb && <p className="mt-0.5 text-[12.5px] text-ink-soft">{blurb}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 text-ink-soft hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <div className="px-4 pt-4">
              <ErrorBanner message={error} />
            </div>
          )}
          {loading && <div className="px-4 py-6 text-[13px] text-ink-soft">Loading…</div>}
          {!loading && !error && list.length === 0 && <EmptyState>{emptyText}</EmptyState>}

          <div ref={listRef}>
          {!loading &&
            !error &&
            pager.visible.map((r, i) => {
              const clickable = Boolean(r.href);
              const Tag = clickable ? "button" : "div";
              return (
                <Tag
                  key={r.id ?? i}
                  {...(clickable
                    ? {
                        type: "button",
                        onClick: () => {
                          onClose();
                          router.push(r.href);
                        },
                      }
                    : {})}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left sm:gap-3 ${
                    i === 0 ? "" : "border-t border-[#F1F3F5]"
                  } ${clickable ? "hover:bg-canvas" : ""}`}
                >
                  <div className="min-w-0 flex-[2]">
                    <div className="truncate font-mono text-[11.5px] text-ink-soft">{r.title}</div>
                    {r.subtitle && (
                      <div className="truncate text-[13px] font-medium text-ink">{r.subtitle}</div>
                    )}
                    {r.meta && <div className="truncate text-[11.5px] text-ink-soft">{r.meta}</div>}
                    {r.tags?.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-[#FEF3C7] px-1.5 py-px text-[10.5px] font-semibold text-[#92400E]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {r.priority && (
                    <div className="w-12 flex-shrink-0">
                      <PriorityBadge p={r.priority} size="sm" />
                    </div>
                  )}
                  {r.status && (
                    <div className="hidden flex-shrink-0 sm:block">
                      <StatusBadge s={r.status} />
                    </div>
                  )}

                  <Metric kind={r.metricKind} value={r.metricValue} unit={metricUnit} />

                  {clickable && (
                    <ArrowRight size={13} className="flex-shrink-0 text-accent" aria-hidden="true" />
                  )}
                </Tag>
              );
            })}
          </div>
          {!loading && !error && <PagerFooter pager={pager} />}
        </div>

        {footnote && (
          <div className="border-t border-border px-4 py-2.5 text-[11.5px] text-ink-soft">{footnote}</div>
        )}
      </Card>
    </ModalOverlay>
  );
}

function Metric({ kind, value, unit }) {
  if (!kind || kind === "none" || value == null) return null;

  if (kind === "count") {
    return (
      <span className="w-20 flex-shrink-0 text-right font-mono text-[11.5px] text-ink-soft">
        {value} {unit}
      </span>
    );
  }

  const ms = Number(value) * 60000;
  const late = kind === "sla_remaining" && ms < 0;
  const text =
    kind === "sla_remaining" ? (late ? fmtDue(ms) : `${fmtDue(ms)} left`) : fmtDue(Math.abs(ms));

  return (
    <span
      className="w-20 flex-shrink-0 text-right font-mono text-[11.5px]"
      style={{ color: late ? "#EF4444" : "#64748B", fontWeight: late ? 700 : 400 }}
    >
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------
   Normalisers — one per source, so the modal itself stays dumb.
-------------------------------------------------------------------*/

/** A row straight out of si_dashboard_card_rows(). */
export function rowFromRpc(r) {
  return {
    id: `${r.kind}:${r.ref_id}`,
    href: r.kind === "work_order" ? `/work-orders/view?id=${r.ref_id}` : null,
    title: r.title,
    subtitle: r.subtitle,
    meta: r.meta,
    priority: r.priority,
    status: r.status,
    metricKind: r.metric_kind,
    metricValue: r.metric_value,
  };
}

/**
 * A work order the role dashboards already hold. `remainMs` is the same
 * closure those dashboards use for their SLA column, so the drill-down and the
 * list underneath it can never disagree about how late something is.
 */
export function rowFromWorkOrder(w, remainMs) {
  const remain = w.status === "closed" ? null : remainMs?.(w);
  return {
    id: w.id,
    href: `/work-orders/view?id=${w.id}`,
    title: w.wo_number || "Pending…",
    subtitle: w.asset_name,
    meta: `${w.department_id} · ${w.assigned_to_name || "Unassigned"}`,
    priority: w.priority,
    status: w.status,
    metricKind: remain == null ? "none" : "sla_remaining",
    metricValue: remain == null ? null : Math.round(remain / 60000),
  };
}
