-- ===========================================================================
-- 0039 — The technician flow loses two rungs, and every photo says who took it
--
-- Two unrelated changes in one file. They share no statement; they share this
-- slot because a half-applied pair is worse than an atomic one, and because
-- the CLI orders by filename and nothing can be inserted between two existing
-- migrations later (0013's header records why).
--
-- PART 1 — `on_the_way` and `on_site` are removed from the workflow.
--   A technician who has accepted a job presses Start Work and the job goes
--   straight to `repairing`. The two enum values survive, because
--   work_order_history holds real rows carrying them and an audit trail that
--   stops resolving its own labels is not an audit trail.
--
-- PART 2 — attachments record their uploader's name and the phase of the work
--   order they were taken in, stamped server-side.
-- ===========================================================================


-- ===========================================================================
-- PART 1 · THE SHORT TECHNICIAN FLOW
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1.1  The transition matrix is the boundary, so it moves first.
--
-- The permitted moves are rows (0003), not code. Once these five are gone and
-- the sixth is in, si_guard_work_order_transition refuses the old flow on its
-- own and no client change can re-enable it. That is the whole reason the
-- matrix is data.
--
-- The two `x -> x` rows are 0003's "reassign mid-flight" pairs. They let a
-- Supervisor hand a travelling job to somebody else; with no way to reach
-- either status they are unreachable rows, and leaving them would be leaving a
-- rule that decides nothing — the failure this schema has shipped twice
-- (users.status in 0026, and 0031's argument about a retirement that only
-- filters a dropdown).
-- ---------------------------------------------------------------------------
delete from wo_status_transitions
 where (from_status, to_status) in (
   ('accepted',    'on_the_way'),
   ('on_the_way',  'on_site'),
   ('on_site',     'repairing'),
   ('on_the_way',  'on_the_way'),
   ('on_site',     'on_site')
 );

-- Carries `on_site -> repairing`'s exact shape — same roles, no required
-- fields, no assignee change — so nothing about the move itself changes. Only
-- where it starts from.
insert into wo_status_transitions
  (from_status, to_status, roles, requires, requires_assignee_change, label)
values
  ('accepted', 'repairing', '{technician,manager,admin}', '{}', false, 'Start work')
on conflict (from_status, to_status) do update
  set roles                    = excluded.roles,
      requires                 = excluded.requires,
      requires_assignee_change = excluded.requires_assignee_change,
      label                    = excluded.label;


-- ---------------------------------------------------------------------------
-- 1.2  wo_statuses gains `is_active`, and the two rungs are retired on it.
--
-- This is 0031's retire pattern applied to the one lookup table 0031
-- deliberately skipped. 0031's reasoning was that nobody *picks* a status — the
-- workflow moves through them — so the equivalent of retiring one is editing
-- wo_status_transitions. Section 1.1 above is exactly that edit. This flag is
-- not the enforcement and must never become it: it decides only which rungs the
-- timeline ladder draws for a new work order, which is display, and narrowing
-- display is always the sanctioned direction.
--
-- The rows STAY, and every client keeps loading them. That is the point of
-- retiring rather than deleting: a work order closed last month has history
-- rows reading 'on_the_way', and statusLabel/statusColor still have to resolve
-- them to "On The Way" and its amber. Deleting the rows would turn those into
-- blank grey badges — 0031's argument about P4, one table over.
-- ---------------------------------------------------------------------------
alter table wo_statuses
  add column if not exists is_active boolean not null default true;

comment on column wo_statuses.is_active is
  'False = a rung the workflow can no longer reach. Display only: the boundary '
  'is wo_status_transitions. Retired rows are still loaded so historic badges '
  'keep their label and colour (migration 0039).';

update wo_statuses set is_active = false where code in ('on_the_way', 'on_site');

-- Without this any Administrator could hide a live rung from every timeline
-- through the ordinary relabelling policy 0009 granted them. si_guard_reference_retire
-- is written against tg_table_name and already handles the generic `is_active`
-- case, so it needs no amendment — only the trigger. wo_statuses is correctly
-- absent from its "last one standing" list: that check protects the raise
-- form's pickers, and nobody picks a status.
drop trigger if exists si_guard_reference_retire_trg on wo_statuses;
create trigger si_guard_reference_retire_trg before update on wo_statuses
  for each row execute function si_guard_reference_retire();


-- ---------------------------------------------------------------------------
-- 1.3  Anything currently mid-flight is moved to Repairing.
--
-- Not tidiness — without this those work orders are stranded. Section 1.1 just
-- deleted the only rows out of their status, so WorkflowPanel offers no button
-- and the technician cannot finish the job.
--
-- Two triggers have to be off for the one statement, and both reasons matter:
--
--   a_guard_work_order_transition would REFUSE the move. There is no matrix row
--   for on_site -> repairing any more, and auth.uid() is null on a migration
--   connection so the admin bypass does not apply either.
--
--   after_work_order_update would fan a notification out per affected work
--   order for a change nobody made. accepted -> repairing becomes a notifying
--   transition in 1.4 below, and these rows are not arriving there by anyone's
--   action.
--
-- b_stamp_work_order stays ENABLED. Its stamping is what should happen.
-- ---------------------------------------------------------------------------
alter table work_orders disable trigger a_guard_work_order_transition;
alter table work_orders disable trigger after_work_order_update;

-- History first, reading the status the row still has. Reversed, every row
-- would already say 'repairing' and from_status would be a lie.
--
-- actor_id is `not null references users(id)`, so this cannot record nobody. It
-- borrows the assignee's id to satisfy the key and then states the truth in the
-- two columns that are actually displayed: actor_name names the migration, and
-- the remark says plainly that the technician did not do this. A timeline entry
-- attributing an action to somebody who did not take it would be worse than the
-- status jump it exists to explain.
insert into work_order_history
  (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks)
select w.id,
       w.status,
       'repairing'::si_wo_status,
       coalesce(w.assigned_to_id, w.requester_id),
       'System (migration 0039)',
       null,
       'Moved to Repairing because the On The Way and On Site steps were '
       'removed from the workflow. Not an action by the technician.'
  from work_orders w
 where w.status in ('on_the_way', 'on_site')
   and coalesce(w.assigned_to_id, w.requester_id) is not null;

update work_orders
   set status = 'repairing'
 where status in ('on_the_way', 'on_site');

alter table work_orders enable trigger a_guard_work_order_transition;
alter table work_orders enable trigger after_work_order_update;


-- ---------------------------------------------------------------------------
-- 1.4  "Technician has arrived" becomes "Technician has started work".
--
-- The requester's arrival alert fired on on_the_way -> on_site, a moment that
-- no longer exists. It moves to accepted -> repairing and is reworded. What the
-- requester cared about was that somebody is physically on the job; they now
-- learn it one step later instead of not at all.
--
-- Every other branch is 0038's, byte for byte — restated because
-- `create or replace function` has no way to amend one branch of a body. The
-- same note 0038's own header carries about 0003.
-- ---------------------------------------------------------------------------
create or replace function si_notify_work_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supervisor uuid;
  v_recipient  uuid;
  v_role       si_role;
  v_seen       uuid[];
  v_asset text := coalesce(new.asset_name, 'equipment');
  v_ref   text := coalesce(new.wo_number, 'This work order');
  v_who   text;
  v_why   text;
begin
  if new.status = old.status then return null; end if;

  if new.status = 'assigned' and new.assigned_to_id is not null then
    perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
      'assigned', 'You''ve been assigned a work order',
      v_ref || ' — ' || v_asset);
  end if;

  if old.status = 'assigned' and new.status = 'open' then
    v_why  := nullif(btrim(coalesce(new.decline_reason, '')), '');
    v_seen := array[auth.uid()];
    for v_recipient, v_role in
      select distinct on (t.id) t.id, t.r
        from (
          select s, 'supervisor'::si_role, 3 from si_department_supervisors(new.department_id) s
          union all
          select m, 'manager'::si_role,    4 from si_managers() m
          union all
          select a, 'admin'::si_role,      5 from si_admins()   a
        ) as t(id, r, rk)
       where t.id is not null
         and t.id <> all (v_seen)
       order by t.id, t.rk desc
    loop
      perform si_notify(v_recipient, v_role, new.id, new.wo_number,
        'declined', 'Technician declined — needs reassignment',
        v_ref || ' — ' || v_asset || coalesce(' · ' || v_why, ''));
    end loop;
  end if;

  if old.status = 'assigned' and new.status = 'accepted' then
    v_who  := coalesce(new.assigned_to_name, 'A technician');
    v_seen := array[auth.uid()];

    -- The Requester's wording is unchanged from 0003 and is deliberately
    -- warmer than the ops chain's: it is the one of the two written for
    -- somebody waiting on the repair rather than managing it.
    if new.requester_id is not null and new.requester_id <> all (v_seen) then
      perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
        'status_change', 'Technician accepted your work order',
        v_who || ' has accepted ' || v_ref || ' and will start shortly.');
      v_seen := v_seen || new.requester_id;
    end if;

    for v_recipient, v_role in
      select distinct on (t.id) t.id, t.r
        from (
          select s, 'supervisor'::si_role, 3 from si_department_supervisors(new.department_id) s
          union all
          select m, 'manager'::si_role,    4 from si_managers() m
          union all
          select a, 'admin'::si_role,      5 from si_admins()   a
        ) as t(id, r, rk)
       where t.id is not null
         and t.id <> all (v_seen)
       order by t.id, t.rk desc
    loop
      perform si_notify(v_recipient, v_role, new.id, new.wo_number,
        'accepted', 'Technician accepted a work order',
        v_who || ' has accepted ' || v_ref || ' — ' || v_asset || '.');
    end loop;
  end if;

  -- Replaces 0038's `on_the_way -> on_site` branch. Requester only, matching
  -- what that branch did: the ops chain already heard about this work order at
  -- accept, and hearing again a minute later when the same technician starts is
  -- noise on a table that has no retention.
  if old.status = 'accepted' and new.status = 'repairing' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'status_change', 'Technician has started work',
      coalesce(new.assigned_to_name, 'A technician') || ' has started work on ' || v_ref || '.');
  end if;

  if new.status = 'completed' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'completed', 'Your work order was completed — please verify',
      v_ref || ' — ' || v_asset);
  end if;

  -- Reopening is operationally significant enough that the department's
  -- Supervisor should know too, not just the technician doing the work. Unlike
  -- Decline, this is not asking them to act, only to be aware.
  if old.status = 'completed' and new.status = 'repairing' then
    if new.assigned_to_id is not null then
      perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
        'reopened', 'Work order reopened by requester',
        v_ref || ' — ' || v_asset);
    end if;
    for v_supervisor in select si_department_supervisors(new.department_id) loop
      perform si_notify(v_supervisor, 'supervisor', new.id, new.wo_number,
        'reopened', 'Work order reopened by requester',
        v_ref || ' — ' || v_asset || ' was not fixed and has been reopened.');
    end loop;
  end if;

  return null;
