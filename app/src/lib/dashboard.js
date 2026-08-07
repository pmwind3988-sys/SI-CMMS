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
import { supabase, liveRow } from "./supabase";

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

export function listenDashboardCharts(cb, onError) {
  return statRow("dashboard_charts", cb, onError);
}

/** Manager/Admin-only — the role check lives inside the RPC, see migration 0004. */
export async function refreshDashboardStatsNow() {
  const { error } = await supabase.rpc("si_refresh_dashboard_stats");
  if (error) throw error;
}
