-- ============================================================================
-- 0036 — priority is derived, not chosen; 'repairing' gets its row; video
--        uploads stop at the bucket
--
-- Three changes that share a migration because they ship together.
--
-- ---------------------------------------------------------------------------
-- 1. wo_types gains 'repairing' at sort_order 4
-- ---------------------------------------------------------------------------
-- The enum label was added by 0035, which had to be its own file — see the
-- header there. Nothing in the client hardcodes a type list (every consumer
-- reads this table through ReferenceDataProvider), so the new type is purely
-- additive: it appears on the raise form the moment this lands, and the export
-- and list pick up its label without a change.
--
-- 1/2/3 are untouched, so "order 4" is an append rather than a renumbering.
--
-- ---------------------------------------------------------------------------
-- 2. work_orders.priority follows production impact, enforced server-side
-- ---------------------------------------------------------------------------
-- Until now priority was SUGGESTED from impact by suggestPriority() in the
-- browser and the requester could override it — `priority_touched` records
-- that they did. Priority is now read-only in the UI and derived from impact,
-- with the safety and environmental escalations kept intact.
--
-- **The UI change alone would have decided nothing**, which is the failure this
-- schema has already shipped twice: `users.status` was written by the admin
-- screen and read by no policy, trigger or predicate for four migrations
-- (0026), and 0031's header makes the same argument about a retirement that
-- only filters a dropdown. A read-only control is a suggestion to anyone
-- speaking to PostgREST directly. So the rule lives in a trigger.
--
-- `si_derive_priority` mirrors the client's suggestPriority() exactly, because
-- two definitions of the same rule is how they drift:
--   * the impact's `suggests_priority`, then
--   * capped by the safety severity's `escalates_to_priority` when flagged,
--   * capped by Medium's ceiling when environmental risk is flagged
--     (which is how the original hardcoded constant behaved),
--   * resolved against ACTIVE priorities only (0031) — a retired P1 is not a
--     value this may set.
-- Lower rank is more urgent, so each cap is a `least()`, not a `greatest()`.
--
-- TRIGGER ORDER IS LOAD-BEARING, and there are three names to beat. Postgres
-- fires BEFORE row triggers in name order:
--
--   a00_derive_work_order_priority   <- this one
--   a0_guard_retired_reference       (0031)
--   a_guard_work_order_transition    (0003)
--   b_stamp_work_order               (0003)
--   before_work_order_insert         (0003, insert only)
--   c_stamp_work_order_test_data     (0033)
--
--   * It MUST precede `before_work_order_insert`, which computes both SLA
--     deadlines from `new.priority` (0003 line 197). Behind it, the SLA would
--     be calculated from whatever the client sent and the derived priority
--     would contradict its own deadlines.
--   * Ahead of `a0_guard_retired_reference` so the value the client sent truly
--     cannot matter: a direct caller passing a retired priority has it replaced
--     with the derived active one instead of being refused for a field this
--     migration says they do not control. A retired *impact* is still refused
--     by that guard afterwards, which is right — the impact is chosen.
--
-- It fires on every UPDATE, not `update of impact, safety_risk,
-- environmental_risk`. RLS grants rows, not columns, so a column list would
-- leave a bare `update work_orders set priority = 'P1'` unguarded — and
-- `updateWorkOrderFields()` forwards an arbitrary `fields` object, so that is a
-- live path. Same reasoning as 0033's stamp trigger.
--
-- Consequence, and the reason for the backfill below: with the trigger firing
-- on every UPDATE, any row whose stored priority disagrees with its impact
-- would be silently corrected the next time anybody touched it — a technician
-- accepting a job would bump its priority as a side effect. Correcting them all
-- here instead makes that visible and atomic, and leaves every later UPDATE a
-- no-op. SLA deadlines already set are NOT recomputed: they are a promise made
-- when the work order was raised, and the raise form has always said editing
-- does not change them retroactively.
--
-- `priority_touched` stays as a column. It can only be false now, and the
-- export's "Priority Overridden" column will read "No" forever, but an export
-- is a record and churning a record's shape is worse than a constant column.
--
-- ---------------------------------------------------------------------------
-- 3. The attachments bucket stops accepting video
-- ---------------------------------------------------------------------------
-- Video upload is removed from the raise form and the attachments panel in the
-- same change. Dropping the three video mime types is what makes that a rule
-- rather than a UI preference — otherwise the upload path is still open to
-- anything holding a session, which is the same "advisory flag" objection as
-- above.
--
-- `si_file_type` KEEPS its 'video' value: rows already reference it, and an
-- enum value cannot be removed anyway. Videos already uploaded stay in the
-- bucket and stay playable — the read policy is untouched. Only new ones are
-- refused.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The new work order type
-- ---------------------------------------------------------------------------
insert into wo_types (code, label, sort_order, description) values
  ('repairing', 'Repairing', 4, 'Corrective repair of a known fault.')
