-- ============================================================================
-- SI — Service Inside · 0077 Who may assign a technician is a Superuser setting
-- ============================================================================
-- Until now the eight assignment moves in wo_status_transitions — the first
-- assignment, the pre-acceptance reassignment and the six mid-flight handovers
-- — named `{supervisor,manager,admin}` as a literal written by 0003. HODs could
-- not assign at all, and changing that took a migration.
--
-- It becomes a capability on role_permissions, next to 0018's deletion toggle,
-- and ships as: **HOD and Administrator allowed, everyone else not.** Only a
-- Superuser can change it (role_permissions_update is already `si_is_superuser()`).
--
-- ---------------------------------------------------------------------------
-- The matrix is kept in step with the toggle, rather than the guard reading
-- the toggle instead of the matrix
-- ---------------------------------------------------------------------------
-- The transition guard is not the only reader of those eight rows. The client
-- reads the matrix to say whose move it is (lib/nextStep.js), and 0054's
-- fan-out was written as "whoever the assignment row names". Teaching only the
-- guard to consult role_permissions would leave the matrix saying Supervisor
-- while the guard said HOD, and the screen would promise moves the database
-- refuses. So an AFTER trigger on role_permissions rewrites `roles` on exactly
-- the rows that require `assigned_to_id`, and the guard, si_eligible_roles()
-- and the client go on reading one thing. wo_status_transitions has no write
-- policy for anyone, so nothing but this trigger (and a migration) moves it.
--
-- ---------------------------------------------------------------------------
-- Administrator is always allowed, and that is enforced, not just displayed
-- ---------------------------------------------------------------------------
-- The guard's admin bypass already lets an Administrator make any move, so an
-- "admin: not allowed" row would be a switch that decides nothing — the 0026
-- failure. The stamp trigger refuses it instead, with a sentence, and the
-- screen locks that checkbox. A Superuser is an Administrator (0017), so the
-- account holding the switches keeps its own way to assign.
--
-- ---------------------------------------------------------------------------
-- Three more places had to follow, or the grant would not work
-- ---------------------------------------------------------------------------
--   * users_select. The technician roster is an inner join onto `users`, and
--     only Supervisor, Manager and Admin could read that table — so an HOD
--     granted the capability would open the Assignment tab to an empty roster
--     reading "no technicians". The policy gains `si_can_assign_technicians()`.
--     Nothing is taken away: the existing branches stay, so switching
--     Supervisors off does not also stop them reading names they read today.
--   * si_notify_assigners(). "A work order needs assigning", accept, decline
--     and waiting-for-a-part go to whoever can assign, and that is now the
--     toggle rather than a hardcoded three. Supervisors, when granted, are
--     still routed by department (0054's reasoning is untouched); every other
--     granted role is plant-wide. Consequence to expect: with the shipped
--     defaults, Managers and Supervisors stop receiving those four.
--   * The self-assignment refusal said "Ask another Supervisor or a Manager",
--     which is now usually the wrong advice. The guard is restated from 0023
--     with that one sentence changed and nothing else.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The column, the missing HOD row, and the shipped defaults
-- ---------------------------------------------------------------------------
alter table role_permissions
  add column if not exists can_assign_technicians boolean not null default false;

-- 0058 added 'hod' to si_role after 0018 seeded one row per role, and nothing
-- inserted one for it — so the Permissions screen has been showing HOD with a
-- disabled checkbox. Deletion stays off for it, as it is for every non-admin.
insert into role_permissions (role, can_delete_work_orders, can_assign_technicians)
values ('hod', false, true)
on conflict (role) do nothing;


-- ---------------------------------------------------------------------------
-- 2. The stamp trigger refuses switching Administrator off
-- ---------------------------------------------------------------------------
-- 0018's body, plus the refusal. Restated in full because `create or replace`
-- cannot amend one line.
create or replace function si_stamp_role_permission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.role       := old.role;

  if new.role = 'admin' and not new.can_assign_technicians then
    raise exception 'Administrators can always assign technicians. That one cannot be switched off.'
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function si_stamp_role_permission() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. The capability helper
-- ---------------------------------------------------------------------------
-- Same shape as si_can_delete_work_orders() (0018, 0020): a union over the
-- roles held. Administrator is unconditional here for the reason in the
-- header, which also covers the Superuser. SECURITY DEFINER because users_select
-- calls it, and a policy expression runs with the caller's privileges.
create or replace function si_can_assign_technicians()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select si_has_role('admin')
      or exists (
           select 1 from role_permissions rp
            where rp.role = any(si_roles())
              and rp.can_assign_technicians
         );
$$;

revoke all on function si_can_assign_technicians() from public, anon;
grant execute on function si_can_assign_technicians() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. The matrix follows the toggle
-- ---------------------------------------------------------------------------
-- The rows are identified by what they are — every move that sets an assignee
-- requires `assigned_to_id` — rather than by a list of status pairs, so a
-- reassignment row added later is covered without anyone remembering this.
-- `admin` is appended unconditionally as a second guarantee on top of the
-- stamp trigger's refusal; `distinct` keeps it from appearing twice.
create or replace function si_sync_assignment_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update wo_status_transitions
     set roles = (
           select array_agg(r order by si_role_rank(r::text))
             from (
               select role as r from role_permissions where can_assign_technicians
               union
               select 'admin'::si_role
             ) granted
         )
   where 'assigned_to_id' = any(requires);
  return null;
end;
$$;

revoke all on function si_sync_assignment_roles() from public, anon, authenticated;

drop trigger if exists role_permissions_sync_assignment on role_permissions;
create trigger role_permissions_sync_assignment
  after insert or update on role_permissions
  for each statement execute function si_sync_assignment_roles();

-- The shipped defaults. This UPDATE fires the trigger above, which is what
-- rewrites the eight matrix rows — the migration exercises the path every
-- later Superuser change will take.
update role_permissions
   set can_assign_technicians = (role in ('hod', 'admin'));

-- Realtime, so a changed grant reaches the "whose move is it" line on every
-- open work order the way role_permissions itself already does (0018).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'wo_status_transitions'
  ) then
    alter publication supabase_realtime add table wo_status_transitions;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Whoever may assign may read the roster