end;
$$;

-- Re-issued because a `create or replace` resets options an earlier `alter` or
-- `revoke` set — the trap 0034's header records. 0007 line 38 is the original.
revoke all on function si_notify_work_order_update() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1.5  The SLA sweep's "still in flight" list.
--
-- After 1.3 nothing can hold either status. A list naming values nothing can
-- hold is the same shape of dead rule as a column nobody reads, so it is
-- trimmed rather than left as a harmless superset.
-- ---------------------------------------------------------------------------
create or replace function si_open_statuses() returns si_wo_status[]
language sql immutable as $$
  select array['open','assigned','accepted',
               'repairing','waiting_spare_part','testing']::si_wo_status[];
$$;


-- ===========================================================================
-- PART 2 · WHERE A PHOTO CAME FROM
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2.1  Two columns, both nullable.
--
-- Nullable deliberately. Rows written before today have no honest value for
-- either, and `null` says "not recorded" where a backfilled guess would be
-- indistinguishable from a fact a year from now. The client renders those under
-- their own "Uploaded earlier" heading rather than filing them under a phase
-- nobody measured.
--
-- uploaded_by_name is denormalised rather than joined at read time, for the
-- reason 0029 records: users_select hides test accounts and protected accounts,
-- so a join returns nothing for exactly those rows and the photo would show no
-- uploader at all. Same argument as work_order_history.actor_name and
-- comments.author_name — and, like them, the column records a name in a moment
-- and does not follow a later rename.
-- ---------------------------------------------------------------------------
alter table attachments
  add column if not exists uploaded_by_name text,
  add column if not exists wo_status        si_wo_status;

