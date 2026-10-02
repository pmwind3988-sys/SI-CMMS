-- ---------------------------------------------------------------------------
-- 0079 — The old Extend SLA function goes; what it recorded stays
-- ---------------------------------------------------------------------------
-- 0078 replaced si_extend_work_order_sla (0072's re-grade mode, 0075's top-up)
-- with si_extend_sla_stage, and left the old function on the database only so
-- that tabs opened before that release kept working. Nothing in the client has
-- called it since 0078 shipped, and nothing on the database calls it either —
-- si_override_work_order_priority names it in two comments, which plpgsql
-- never links.
--
-- DROPPING A FUNCTION REMOVES NO DATA, and that is the whole of what "keep the
-- records" needs. Everything an old extension wrote lives in rows, not in the
-- function: the work_order_history rows (event_type = 'sla_extension'), the
-- four priority_override columns a re-grade set, sla_extension_count,
-- sla_top_up_count and the three sla_*_extra_mins columns. All of it stays,
-- still protected by si_guard_priority_override, still read by the timeline
-- and the export exactly as before. A later Change priority still adds the
-- extras back on, because that arithmetic lives in
-- si_override_work_order_priority, not here.
--
-- One accepted consequence: a browser tab still running the pre-0078 page
-- gets an error if its Administrator presses the old Extend SLA button. A
-- reload fixes it.
--
-- Re-runnable: `drop function if exists`, both signatures, and the column
-- comments are plain replacements. If a later db push re-applies 0075 first
-- (production's ledger records neither), this file runs after it and drops
-- the function again.
-- ---------------------------------------------------------------------------

drop function if exists si_extend_work_order_sla(uuid, si_priority, boolean);
drop function if exists si_extend_work_order_sla(uuid, si_priority);

-- 0075's comments named the old function as the only writer. They describe
-- the column, so they move to the function that writes it now.
comment on column work_orders.sla_ack_extra_mins is
  'Minutes added to the acknowledge stage by Extend SLA (si_extend_sla_stage since 0078; si_extend_work_order_sla before it). Added on top of si_sla_targets whenever this work order''s deadlines are recomputed, so a later priority re-grade preserves it. si_guard_priority_override refuses every other route.';
comment on column work_orders.sla_top_up_count is
  'How many times this work order''s open stage has been extended without changing its priority: 0075 top-ups, and every si_extend_sla_stage call since 0078. sla_extension_count counts those plus 0072-mode re-grades.';
