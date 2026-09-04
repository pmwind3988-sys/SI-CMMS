-- ===========================================================================
-- SI — Service Inside · migration 0057
-- The "Work order submitted" receipt names who raised it.
--
-- 0054 put the requester into the needs-assignment fan-out and left the
-- requester's own receipt as 0003 wrote it: wo_number, machine, "has been
-- received". Every other notification about this work order now says who is
-- involved; this one did not, and it is the one row that exists purely as a
-- record that a person reported a fault.
--
-- Two reasons it is worth the clause even though the recipient is the
-- requester:
--
--   * The requester is not always the person who submitted it.
--     createWorkOrder records requester_id, which the raise form fills from
--     the signed-in account but which a Supervisor, Manager or Administrator
--     raising on somebody's behalf sets to that person. The receipt lands on
--     the named requester, and "raised by <someone else>" is exactly what they
--     need to see — otherwise a work order simply appears under their name
--     with nothing saying where it came from.
--
--   * A notification is read out of context, weeks later, next to eleven
--     others. "Yours" is only obvious while it is the newest one.
--
-- coalesce'd through nullif(btrim(...)) so a blank or missing name costs the
-- clause and never the sentence — requester_name is a denormalised copy (0001)
-- and nothing constrains it to be non-empty. Measured with the name stripped:
-- the body reads exactly as it did before this migration.
--
-- Everything else in si_after_work_order_insert is 0054's, restated because
-- `create or replace function` cannot amend one branch of a body. No client
-- change: the body is composed server-side and the notification list renders
-- whatever string it is given.
-- ===========================================================================

create or replace function si_after_work_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset text := coalesce(new.asset_name, 'equipment');
  v_ref   text := coalesce(new.wo_number, 'This work order');
  v_who   text := nullif(btrim(coalesce(new.requester_name, '')), '');
  v_detail text;
begin
  insert into work_order_history (work_order_id, from_status, to_status,
                                  actor_id, actor_name, actor_role, remarks)
  values (new.id, null, 'open', new.requester_id, new.requester_name,
          'requester', 'Work order raised');

  perform si_notify(
    new.requester_id, 'requester', new.id, new.wo_number, 'submitted',
    'Work order submitted',
    v_ref || ' — ' || v_asset || coalesce(', raised by ' || v_who || ',', '') ||
      ' has been received and will be triaged shortly.'
  );

  -- What the person choosing a technician needs before they open anything.
  -- Every lookup is left-joined and coalesced: a label table can be
  -- relabelled or a plant left unset on a row raised before 0049, and a
  -- missing name must cost a clause, never the whole notification.
  select v_ref || ' — ' || v_asset
         || ' · ' || new.priority::text
         || coalesce(' ' || p.label, '')
         || coalesce(' · ' || d.name, '')
         || coalesce(' · ' || pl.name, '')
         || coalesce(' · raised by ' || v_who, '')
         || coalesce(' · ' || left(nullif(btrim(new.description), ''), 140), '')
    into v_detail
    from (select 1) _
    left join priorities   p  on p.id = new.priority
    left join departments  d  on d.id = new.department_id
    left join plants       pl on pl.id = new.plant_id;

  -- auth.uid() is null on an insert from a script or a migration; the helper
  -- strips nulls out of the exclusion list, which is the difference between
  -- excluding nobody and silencing the whole fan-out.
  perform si_notify_assigners(
    new.department_id, new.id, new.wo_number,
    'needs_assignment', 'New work order needs a technician', v_detail,
    array[auth.uid(), new.requester_id]);

  return null;
end;
$$;

-- 0007 revoked this; a create or replace resets grants an earlier statement
-- set, so it is re-issued rather than assumed. It is a trigger body with no
-- caller in the app.
revoke all on function si_after_work_order_insert() from public, anon, authenticated;