on conflict (code) do update
  set label = excluded.label,
      sort_order = excluded.sort_order,
      description = excluded.description;

-- ---------------------------------------------------------------------------
-- 2. Derived priority
-- ---------------------------------------------------------------------------
create or replace function si_derive_priority(
  p_impact si_impact,
  p_safety jsonb,
  p_env    jsonb
)
returns si_priority
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rank int;
  v_cap  int;
  v_id   si_priority;
begin
  if p_impact is null then
    return null;                      -- nothing to derive from; leave it alone
  end if;

  -- No cast on either side: impact_levels.code is si_impact (0009 line 69), not
  -- text, so `i.code = p_impact::text` is `si_impact = text` and Postgres has
  -- no such operator — it fails at runtime, not at create time, because the
  -- body of a plpgsql function is not parsed until it is called.
  select p.rank into v_rank
    from impact_levels i
    join priorities p on p.id = i.suggests_priority
   where i.code = p_impact;

  if v_rank is null then
    return null;
  end if;

  -- Safety risk caps the priority at its severity's ceiling. jsonb ->> on a
  -- missing key is null, which `coalesce` turns into "not flagged" rather than
  -- an error, so a malformed safety_risk object degrades to no escalation.
  if coalesce((p_safety ->> 'flag')::boolean, false) then
    select p.rank into v_cap
      from safety_severities s
      join priorities p on p.id = s.escalates_to_priority
     where s.code = p_safety ->> 'severity';
    if v_cap is not null then
      v_rank := least(v_rank, v_cap);
    end if;
  end if;

  if coalesce((p_env ->> 'flag')::boolean, false) then
    select p.rank into v_cap
      from safety_severities s
      join priorities p on p.id = s.escalates_to_priority
     where s.code = 'Medium';
    if v_cap is not null then
      v_rank := least(v_rank, v_cap);
    end if;
  end if;

  -- Active only (0031). impact_levels.suggests_priority and
  -- safety_severities.escalates_to_priority are foreign keys onto priorities,
  -- so they go on pointing at P1 after P1 has been retired. No active priority
  -- at that rank means no derivation, and the caller leaves the column as it
  -- found it — the same choice suggestPriority() makes in the client.
  select p.id into v_id
    from priorities p
   where p.rank = v_rank
     and p.is_active
   order by p.id
   limit 1;

  return v_id;
end;
$$;

comment on function si_derive_priority(si_impact, jsonb, jsonb) is
  'Priority implied by a work order production impact, capped by its safety and environmental risk. Mirrors suggestPriority() in lib/referenceData.js; the single definition the trigger enforces.';

revoke all on function si_derive_priority(si_impact, jsonb, jsonb) from public, anon, authenticated;

create or replace function si_force_derived_priority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_priority si_priority;
begin
  v_priority := si_derive_priority(new.impact, new.safety_risk, new.environmental_risk);

  if v_priority is not null then
    new.priority := v_priority;
  end if;

  -- False unconditionally, including when nothing could be derived. The column
  -- means "the requester overrode the suggestion", and nobody can now — so it
  -- is a statement about the person, not about whether the derivation fired.
  new.priority_touched := false;

  return new;
end;
$$;

comment on function si_force_derived_priority() is
  'BEFORE INSERT/UPDATE on work_orders: overwrites priority with si_derive_priority(). Named a00_ so it precedes before_work_order_insert, which computes the SLA deadlines from priority.';

revoke all on function si_force_derived_priority() from public, anon, authenticated;

drop trigger if exists a00_derive_work_order_priority on work_orders;
create trigger a00_derive_work_order_priority
  before insert or update on work_orders
  for each row execute function si_force_derived_priority();

-- Bring existing rows into line, so no later UPDATE quietly corrects one.
-- `is distinct from` rather than `<>` so a null priority would be caught too,
-- though the column is not null. The trigger is already in place, so this
-- statement's own writes pass through it and agree with it.
update work_orders w
   set priority = d.derived
  from (
        select id,
               si_derive_priority(impact, safety_risk, environmental_risk) as derived
          from work_orders
         where impact is not null
       ) d
 where d.id = w.id
   and d.derived is not null
   and d.derived is distinct from w.priority;

-- ---------------------------------------------------------------------------
-- 3. No new video objects
-- ---------------------------------------------------------------------------
-- 0005's insert, minus 'video/mp4', 'video/quicktime' and 'video/webm'. The
-- size limit stays at 50MB: a compressed photo never approaches it, and
-- lowering it would refuse the large PDF the allowlist still permits.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  52428800,
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