-- ---------------------------------------------------------------------------
-- 0047's policy with one clause added to the first half. The second half —
-- protected accounts hidden from everyone but themselves and a Superuser — is
-- untouched, so a protected account never appears in the roster either.
drop policy if exists users_select on users;
create policy users_select on users
  for select to authenticated
  using (
    (si_is_manager_or_admin() or si_is_supervisor() or si_can_assign_technicians()
       or id = auth.uid())
    and (id = auth.uid() or si_is_superuser() or not coalesce(is_protected, false))
  );


-- ---------------------------------------------------------------------------
-- 6. The fan-out follows the toggle
-- ---------------------------------------------------------------------------
-- 0054's loop with the recipient set changed and its three silent-when-wrong
-- properties kept: dedupe by id keeping the highest role held, exclude the
-- actor and p_exclude, and strip NULLs from the exclusion array.
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
        -- Supervisors, when granted, are still routed by department.
        select s, 'supervisor'::si_role, si_role_rank('supervisor')
          from si_department_supervisors(p_department_id) s
         where exists (select 1 from role_permissions
                        where role = 'supervisor' and can_assign_technicians)
        union all
        -- Every other granted role, plant-wide. Administrator always.
        select u.id, rp.role, si_role_rank(rp.role::text)
          from role_permissions rp
          join users u on rp.role = any(u.roles) and u.status = 'active'
         where rp.role <> 'supervisor'
           and (rp.can_assign_technicians or rp.role = 'admin')
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
  'Notifies everyone role_permissions lets assign technicians (migration 0077) — granted Supervisors by department, every other granted role plant-wide, Administrators always — once each, stamped with the highest role held, skipping p_exclude. Not callable from a client.';


