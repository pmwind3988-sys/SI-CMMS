"use client";

/**
 * SI — Service Inside · Reference data
 *
 * Everything that used to be a hardcoded array in lib/constants.js now lives in a
 * table an Administrator can edit (migration 0009). This module is the single
 * place the UI reads it from.
 *
 * Why a React context rather than a listener per component: these eight sets are
 * needed by almost every screen (a status badge needs labels, the raise form needs
 * departments/assets/impacts/types, the detail page needs SLA targets). Subscribing
 * per component would open a dozen Realtime channels for data that changes maybe
 * twice a year. One provider, one subscription each, shared by everyone.
 *
 * Every set is published to Realtime, so an admin's edit reaches open sessions
 * without a reload.
 *
 * Rendering before the data arrives is normal, not an error — `ready` is false and
 * the lookup helpers fall back to something sensible (usually the raw code), so a
 * badge shows "on_the_way" for a moment rather than crashing or flashing empty.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase, liveQuery } from "./supabase";
import { useAuth } from "../context/AuthContext";

const ReferenceDataContext = createContext(null);

/** table -> { select, order } for the eight reference sets. */
const SOURCES = {
  departments: { select: "id, name, code, plant_id", order: "name" },
  assets: {
    select: "id, asset_code, name, category, department_id, criticality, status",
    order: "name",
  },
  priorities: { select: "id, code, label, color_hex, rank, description", order: "rank" },
  sla: {
    select:
      "id, priority_id, plant_id, ack_target_minutes, ack_target_label, response_target_minutes, response_target_label, resolution_target_minutes, resolution_target_label",
    order: "priority_id",
  },
  wo_statuses: { select: "code, label, color_hex, sort_order, is_terminal, description", order: "sort_order" },
  impact_levels: { select: "code, label, suggests_priority, sort_order, description", order: "sort_order" },
  wo_types: { select: "code, label, sort_order, description", order: "sort_order" },
  safety_severities: { select: "code, label, escalates_to_priority, sort_order", order: "sort_order" },
};

