"use client";

/**
 * SI — Service Inside · Dashboard Module
 * Reads only two small, precomputed rows — never scans work_orders directly
 * from the client. See si_compute_dashboard_stats() in migration 0004 for what
 * maintains them (pg_cron, every 15 minutes) and why this shape was chosen.
 *
 * The payloads live in stats.data as jsonb and keep the exact keys the Cloud
 * Function wrote, so the chart and card components are unchanged. updated_at is
 * merged up from the row so `cards.updated_at` still resolves.
 */
import { supabase, liveQuery, liveRow } from "./supabase";

function statRow(id, cb, onError) {
  return liveRow({
    table: "stats",
    filter: `id=eq.${id}`,
    run: () =>
      supabase
        .from("stats")
        .select("data, updated_at")
        .eq("id", id)
        .maybeSingle()
        .then(({ data, error }) => ({ data: data ? [data] : [], error })),
    cb: (row) => cb(row ? { ...row.data, updated_at: row.updated_at } : null),
    onError,
  });
}

export function listenDashboardCards(cb, onError) {
  return statRow("dashboard_cards", cb, onError);
}

/**
 * The four chart series for one chosen period, live.
 *
 * There is no precomputed row behind this any more, and migration 0055 deleted
 * the one there was. A snapshot can hold exactly one period, and the whole
 * point of the control above the charts is that the period is the reader's to
 * pick — so this is computed per call, by si_dashboard_charts_range, which is
 * SECURITY INVOKER and therefore returns whatever RLS returns to this caller.
 *
 * The bucketing, the timezone and the empty-bucket filling all live in that
 * function rather than here. Reshaping the rows in JavaScript is how a chart
 * starts disagreeing with the database it was drawn from — the same argument
 * listenDashboardCardRows makes for keeping its predicates in SQL.
 *
 * Live, on work_orders, so a fault raised while somebody is looking at the
 * chart appears in it. That is one aggregate per relevant change rather than
 * per fifteen minutes; the query is a single indexed scan of one period, and
 * this module is mounted on two pages that only Managers and Admins reach.
 */
export function listenDashboardChartsRange(period, cb, onError) {
  if (!period) {
    cb(null);
    return () => {};
  }
  return liveQuery({
    table: "work_orders",
    run: () =>
      supabase.rpc("si_dashboard_charts_range", {
        p_from: period.from,
        p_to: period.to,
        p_bucket: period.bucket,
      }),
    cb,
    onError,
  });
}

/**
 * The rows behind one card, live.
 *
 * The cards themselves stay on the precomputed snapshot — this is a single
 * card's drill-down, opened deliberately, so one indexed query on demand is a
 * fair price for being able to answer "which ones?".
 *
 * The predicates live in si_dashboard_card_rows() (migration 0012), copied from
 * si_compute_dashboard_stats(), rather than being rebuilt as PostgREST filters
 * here — a second definition of "open" or "completed today" in JavaScript is
 * exactly how a drill-down starts disagreeing with the number it opened from.
 *
 * Being live means the list can be a few minutes ahead of the card, which is
 * refreshed every fifteen. The modal says so rather than hiding it.
 */
export function listenDashboardCardRows(card, cb, onError) {
  return liveQuery({
    table: "work_orders",
    run: () => supabase.rpc("si_dashboard_card_rows", { p_card: card }),
    cb,
    onError,
  });
}

/** Manager/Admin-only — the role check lives inside the RPC, see migration 0004. */
export async function refreshDashboardStatsNow() {
  const { error } = await supabase.rpc("si_refresh_dashboard_stats");
  if (error) throw error;
}