-- ---------------------------------------------------------------------------
-- 7. The transition guard — 0023's body, one sentence changed
-- ---------------------------------------------------------------------------
create or replace function si_guard_work_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t          wo_status_transitions;
  v_eligible si_role[];
  v_field    text;
  v_assignee record;
begin
  -- pg_cron, the service role, and admin scripts are trusted, exactly as the
  -- Admin SDK bypassed security rules.
  if auth.uid() is null then return new; end if;

  /* Self-assignment, checked ABOVE the admin bypass so the rule is uniform for
     every role including Administrator and Superuser. See 0020 and 0023.

     0077: the sentence no longer names Supervisor and Manager, because which
     roles may assign is a Superuser setting now and those two are off by
     default. */
  if new.assigned_to_id is distinct from old.assigned_to_id
     and new.assigned_to_id = auth.uid() then
    raise exception 'You cannot assign a work order to yourself. Ask someone else who can assign technicians.'
      using errcode = 'insufficient_privilege';
  end if;

  /* The assignment also has to land on someone who can move it — see 0023 for
     the full argument. Checked only when the assignee changes, and above the
     admin bypass. */
  if new.assigned_to_id is distinct from old.assigned_to_id
     and new.assigned_to_id is not null then
    select name, roles, status into v_assignee
      from users
     where id = new.assigned_to_id;

    if not found then
      raise exception 'That account no longer exists. Reload and choose another technician.'
        using errcode = 'no_data_found';
    end if;

    if not ('technician' = any(v_assignee.roles)) then
      raise exception '% does not hold the Technician role, so they could never accept this work order. Grant it in Admin -> Users, or choose another technician.',
        coalesce(v_assignee.name, 'That account')
        using errcode = 'check_violation';
    end if;

    if v_assignee.status <> 'active' then
      raise exception 'The account for % is inactive, so they could never accept this work order. Reactivate it in Admin -> Users, or choose another technician.',
        coalesce(v_assignee.name, 'That account')
        using errcode = 'check_violation';
    end if;
  end if;

  -- Administrator bypasses the matrix outright. Deliberate and narrow; policy,
  -- not this trigger, is what keeps it used sparingly.
  if si_has_role('admin') then return new; end if;

  if cardinality(si_roles()) = 0 then
    raise exception 'Your account has no role assigned — sign out and back in.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t
    from wo_status_transitions
   where from_status = old.status and to_status = new.status;

  if not found then
    raise exception '% is not a permitted transition from %.', new.status, old.status
      using errcode = 'check_violation';
  end if;

  v_eligible := si_eligible_roles(t.roles, old.assigned_to_id, old.requester_id);

  /* Two different refusals, because they send the reader to different places.
     Holding none of the transition's roles is "your job does not do this".
     Holding one but failing its scope test is "not on this record". */
  if cardinality(v_eligible) = 0 then
    if not (si_roles() && t.roles) then
      raise exception 'A % may not perform "%" (% -> %).',
        array_to_string(array(select r::text from unnest(si_roles()) r), '/'),
        coalesce(t.label, 'this transition'), old.status, new.status
        using errcode = 'insufficient_privilege';
    elsif 'technician' = any(t.roles) and si_has_role('technician') then
      raise exception 'You can only act on work orders assigned to you.'
        using errcode = 'insufficient_privilege';
    else
      raise exception 'You can only act on work orders you raised.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if t.requires_assignee_change
     and new.assigned_to_id is not distinct from old.assigned_to_id then
    raise exception 'Reassigning a work order at status "%" requires a different technician.', old.status
      using errcode = 'check_violation';
  end if;

  -- Required fields must be present and non-empty.
  foreach v_field in array t.requires loop
    if coalesce(to_jsonb(new) ->> v_field, '') = '' then
      raise exception '"%" is required for "%" (% -> %).',
        v_field, coalesce(t.label, 'this transition'), old.status, new.status
        using errcode = 'not_null_violation';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function si_guard_work_order_transition() from public, anon, authenticated;