comment on column attachments.uploaded_by_name is
  'Uploader''s name at upload time, denormalised because users_select hides '
  'test and protected accounts from a read-time join (migration 0039).';
comment on column attachments.wo_status is
  'The work order''s status when this file was uploaded — the phase it '
  'documents. Null for rows written before 0039, and for any entity_type '
  'other than work_order.';

create index if not exists attachments_wo_status_idx
  on attachments (entity_id, wo_status);


-- ---------------------------------------------------------------------------
-- 2.2  A trigger stamps all four provenance columns. The client stops sending
--      any of them.
--
-- addAttachment() used to send uploaded_by_id and uploaded_by_role from the
-- browser. A phase the client supplies is a phase the client can omit or get
-- wrong, and this repo has shipped that failure twice: users.status was written
-- by the admin screen and read by no policy, trigger or predicate for four
-- migrations (0026), and 0031's header makes the same argument about a
-- retirement that only filters a dropdown. So this is owned server-side, the
-- same way si_transition_work_order reads actor_id/actor_name/actor_role from
-- auth.uid() rather than taking them as arguments.
--
-- Four things here are load-bearing:
--
--   * `coalesce(auth.uid(), new.uploaded_by_id)` rather than a bare assignment,
--     so the bootstrap and seed scripts still run. A null uid means a
--     service-role connection, already authenticated as trusted somewhere else
--     — the same door si_protected_override() and si_guard_test_account open.
--
--   * The role is the HIGHEST held, read from users.roles. Since 0020 an
--     account holds a set; uploaded_by_role is singular and stays singular,
--     because it records a role in a moment and a moment has one. Reading the
--     table rather than si_roles() also means a service-role insert stamps a
--     real role instead of nothing.
--
--   * attachments_insert's `with check (uploaded_by_id = auth.uid())` still
--     applies and now always passes. BEFORE row triggers run before RLS's WITH
--     CHECK is evaluated on the resulting row, so this trigger is what SATISFIES
--     the policy, not what bypasses it. The policy stays the boundary.
--
--   * wo_status is stamped for every uploader, not only technicians. One rule
--     is cheaper than two and it makes the grouping coherent: a requester's
--     photos from the raise form land under the first phase on their own,
--     without a special case anywhere.
-- ---------------------------------------------------------------------------
create or replace function si_stamp_attachment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(auth.uid(), new.uploaded_by_id);
begin
  new.uploaded_by_id := v_uid;

  select u.name,
         (select r
            from unnest(u.roles) r
           order by si_role_rank(r::text) desc
           limit 1)
    into new.uploaded_by_name, new.uploaded_by_role
    from users u
   where u.id = v_uid;

  if new.entity_type = 'work_order' then
    select w.status into new.wo_status
      from work_orders w
     where w.id = new.entity_id;
  else
    new.wo_status := null;
  end if;

  return new;
end;
$$;

-- A trigger body with no caller in the app — the shape 0033 used. Note that
-- probing this with the anon key proves nothing on its own: PostgREST answers
-- PGRST202 for any function returning `trigger`, on the service role too, so
-- "could not find the function" is not evidence of a revoked grant (0036's
-- header measured this).
revoke all on function si_stamp_attachment() from public, anon, authenticated;

drop trigger if exists a_stamp_attachment on attachments;
create trigger a_stamp_attachment
  before insert on attachments
  for each row execute function si_stamp_attachment();
