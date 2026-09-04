-- ===========================================================================
-- SI — Service Inside · migration 0054
-- Raising a work order reaches everyone who can assign a technician, and it
-- says what the work order is.
--
-- Two problems, both in si_after_work_order_insert (0003), both silent.
--
--  1. THE FAN-OUT WAS ONE ROLE WIDE. 0003 notified the department's
--     Supervisors and nobody else, on its own stated reasoning that "Manager
--     and Admin see everything through the Dashboard instead of a
--     per-work-order notice". 0038 already retired that argument for accept
--     and decline: the Dashboard is where volume statistics are read, not
--     where a single fault waiting for an owner is noticed. Raising is the
--     moment a work order first needs somebody to act, and the roles that can
--     act on it are exactly the three in the transition matrix's assignment
--     row — ('open','assigned', '{supervisor,manager,admin}'). So the fan-out
--     is now that row's roles rather than one of them.
--
--     A Manager or an Administrator raising work themselves, and an
--     Administrator who is the only person on a small site, are both ordinary
--     here — hence the dedupe and the actor exclusion below.
--
--  2. THE BODY DID NOT SAY WHAT THE JOB WAS. It read
--     "WO-2026-000123 — Lathe Machine No 1 (P1)", which names the machine and
--     a letter. Somebody deciding who to send needs the plant (four of them
--     since 0049, and the equipment registers overlap by code), the department
--     that will triage it, who reported it, and what they said is wrong. Every
--     one of those meant opening the work order. Priority is spelled out with
--     its label as well as its code, because P7 is long-term planned work and
--     reads as an escalation to anyone who has not memorised the table.
--
-- The fan-out itself moves into si_notify_assigners() below, because 0038
-- already wrote this loop twice and 0056 needs it twice more. Its three
-- silent-when-wrong properties are documented there. Two of them matter here
-- specifically:
--
--   * The actor is excluded, and so is the requester. auth.uid() is readable
--     inside a SECURITY DEFINER function (it changes the database role, not
--     the JWT), and without the exclusion an Administrator raising a fault is
--     informed by the system that a fault has been raised — twice, since they
--     already have the 'submitted' row. The requester is excluded separately
--     because createWorkOrder can record a requester who is not the caller.
--
--   * recipient_role stays singular, stamped with the highest role held. It
--     records a role in a moment, and a moment has one.
--
-- Supervisors keep coming from si_department_supervisors(department_id)
-- rather than from every active Supervisor. 0019 stopped the department
-- deciding *access*, and this is routing, not access: the department is who
-- triages, chosen by the person reporting. Managers and Administrators are
-- system-wide because they always were.
--
-- The history row, the requester's own 'submitted' notification and its
-- wording are 0003's, byte for byte. They are restated because
-- `create or replace function` cannot amend one branch of a body.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- si_notify_assigners() — one fan-out, named after what it is for.
--
-- 0038 wrote this loop twice, this migration would have been the third and
-- 0056 the fifth. Three properties have to hold every time, and each of them
-- is silent when it does not:
--
--   * deduplicated by id, keeping the highest role held (0020: an account
--     holds a SET of roles, so a Supervisor+Manager is in two source sets and
--     the naive version writes one person two identical rows for one event);
--   * the actor excluded, so nobody is told by the system about the thing they
--     have just done;
--   * NULLs stripped from the exclusion list, because `id <> all (array)` is
--     NULL rather than true the moment the array holds one, which silences the
--     whole fan-out. auth.uid() is null on any insert from a script or a
--     migration, which is exactly where that goes unnoticed.
--
-- p_exclude carries the actor and anyone already told individually — the
-- Requester, usually, who gets their own warmer wording first.
-- ---------------------------------------------------------------------------
create or replace function si_notify_assigners(
  p_department_id text,
  p_work_order_id uuid,
  p_wo_number     text,
  p_type          text,
  p_title         text,
  p_body          text,
  p_exclude       uuid[] default '{}'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_role      si_role;
  v_seen      uuid[] := array_remove(coalesce(p_exclude, '{}'), null);
  v_n         int := 0;
begin
  for v_recipient, v_role in
    select distinct on (t.id) t.id, t.r
      from (
        select s, 'supervisor'::si_role, 3 from si_department_supervisors(p_department_id) s
        union all
        select m, 'manager'::si_role,    4 from si_managers() m
        union all
        select a, 'admin'::si_role,      5 from si_admins()   a
      ) as t(id, r, rk)
     where t.id is not null
       and t.id <> all (v_seen)
     order by t.id, t.rk desc
  loop
    perform si_notify(v_recipient, v_role, p_work_order_id, p_wo_number,
                      p_type, p_title, p_body);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function si_notify_assigners(text, uuid, text, text, text, text, uuid[])
  from public, anon, authenticated;

comment on function si_notify_assigners(text, uuid, text, text, text, text, uuid[]) is
  'Notifies everyone the transition matrix lets assign a technician — the department''s Supervisors, every Manager, every Administrator — once each, stamped with the highest role held, skipping p_exclude. Not callable from a client.';

create or replace function si_after_work_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset text := coalesce(new.asset_name, 'equipment');
  v_ref   text := coalesce(new.wo_number, 'This work order');
  v_detail text;
begin
  insert into work_order_history (work_order_id, from_status, to_status,
                                  actor_id, actor_name, actor_role, remarks)
  values (new.id, null, 'open', new.requester_id, new.requester_name,
          'requester', 'Work order raised');

  perform si_notify(
    new.requester_id, 'requester', new.id, new.wo_number, 'submitted',
    'Work order submitted',
    v_ref || ' — ' || v_asset ||
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
         || coalesce(' · raised by ' || nullif(btrim(new.requester_name), ''), '')
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

comment on function si_after_work_order_insert() is
  'Opening history row, the requester''s receipt, and the needs-assignment fan-out to every role the transition matrix lets assign a technician: department Supervisors, Managers, Administrators. Deduplicated by id, highest role stamped, actor and requester excluded.';
