-- ============================================================================
-- SI — Service Inside · 0071 The P8 and 'scheduled' enum labels
-- ============================================================================
-- Two statements, and this file does nothing else on purpose.
--
-- Postgres refuses to let a transaction USE an enum value the same transaction
-- added — `insert into priorities … 'P8'` fails with "unsafe use of new value"
-- — and the Supabase CLI wraps every migration file in one transaction. So the
-- labels and the rows that name them cannot share a file. Same split 0035/0036
-- needed for si_wo_type, and 0048/0050 for P7.
--
-- P8 rather than P5, for the reason 0050 chose 7 over 5: rank is what
-- si_derive_priority compares with least() and what every escalation ceiling
-- resolves through, and leaving numbers unused keeps room for a priority
-- between P4 and P7 without renumbering anything.
-- ============================================================================

alter type si_priority add value if not exists 'P8';
alter type si_impact   add value if not exists 'scheduled';
