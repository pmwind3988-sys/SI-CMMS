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
 * badge shows "waiting_spare_part" for a moment rather than crashing or
 * flashing empty.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase, liveQuery } from "./supabase";
import { useAuth } from "../context/AuthContext";

const ReferenceDataContext = createContext(null);

/**
 * table -> { select, order } for the eight reference sets.
 *
 * `retire` marks the six a Superuser can take out of use (migration 0031) and
 * says where each one keeps that state. Five carry a plain `is_active` boolean;
 * equipment uses the `status` column that has existed since 0001, because a
 * second flag beside it would be a second truth.
 *
 * Retired rows are still LOADED. That is the whole point of retiring rather than
 * deleting: an existing work order's P4 badge still needs to find the row that
 * says "Low" and "#22C55E". Only the pickers filter, via the active* lists
 * below.
 */
const SOURCES = {
  departments: {
    select: "id, name, code, plant_id, is_active",
    order: "name",
    retire: { key: "id", flag: "is_active" },
  },
  assets: {
    select: "id, asset_code, name, category, department_id, criticality, status",
    order: "name",
    retire: { key: "id", flag: "status", active: "active", retired: "decommissioned" },
  },
  priorities: {
    select: "id, code, label, color_hex, rank, description, is_active",
    order: "rank",
    retire: { key: "id", flag: "is_active" },
  },
  sla: {
    select:
      "id, priority_id, plant_id, ack_target_minutes, ack_target_label, response_target_minutes, response_target_label, resolution_target_minutes, resolution_target_label",
    order: "priority_id",
  },
  // 0031 gave this table no `retire` spec, on the reasoning that nobody picks a
  // status — the workflow moves a work order through them, so taking one out of
  // use means removing rows from wo_status_transitions. Migration 0039 did
  // exactly that for `on_the_way` and `on_site`, and added `is_active` here to
  // go with it. The flag is display only: it decides which rungs the timeline
  // ladder draws. The boundary is still the transition matrix.
  wo_statuses: {
    select: "code, label, color_hex, sort_order, is_terminal, description, is_active",
    order: "sort_order",
    retire: { key: "code", flag: "is_active" },
  },
  impact_levels: {
    select: "code, label, suggests_priority, sort_order, description, is_active",
    order: "sort_order",
    retire: { key: "code", flag: "is_active" },
  },
  wo_types: {
    select: "code, label, sort_order, description, is_active",
    order: "sort_order",
    retire: { key: "code", flag: "is_active" },
  },
  safety_severities: {
    select: "code, label, escalates_to_priority, sort_order, is_active",
    order: "sort_order",
    retire: { key: "code", flag: "is_active" },
  },
  // Not reference data in the same sense — these are capability grants a
  // Superuser makes (migration 0018), not labels. They ride along here for the
  // reason the whole provider exists: a handful of rows that almost every
  // screen needs and that change perhaps twice a year, so one subscription
  // shared by everyone beats a listener per component.
  //
  // What is read here decides what to *show*. si_can_delete_work_orders() and
  // the work_orders_delete policy decide what is allowed.
  role_permissions: { select: "role, can_delete_work_orders, updated_at", order: "role" },
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
    const rolePermissions = data.role_permissions ?? [];

    // Retired rows stay in the lists above so every label still resolves; these
    // are what anything offering a *choice* renders from (migration 0031).
    const active = (table, rows) => rows.filter((r) => !isRetired(table, r));
    const activePriorities = active("priorities", priorities);
    const activeImpacts = active("impact_levels", impacts);
    const activeTypes = active("wo_types", types);
    const activeSeverities = active("safety_severities", severities);
    const activeDepartments = active("departments", departments);
    const activeAssets = active("assets", assets);
    const activeStatuses = active("wo_statuses", statuses);

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
    //
    // role_permissions is excluded from both lists, and that exclusion is
    // load-bearing rather than tidy-minded. `ready` gates every screen in the
    // app; if it waited on a table that does not exist until migration 0018 has
    // been applied, a project one migration behind would show no labels
    // anywhere — a whole-app outage caused by a feature it isn't using yet. Its
    // absence degrades to "no role holds the capability", which is the right
    // answer for a database where the grants have not been created.
    const NEVER_EMPTY = ["priorities", "sla", "wo_statuses", "impact_levels", "wo_types", "safety_severities"];
    const READY_SOURCES = Object.keys(SOURCES).filter((t) => t !== "role_permissions");
    const ready =
      READY_SOURCES.every((t) => Array.isArray(data[t])) &&
      NEVER_EMPTY.every((t) => (data[t]?.length ?? 0) > 0);

    return {
      ready,
      error,

      // Every row, retired included. Settings edits these; every label helper
      // below resolves against them, which is what keeps an existing work order
      // showing "Low" and green after P4 has been retired.
      departments,
      assets,
      priorities,
      sla,
      statuses,
      impacts,
      types,
      severities,
      rolePermissions,

      // Still offerable. Anything that asks somebody to choose a value for new
      // work reads these instead (migration 0031).
      activeDepartments,
      activeAssets,
      activePriorities,
      activeImpacts,
      activeTypes,
      activeSeverities,
      activeStatuses,

      /**
       * Does this role hold this capability? Absent rows read false, which is
       * the same fail-closed direction si_can_delete_work_orders() takes for an
       * unrecognised role claim.
       */
      roleCan: (role, capability) =>
        rolePermissions.find((r) => r.role === role)?.[capability] === true,

      departmentById: (id) => departmentMap.get(id) ?? null,
      assetById: (id) => assetMap.get(id) ?? null,
      priorityById: (id) => priorityMap.get(id) ?? null,
      statusByCode: (code) => statusMap.get(code) ?? null,
      impactByCode: (code) => impactMap.get(code) ?? null,
      typeByCode: (code) => typeMap.get(code) ?? null,
      severityByCode: (code) => severityMap.get(code) ?? null,
      slaForPriority: (priorityId) => slaMap.get(priorityId) ?? null,

      /**
       * Assets filtered to one department — what the raise form's picker needs.
       * Retired equipment is left out for the same reason: this answers "what
       * can this work order be raised against", not "what exists".
       */
      assetsForDepartment: (departmentId) =>
        departmentId
          ? activeAssets.filter((a) => a.department_id === departmentId)
          : activeAssets,

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

      /**
       * Ordered status codes a work order can still be moved through — replaces
       * the STATUS_FLOW array, and since migration 0039 excludes the retired
       * rungs.
       *
       * `statuses` above is deliberately still EVERY row, retired included.
       * That is what lets statusLabel/statusColor resolve a work order closed
       * last month whose history says "On The Way", and it is why
       * StatusTimeline draws this ladder PLUS whatever a given work order
       * actually has history for, rather than this ladder alone.
       */
      statusFlow: activeStatuses.map((s) => s.code),

      /**
       * The priority a work order gets, from impact plus the two risk flags.
       * The impact -> priority mapping and the safety escalation ceiling are
       * rows (impact_levels.suggests_priority and
       * safety_severities.escalates_to_priority) rather than literals.
       *
       * Named "suggest" from when it was one. It is no longer a suggestion:
       * migration 0036 made priority read-only and derived, and
       * `si_derive_priority` recomputes this same rule in a BEFORE
       * INSERT/UPDATE trigger that overwrites whatever the client sends. This
       * copy exists so the raise form can show the answer, and the SLA targets
       * that follow from it, before anything is submitted — the two must stay
       * in step, so change them together or the form will promise one priority
       * and the database will store another.
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
        /* Resolved against the ACTIVE priorities only. impact_levels.suggests_priority
           and safety_severities.escalates_to_priority are foreign keys onto
           priorities, so they go on pointing at P1 after P1 has been retired —
           and a suggestion the picker cannot offer would preselect a value the
           form then rejects. No active priority at that rank means no
           suggestion, which the form already handles. */
        return activePriorities.find((p) => p.rank === best)?.id ?? null;
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
   Admin writes.

   Relabelling and recolouring is what an Administrator gets: the lookup
   tables are keyed on enums, so the set of rows is fixed by the schema
   and there is no insert policy (migration 0009).

   Retiring a row and removing one are Superuser-only and were added by
   migration 0031. Both are enforced there — si_guard_reference_retire()
   for the flag, the *_delete policies plus si_guard_reference_delete()
   for the removal. Nothing below is a security check; canRetireReferenceData()
   in constants.js decides what to SHOW, and the two disagreeing means the
   user sees an error rather than a silent success.
-------------------------------------------------------------------*/
export async function updateReferenceRow(table, keyColumn, keyValue, patch) {
  if (!SOURCES[table]) throw new Error(`${table} is not an editable reference table`);
  const { error } = await supabase.from(table).update(patch).eq(keyColumn, keyValue);
  if (error) throw error;
}

/** The six tables a Superuser can retire rows in, keyed as in SOURCES. */
export const RETIRABLE = Object.fromEntries(
  Object.entries(SOURCES)
    .filter(([, s]) => s.retire)
    .map(([table, s]) => [table, s.retire])
);

/** Is this row out of use? Answered the same way for all six tables. */
export function isRetired(table, row) {
  const spec = RETIRABLE[table];
  if (!spec || !row) return false;
  return spec.active ? row[spec.flag] !== spec.active : row[spec.flag] === false;
}

/**
 * Active rows, plus whichever one is already selected even after it has been
 * retired.
 *
 * The raise form is also the edit form. Filtering a picker to the active rows
 * would drop the current value out of the `<select>` on a work order raised
 * before the retirement, and the browser would silently move the selection to
 * the first remaining option — changing a field nobody touched, on save.
 */
export function includingCurrent(activeRows, allRows, currentValue, key) {
  if (!currentValue || activeRows.some((r) => r[key] === currentValue)) return activeRows;
  const current = allRows.find((r) => r[key] === currentValue);
  return current ? [...activeRows, current] : activeRows;
}

/** Retire a reference row, or restore one. Superuser only — see 0031. */
export async function setReferenceRowActive(table, keyValue, active) {
  const spec = RETIRABLE[table];
  if (!spec) throw new Error(`${table} cannot be retired`);

  const value = spec.active ? (active ? spec.active : spec.retired) : active;
  const { data, error } = await supabase
    .from(table)
    .update({ [spec.flag]: value })
    .eq(spec.key, keyValue)
    .select(spec.key);

  if (error) throw error;
  // RLS refusing an UPDATE changes no rows and raises nothing, so the absence of
  // a returned row is the refusal. Same pattern as deleteWorkOrder().
  if (!data?.length) {
    throw new Error("Only the Superuser can retire or restore reference data.");
  }
}

/**
 * Remove a reference row outright.
 *
 * si_guard_reference_delete() counts what still points at the row and refuses
 * with a sentence naming it, which describeError() surfaces verbatim — so there
 * is no client-side pre-check here. An earlier version of this counted the
 * references in the browser first; that raced against a concurrent insert and
 * duplicated a rule that has to live in the database anyway.
 */
export async function deleteReferenceRow(table, keyValue) {
  const spec = RETIRABLE[table];
  if (!spec) throw new Error(`${table} rows cannot be removed`);

  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq(spec.key, keyValue)
    .select(spec.key);

  if (error) throw error;
  if (!data?.length) {
    throw new Error("You don't have permission to remove that.");
  }
}
