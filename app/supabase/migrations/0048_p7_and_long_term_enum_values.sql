-- ============================================================================
-- SI — Service Inside · 0048 Two enum labels, and nothing else
-- ============================================================================
-- `si_priority` gains 'P7' and `si_impact` gains 'long_term'. That is the whole
-- file, and it has to be, for the reason 0035's header sets out: Postgres
-- refuses to let a transaction *use* an enum value the same transaction added,
-- and the Supabase CLI wraps every migration file in a transaction. Seeding the
-- `priorities`, `impact_levels` and `sla` rows that name these labels therefore
-- cannot happen here — it happens in 0050.
--
-- Why P7 and not P5. The rank ladder is 1 = most severe, and a long-term task
-- sits well below "cosmetic or routine" rather than one step below it. Leaving
-- 5 and 6 unused keeps room for a priority between P4 and P7 later without
-- renumbering anything, which matters because `priorities.rank` is what
-- si_derive_priority() compares with `least()` and what every escalation
-- ceiling resolves through.
--
-- `if not exists` on both, so re-running the file is a no-op rather than a
-- duplicate-label error.
-- ============================================================================

alter type si_priority add value if not exists 'P7';
alter type si_impact   add value if not exists 'long_term';