export function ReferenceDataProvider({ children }) {
  const { user } = useAuth();
  const [data, setData] = useState({});
  const [error, setError] = useState(null);

  /**
   * Keyed on the signed-in user, NOT mounted once.
   *
   * Every one of these tables is `to authenticated`, so subscribing before a
   * session exists returns nothing — and because the only thing that would
   * retrigger a fetch is a Realtime change event on that table, "nothing" would
   * stick for the whole session. That is exactly what happened: the provider
   * lives in the root layout, so it mounted on /login while signed out, cached
   * eight empty arrays, and every label in the app silently fell back to its raw
   * enum code ("closed" instead of "Closed"). It only looked right when you
   * arrived with a session already in storage.
   */
  useEffect(() => {
    if (!user) {
      // Drop the previous user's data so nothing leaks across a sign-out.
      setData({});
      setError(null);
      return;
    }

    const unsubs = Object.entries(SOURCES).map(([table, { select, order }]) =>
      liveQuery({
        table,
        run: () => supabase.from(table).select(select).order(order, { ascending: true }),
        cb: (rows) => setData((prev) => ({ ...prev, [table]: rows })),
        onError: (e) => setError(e),
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [user?.uid]);

  const value = useMemo(() => {
    const departments = data.departments ?? [];
    const assets = data.assets ?? [];
    const priorities = data.priorities ?? [];
    const sla = data.sla ?? [];
    const statuses = data.wo_statuses ?? [];
    const impacts = data.impact_levels ?? [];
    const types = data.wo_types ?? [];
    const severities = data.safety_severities ?? [];

    const byKey = (rows, key) => new Map(rows.map((r) => [r[key], r]));
    const departmentMap = byKey(departments, "id");
    const assetMap = byKey(assets, "id");
    const priorityMap = byKey(priorities, "id");
    const statusMap = byKey(statuses, "code");
    const impactMap = byKey(impacts, "code");
    const typeMap = byKey(types, "code");
    const severityMap = byKey(severities, "code");

    // SLA is keyed by priority; a plant-specific row wins over the global default,
    // matching the lookup order in si_sla_target_minutes().
    const slaMap = new Map();
    for (const row of sla) {
      const existing = slaMap.get(row.priority_id);
      if (!existing || (row.plant_id && !existing.plant_id)) slaMap.set(row.priority_id, row);
    }

    // Only the eight-of-eight case counts as ready. Partial data would let a
    // component decide "there are no departments" while the query is still in
    // flight, which reads as a configuration problem rather than a slow network.
    //
    // The enum-keyed lookups can never legitimately be empty — migration 0009
    // seeds them and there is no delete policy — so an empty one means the fetch
    // ran unauthenticated. Requiring rows there stops `ready` going true on the
    // empty-array state described above. departments and assets are excluded:
    // a site with no equipment registered yet is a real, valid state.
    const NEVER_EMPTY = ["priorities", "sla", "wo_statuses", "impact_levels", "wo_types", "safety_severities"];
    const ready =
      Object.keys(SOURCES).every((t) => Array.isArray(data[t])) &&
      NEVER_EMPTY.every((t) => (data[t]?.length ?? 0) > 0);

    return {
      ready,
      error,

      departments,
      assets,
      priorities,
      sla,
      statuses,
      impacts,
      types,
      severities,

      departmentById: (id) => departmentMap.get(id) ?? null,
      assetById: (id) => assetMap.get(id) ?? null,
      priorityById: (id) => priorityMap.get(id) ?? null,
      statusByCode: (code) => statusMap.get(code) ?? null,
      impactByCode: (code) => impactMap.get(code) ?? null,
      typeByCode: (code) => typeMap.get(code) ?? null,
      severityByCode: (code) => severityMap.get(code) ?? null,
      slaForPriority: (priorityId) => slaMap.get(priorityId) ?? null,

      /** Assets filtered to one department — what the raise form's picker needs. */
      assetsForDepartment: (departmentId) =>
        departmentId ? assets.filter((a) => a.department_id === departmentId) : assets,

      // Display helpers. Each degrades to the raw code so a missing row is a
      // cosmetic problem, never a crash.
      statusLabel: (code) => statusMap.get(code)?.label ?? code ?? "—",
      statusColor: (code) => statusMap.get(code)?.color_hex ?? "#64748B",
      priorityLabel: (id) => priorityMap.get(id)?.label ?? id ?? "—",
      priorityColor: (id) => priorityMap.get(id)?.color_hex ?? "#64748B",
      departmentName: (id) => departmentMap.get(id)?.name ?? id ?? "—",
      assetName: (id) => assetMap.get(id)?.name ?? id ?? "—",
      impactLabel: (code) => impactMap.get(code)?.label ?? code ?? "—",
      typeLabel: (code) => typeMap.get(code)?.label ?? code ?? "—",

      /** Ordered status codes — replaces the STATUS_FLOW array. */
      statusFlow: statuses.map((s) => s.code),

      /**
       * The priority the form suggests, from impact plus the two risk flags.
       * Same rule as before, but the impact -> priority mapping and the safety
       * escalation ceiling are now rows (impact_levels.suggests_priority and
       * safety_severities.escalates_to_priority) instead of literals.
       */
      suggestPriority: (impactCode, safety, env) => {
        const rank = (id) => priorityMap.get(id)?.rank ?? null;
        let best = impactCode ? rank(impactMap.get(impactCode)?.suggests_priority) : null;

        if (safety?.flag) {
          const ceiling = rank(severityMap.get(safety.severity)?.escalates_to_priority);
          if (ceiling != null) best = best == null ? ceiling : Math.min(best, ceiling);
        }
        // An environmental flag caps at the same priority a Medium safety risk
        // does, which is how the original constant behaved.
        if (env?.flag) {
          const ceiling = rank(severityMap.get("Medium")?.escalates_to_priority);
          if (ceiling != null) best = best == null ? ceiling : Math.min(best, ceiling);
        }
        if (best == null) return null;
        return priorities.find((p) => p.rank === best)?.id ?? null;
      },
    };
  }, [data, error]);

  return <ReferenceDataContext.Provider value={value}>{children}</ReferenceDataContext.Provider>;
}

export function useReferenceData() {
  const ctx = useContext(ReferenceDataContext);
  if (!ctx) {
    throw new Error("useReferenceData must be used inside <ReferenceDataProvider>");
  }
  return ctx;
}

/* ------------------------------------------------------------------
   Admin writes. Only relabelling/recolouring is permitted — the tables
   are keyed on enums, so the set of rows is fixed by the schema and
   there is deliberately no insert or delete policy (see migration 0009).
-------------------------------------------------------------------*/
export async function updateReferenceRow(table, keyColumn, keyValue, patch) {
  if (!SOURCES[table]) throw new Error(`${table} is not an editable reference table`);
  const { error } = await supabase.from(table).update(patch).eq(keyColumn, keyValue);
  if (error) throw error;
}
