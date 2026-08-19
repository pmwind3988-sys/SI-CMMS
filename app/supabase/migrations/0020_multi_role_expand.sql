-- ============================================================================
-- SI — Service Inside · 0020 Multi-role accounts (expand)
-- ============================================================================
-- An account's roles become a set. A working supervisor who also picks up jobs
-- could not exist before this: users.role was one si_role value, so you were
-- either able to assign work or able to do it, never both.
--
-- Design: docs/superpowers/specs/2026-08-19-multi-role-design.md
-- Plan:   docs/superpowers/plans/2026-08-19-multi-role.md
--
-- THE RULE, in one sentence: authorization is the union of the roles held, and
-- rank is the highest of them. Because rank is the maximum, every hierarchy rule
-- 0015 established carries over untouched — a Supervisor+Technician ranks 3,
-- Administrators still cannot edit each other, and only a Superuser still makes
-- an Administrator.
--
-- WHY THIS IS "EXPAND" AND NOT THE WHOLE CHANGE. The design drops users.role in
-- the same breath as adding users.roles. This migration keeps `role` alive as a
-- derived mirror, because the build deployed while it is applied still selects
-- that column and still calls si_set_user_role. Dropping it here would break
-- every signed-in user from the instant this landed until a redeploy finished.
-- 0021 removes the mirror once the new client is out. Each of the two is
-- internally consistent on its own, which is what matters.
--
-- THE ONE LINE THAT MATTERS MOST is the coalesce in si_roles(). Read its comment
-- before touching it. Without that fallback, applying this migration signs out
-- the entire plant for up to an hour, silently.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- Added nullable and tightened afterwards: `add column ... not null` with no
-- default fails on a table that already has rows. Left WITHOUT a default
-- deliberately — `default '{}'` would satisfy not-null and then immediately
-- violate the check below, turning a forgotten `roles` into a confusing
-- constraint error instead of a clear null violation.
alter table users add column if not exists roles si_role[];

/* The backfill has to go through si_protected_override().

   si_guard_protected_user is a BEFORE UPDATE trigger that raises on ANY write
   to a row carrying is_protected — it does not care who is writing or which
   columns are moving, which is the whole point of it. A migration is no
   exception, and the first attempt at this one died on statement 1 with
   "This account is protected. It can only be changed from the database."

   set_config(..., true) is transaction-local and is switched back off the
   instant the write is done, exactly as 0016 does it for the auth-activity
   mirror. NOT widened to "skip when auth.uid() is null": 0016 rejects that
   explicitly, because it would also hand the service-role key and every script
   in app/scripts a free pass to write protected rows.

   Backfilling a protected account's roles is legitimate — it is the same fact
   its `role` already recorded, and leaving it null would violate the not-null
   below and lock the account out of every policy. */
do $$
begin
  perform set_config('si.allow_protected_write', 'on', true);
  update users set roles = array[role] where roles is null;
  perform set_config('si.allow_protected_write', 'off', true);
end $$;

alter table users alter column roles set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_roles_not_empty') then
    alter table users
      add constraint users_roles_not_empty check (cardinality(roles) >= 1);
  end if;
end $$;

comment on column users.roles is
  'Every role this account holds. Authorization is the union of them; rank is the highest. Replaces users.role, which 0021 removes.';

-- Serves the `''supervisor'' = any(roles)` lookups in the notification fan-out,
-- which run inside the SLA sweep once per overdue work order.
create index if not exists users_roles_gin on users using gin (roles);

-- ---------------------------------------------------------------------------
-- 1b. `role`, demoted to a derived mirror
-- ---------------------------------------------------------------------------
-- Nothing should write it from here on; this trigger overwrites whatever was
-- sent. It exists only so the currently-deployed bundle keeps working across
-- this migration, and 0021 deletes both it and the column.
create or replace function si_sync_user_primary_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.role := (
    select r from unnest(new.roles) r
     order by si_role_rank(r::text) desc
     limit 1
  );
  return new;
end;
$$;

revoke all on function si_sync_user_primary_role() from public, anon, authenticated;

-- Named to sort last. BEFORE triggers fire in name order, and this must not run
-- before si_guard_user_self_update has decided whether the write is allowed.
drop trigger if exists z_sync_user_primary_role on users;
create trigger z_sync_user_primary_role
  before insert or update on users
  for each row execute function si_sync_user_primary_role();

-- Fire it once over the table so `role` is derived rather than merely stale.
-- Same override door as the backfill above, and closed again immediately.
do $$
begin
  perform set_config('si.allow_protected_write', 'on', true);
  update users set roles = roles;
  perform set_config('si.allow_protected_write', 'off', true);
end $$;

-- ---------------------------------------------------------------------------
-- 2. The access-token hook
-- ---------------------------------------------------------------------------
-- 0017's function with `roles` in place of `role` and a user_roles claim added.
-- Every other claim is preserved verbatim — dropping is_protected here would
-- silently demote the Superuser to an ordinary rank-5 admin, which is what
-- 0017's entire header is about.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  u      record;
  v_high text;
begin
  select roles, department_id, plant_ids, is_protected
    into u
    from public.users
   where id = (event ->> 'user_id')::uuid;

  if found then
    select r::text into v_high
      from unnest(u.roles) r
     order by si_role_rank(r::text) desc
     limit 1;

    claims := jsonb_set(claims, '{user_roles}',
      coalesce(to_jsonb(array(select r::text from unnest(u.roles) r)), '[]'::jsonb));

    -- Retained: the highest role held. It is what the client lands on and
    -- displays, and it is what si_roles() falls back to for a token minted
    -- before this migration.
    claims := jsonb_set(claims, '{user_role}',     coalesce(to_jsonb(v_high), 'null'::jsonb));
    claims := jsonb_set(claims, '{department_id}', coalesce(to_jsonb(u.department_id), 'null'::jsonb));
    claims := jsonb_set(claims, '{plant_ids}',     coalesce(to_jsonb(u.plant_ids), '[]'::jsonb));
    claims := jsonb_set(claims, '{is_protected}',  to_jsonb(coalesce(u.is_protected, false)));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Restated rather than relied upon, as 0017 does: `create or replace` keeps the
-- existing ACL, but a hook the auth server cannot execute fails closed on every
-- single sign-in.
grant  usage   on schema   public to supabase_auth_admin;
grant  execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant  select  on public.users to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 3. Claim helpers
-- ---------------------------------------------------------------------------

/* The caller's roles.

   THE COALESCE IS A ROLLOUT REQUIREMENT, NOT DEFENSIVENESS. Access tokens live
   up to an hour, so every user signed in when this migration lands is carrying
   a token minted by the old hook: `user_role` present, `user_roles` absent. If
   si_roles() returned empty for those, every membership test below would be
   false, and the entire plant would be locked out until each token happened to
   refresh — silently, in exactly the way the missing is_protected claim failed
   before 0017. With the fallback, a pre-migration token behaves as the single
   role it was issued for and picks up the rest at its next refresh.

   No usable claim at all yields '{}', so an unknown caller can act on nothing.
   Same fail-closed direction as si_role_rank()'s `else 0`.

   Both branches filter against enum_range so a claim carrying a value that is
   not an si_role is dropped rather than raising an invalid-input error. */
create or replace function si_roles()
returns si_role[]
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select array_agg((value #>> '{}')::si_role)
       from jsonb_array_elements(
              case jsonb_typeof(auth.jwt() -> 'user_roles')
                when 'array' then auth.jwt() -> 'user_roles'
                else '[]'::jsonb
              end)
      where value #>> '{}' in (select unnest(enum_range(null::si_role))::text)),
    case
      when nullif(auth.jwt() ->> 'user_role', '') is null then '{}'::si_role[]
      when (auth.jwt() ->> 'user_role') in (select unnest(enum_range(null::si_role))::text)
        then array[(auth.jwt() ->> 'user_role')::si_role]
      else '{}'::si_role[]
    end
  );
$$;

/* Compared as text so an unrecognised argument returns false rather than
   raising an invalid-enum error. */
create or replace function si_has_role(p_role text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from unnest(si_roles()) r where r::text = p_role);
$$;

/* The highest role held.

   After this migration it has no authorization callers, and it must not gain
   any: it answers "what is this person", and every decision in this schema now
   asks "may this person do this". It exists for the hook's user_role claim and
   for the client's landing page and badges. */
create or replace function si_role()
returns text
language sql
stable
set search_path = public
as $$
  select r::text from unnest(si_roles()) r
   order by si_role_rank(r::text) desc
   limit 1;
$$;

create or replace function si_roles_rank(p_roles si_role[])
returns int
language sql
immutable
set search_path = public
as $$
  select coalesce((select max(si_role_rank(r::text)) from unnest(p_roles) r), 0);
$$;

/* The rank of an actual account. Overloads 0015's (text, boolean) version,
   which 0021 drops — si_role[] does not implicitly cast to text, so there is no
   ambiguity while both exist. */
create or replace function si_account_rank(p_roles si_role[], p_is_protected boolean)
returns int
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_is_protected, false) then 6 else si_roles_rank(p_roles) end;
$$;

create or replace function si_caller_rank()
returns int
language sql
stable
set search_path = public
as $$
  select case when si_is_superuser() then 6 else si_roles_rank(si_roles()) end;
$$;

-- Membership, not equality. This is the whole change, expressed five times.
create or replace function si_is_requester()  returns boolean language sql stable set search_path = public as $$ select si_has_role('requester')  $$;
create or replace function si_is_technician() returns boolean language sql stable set search_path = public as $$ select si_has_role('technician') $$;
create or replace function si_is_supervisor() returns boolean language sql stable set search_path = public as $$ select si_has_role('supervisor') $$;
create or replace function si_is_manager()    returns boolean language sql stable set search_path = public as $$ select si_has_role('manager')    $$;
create or replace function si_is_admin()      returns boolean language sql stable set search_path = public as $$ select si_has_role('admin')      $$;

create or replace function si_is_manager_or_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select si_has_role('manager') or si_has_role('admin');
$$;

/* Which of the caller's roles actually authorise this transition on this row.

   Shared by si_guard_work_order_transition (to decide) and by
   si_transition_work_order (to stamp actor_role), so the two cannot disagree
   about who acted as what.

   The two subtractions are the old cross-cutting scope checks, inverted. They
   used to reject the caller outright; now they only remove the role that fails
   them, so a Supervisor+Technician acting on someone else's job still qualifies
   as supervisor. That inversion is the point of the whole function. */
create or replace function si_eligible_roles(
  p_transition_roles si_role[],
  p_assigned_to      uuid,
  p_requester        uuid
)
returns si_role[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(r), '{}'::si_role[])
    from unnest(si_roles()) r
   where r = any(p_transition_roles)
     and (r <> 'technician' or p_assigned_to is not distinct from auth.uid())
     and (r <> 'requester'  or p_requester   is not distinct from auth.uid());
$$;

-- Policy expressions evaluate with the querying user's privileges, so these
-- must be callable by them — the carve-out 0007 documents. Each reports a fixed
-- number or a claim from the caller's own token, so exposing them tells a caller
-- nothing they did not already hold.
revoke all on function si_roles()                               from public, anon;
revoke all on function si_has_role(text)                        from public, anon;
revoke all on function si_role()                                from public, anon;
revoke all on function si_roles_rank(si_role[])                 from public, anon;
revoke all on function si_account_rank(si_role[], boolean)      from public, anon;
revoke all on function si_caller_rank()                         from public, anon;
revoke all on function si_eligible_roles(si_role[], uuid, uuid) from public, anon;
revoke all on function si_is_requester()                        from public, anon;
revoke all on function si_is_technician()                       from public, anon;
revoke all on function si_is_supervisor()                       from public, anon;
revoke all on function si_is_manager()                          from public, anon;
revoke all on function si_is_admin()                            from public, anon;
revoke all on function si_is_manager_or_admin()                 from public, anon;

grant execute on function si_roles()                               to authenticated, service_role;
grant execute on function si_has_role(text)                        to authenticated, service_role;
grant execute on function si_role()                                to authenticated, service_role;
grant execute on function si_roles_rank(si_role[])                 to authenticated, service_role;
grant execute on function si_account_rank(si_role[], boolean)      to authenticated, service_role;
grant execute on function si_caller_rank()                         to authenticated, service_role;
grant execute on function si_eligible_roles(si_role[], uuid, uuid) to authenticated, service_role;
grant execute on function si_is_requester()                        to authenticated, service_role;
grant execute on function si_is_technician()                       to authenticated, service_role;
grant execute on function si_is_supervisor()                       to authenticated, service_role;
grant execute on function si_is_manager()                          to authenticated, service_role;
grant execute on function si_is_admin()                            to authenticated, service_role;
grant execute on function si_is_manager_or_admin()                 to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The users policies
-- ---------------------------------------------------------------------------
-- 0015's rank rule, unchanged. Only the argument to si_account_rank moves from
-- one role to the set, which is what makes "strictly below you" mean "below the
-- highest role they hold".
drop policy if exists users_select on users;
create policy users_select on users
  for select to authenticated
  using (
    (si_is_manager_or_admin() or si_is_supervisor() or id = auth.uid())
    and (id = auth.uid() or si_is_superuser() or not coalesce(is_protected, false))
  );

drop policy if exists users_update on users;
create policy users_update on users
  for update to authenticated
  using (
    id = auth.uid()
    or (si_is_admin() and si_account_rank(roles, is_protected) < si_caller_rank())
  )
  with check (
    id = auth.uid()
    or (si_is_admin() and si_account_rank(roles, is_protected) < si_caller_rank())
  );

drop policy if exists users_insert on users;
create policy users_insert on users
  for insert to authenticated
  with check (
    si_is_admin() and si_account_rank(roles, is_protected) < si_caller_rank()
  );

drop policy if exists users_delete on users;
create policy users_delete on users
  for delete to authenticated
  using (
    si_is_admin() and si_account_rank(roles, is_protected) < si_caller_rank()
  );

-- ---------------------------------------------------------------------------
-- 5. The users column guard
-- ---------------------------------------------------------------------------
-- 0015's guard with `roles` in place of `role`. The self-lock stays ABOVE the
-- admin exemption: RLS always lets you write your own row, so this is the only
-- place that hole closes, and it has to close for Administrators and Superusers
-- too.
--
-- `role` is absent from the non-admin column list because it is derived now —
-- guarding `roles` guards both, and z_sync_user_primary_role overwrites anything
-- a client sent for `role` after this trigger has run.
create or replace function si_guard_user_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No JWT means this is not a client request: the auth-activity trigger (0012)
  -- writing last_login_at, or a service-role script.
  if auth.uid() is null then return new; end if;

  if new.id = auth.uid() then
    if new.roles is distinct from old.roles then
      raise exception 'You cannot change your own roles. Ask someone above you, or change it in Supabase.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status is distinct from old.status then
      raise exception 'You cannot change your own account status.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if si_is_admin() then return new; end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.roles is distinct from old.roles
     or new.department_id is distinct from old.department_id
     or new.plant_ids is distinct from old.plant_ids
     or new.status is distinct from old.status
     or new.seed_source is distinct from old.seed_source
     or new.seed_name is distinct from old.seed_name
     or new.seed_phone is distinct from old.seed_phone
     or new.seeded_at is distinct from old.seeded_at
     or new.password_changed_at is distinct from old.password_changed_at
     or new.last_login_at is distinct from old.last_login_at then
    raise exception 'You may only change your own name, phone, and photo.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function si_guard_user_self_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The transition trigger
-- ---------------------------------------------------------------------------
-- The substantive behavioural change. 0003's version asked "what is this
-- person" and rejected on that; under a union that is wrong, because a
-- Supervisor+Technician acting on a job that is not theirs qualifies as
-- supervisor and the technician check would refuse them.
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
begin
  -- pg_cron, the service role, and admin scripts are trusted, exactly as the
  -- Admin SDK bypassed security rules.
  if auth.uid() is null then return new; end if;

  /* Self-assignment, checked ABOVE the admin bypass so the rule is uniform for
     every role including Administrator and Superuser.

     Precedent: 0015 put the self-role-change lock above the same exemption, for
     the same reason — a rule whose entire purpose is to stop you acting on
     yourself is worthless if the most privileged account is exempt.

     Purely additive for single-role accounts: a Supervisor was never in the
     technicians roster, so they could never have been assigned anything anyway.

     Known consequence, accepted: if one person is simultaneously the only
     active Supervisor and the only active Technician, work orders become
     unassignable by them and a Manager or Admin has to step in. */
  if new.assigned_to_id is distinct from old.assigned_to_id
     and new.assigned_to_id = auth.uid() then
    raise exception 'You cannot assign a work order to yourself. Ask another Supervisor or a Manager.'
      using errcode = 'insufficient_privilege';
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

-- ---------------------------------------------------------------------------
-- 7. The audit trail records the role acted under
-- ---------------------------------------------------------------------------
-- 0010's function, unchanged except for how v_actor_role is derived. It used to
-- read users.role — the account's identity. It now reads the role that actually
-- authorised this move, via the same helper the trigger uses, so the history
-- says "Priya Nair · Supervisor" on the assign and "Priya Nair · Technician" on
-- the accept.
--
-- For a single-role account this is identical to what was stored before.
create or replace function si_transition_work_order(
  p_wo_id      uuid,
  p_to_status  si_wo_status,
  p_fields     jsonb        default '{}'::jsonb,
  p_remarks    text         default null,
  p_via_status si_wo_status default null
)
returns work_orders
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_from        si_wo_status;
  v_assigned_to uuid;
  v_requester   uuid;
  v_trans_roles si_role[];
  v_actor_name  text;
  v_actor_role  si_role;
  v_row         work_orders;
begin
  -- The pre-update values: si_eligible_roles judges the row as it stands now,
  -- which is the same thing the BEFORE UPDATE trigger sees in OLD.
  select status, assigned_to_id, requester_id
    into v_from, v_assigned_to, v_requester
    from work_orders where id = p_wo_id;
  if not found then
    raise exception 'Work order not found, or outside what your role can see.'
      using errcode = 'no_data_found';
  end if;

  select name into v_actor_name from users where id = auth.uid();
  if v_actor_name is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- The first of the (possibly two) transitions is the one the caller had to be
  -- authorised for; p_via_status only exists because verify-and-close records an
  -- intermediate step the same actor performed.
  select roles into v_trans_roles
    from wo_status_transitions
   where from_status = v_from and to_status = coalesce(p_via_status, p_to_status);

  v_actor_role := (
    select r
      from unnest(si_eligible_roles(coalesce(v_trans_roles, '{}'::si_role[]), v_assigned_to, v_requester)) r
     order by si_role_rank(r::text) desc
     limit 1
  );

  -- Empty means the admin bypass: an Administrator skips the matrix, so no
  -- transition row constrained them and there is no "eligible" role to name.
  -- Their highest role is the honest answer.
  if v_actor_role is null then
    v_actor_role := nullif(si_role(), '')::si_role;
  end if;

  -- Explicit whitelist rather than dynamic SQL from p_fields. Only the columns a
  -- transition is ever allowed to carry can be set here; anything else in the
  -- payload is ignored rather than trusted. The trigger-owned columns
  -- (wo_number, the SLA deadlines, decline_count, resolved_at, closed_at,
  -- verified_at, sla_breached) are deliberately absent.
  update work_orders set
    status            = p_to_status,
    assigned_to_id    = case when p_fields ? 'assigned_to_id'
                             then nullif(p_fields->>'assigned_to_id', '')::uuid
                             else assigned_to_id end,
    assigned_to_name  = case when p_fields ? 'assigned_to_name'
                             then p_fields->>'assigned_to_name' else assigned_to_name end,
    decline_reason    = case when p_fields ? 'decline_reason'
                             then p_fields->>'decline_reason' else decline_reason end,
    spare_part_reason = case when p_fields ? 'spare_part_reason'
                             then p_fields->>'spare_part_reason' else spare_part_reason end,
    test_fail_reason  = case when p_fields ? 'test_fail_reason'
                             then p_fields->>'test_fail_reason' else test_fail_reason end,
    resolution_notes  = case when p_fields ? 'resolution_notes'
                             then p_fields->>'resolution_notes' else resolution_notes end,
    reopen_reason     = case when p_fields ? 'reopen_reason'
                             then p_fields->>'reopen_reason' else reopen_reason end,
    verified_by       = case when p_fields ? 'verified_by'
                             then nullif(p_fields->>'verified_by', '')::uuid
                             else verified_by end
  where id = p_wo_id
  returning * into v_row;

  -- RLS filters a denied UPDATE to zero rows rather than raising, so this is
  -- where a permission failure surfaces.
  if not found then
    raise exception 'You do not have permission to change this work order.'
      using errcode = 'insufficient_privilege';
  end if;

  -- p_via_status covers verify-and-close, where the status goes straight from
  -- completed to closed but the trail must still show the verification step.
  if p_via_status is not null then
    insert into work_order_history
      (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks)
    values
      (p_wo_id, v_from, p_via_status, auth.uid(), v_actor_name, v_actor_role, p_remarks),
      (p_wo_id, p_via_status, p_to_status, auth.uid(), v_actor_name, v_actor_role, null);
  else
    insert into work_order_history
      (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks)
    values
      (p_wo_id, v_from, p_to_status, auth.uid(), v_actor_name, v_actor_role, p_remarks);
  end if;

  return v_row;
end
$fn$;

revoke all on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) from public, anon;
grant execute on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) to authenticated;

comment on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) is
  'Atomically advance a work order and append its history row, stamping the role the caller was authorised under. SECURITY INVOKER: RLS and the transition guard still apply.';

-- ---------------------------------------------------------------------------
-- 8. The remaining role readers
-- ---------------------------------------------------------------------------

-- 0019's no-supervisor fallback preserved: a department created from the raise
-- form has no supervisor, and without the fallback its work orders notify
-- nobody — silently, since an empty loop is not an error.
create or replace function si_department_supervisors(p_department_id text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with dept_supervisors as (
    select id
      from users
     where 'supervisor' = any(roles)
       and status = 'active'
       and department_id = p_department_id
  )
  select id from dept_supervisors
  union
  select id
    from users
   where 'supervisor' = any(roles)
     and status = 'active'
     and not exists (select 1 from dept_supervisors);
$$;

create or replace function si_managers()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from users where 'manager' = any(roles) and status = 'active';
$$;

/* Union: the capability is held if ANY role the caller holds has been granted
   it. Superuser stays unconditional — the account that administers the toggles
   must not be able to switch off its own way back. */
create or replace function si_can_delete_work_orders()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select si_is_superuser()
      or exists (
           select 1 from role_permissions rp
            where rp.role = any(si_roles())
              and rp.can_delete_work_orders
         );
$$;

-- 0004's on-demand stats refresh. Membership instead of equality; otherwise
-- unchanged.
create or replace function si_refresh_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;
  if not si_is_manager_or_admin() then
    raise exception 'Only a Manager or Admin can refresh dashboard stats on demand.'
      using errcode = 'insufficient_privilege';
  end if;

  perform si_compute_dashboard_stats();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Setting roles
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so no policy applies and every rule has to be restated.
-- Three enforcement points exist for user administration — these policies, this
-- RPC, and the admin-users Edge Function — and a rule added to one and not the
-- others is a hole, because the loosest path wins.
create or replace function si_set_user_roles(
  p_uid           uuid,
  p_roles         si_role[],
  p_department_id text default null,
  p_plant_ids     text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_rank int := si_caller_rank();
  v_target      record;
  r             si_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;
  if not (si_is_supervisor() or si_is_manager() or si_is_admin()) then
    raise exception 'Only a Supervisor, Manager, or Admin can set roles.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'An account must have at least one role.'
      using errcode = 'check_violation';
  end if;

  select id, roles, is_protected into v_target from users where id = p_uid;
  if not found then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;

  if coalesce(v_target.is_protected, false) then
    raise exception 'This account is protected. It can only be changed from the database.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_uid = auth.uid() then
    raise exception 'You cannot change your own roles.'
      using errcode = 'insufficient_privilege';
  end if;

  if si_account_rank(v_target.roles, v_target.is_protected) >= v_caller_rank then
    raise exception 'You can only change the roles of someone below you.'
      using errcode = 'insufficient_privilege';
  end if;

  -- EVERY role granted must be below the caller, not merely the highest of
  -- them. Checking only the maximum would let a Manager grant admin alongside
  -- requester and have the pair pass as rank 5.
  foreach r in array p_roles loop
    if si_role_rank(r::text) >= v_caller_rank then
      raise exception 'You cannot grant the role "%" — it is at or above your own.', r
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  if si_is_supervisor() and not si_is_manager() and not si_is_admin()
     and p_department_id is distinct from si_department_id() then
    raise exception 'A Supervisor may only provision users within their own department.'
      using errcode = 'insufficient_privilege';
  end if;

  update users
     set roles = p_roles,
         department_id = p_department_id,
         plant_ids = coalesce(p_plant_ids, '{}')
   where id = p_uid;

  -- The technicians profile is created when the role is granted and LEFT IN
  -- PLACE when it is removed: it holds skills and certifications, which are
  -- facts about the person rather than about their current role.
  if 'technician' = any(p_roles) then
    insert into technicians (user_id, name)
    select p_uid, name from users where id = p_uid
    on conflict (user_id) do nothing;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

/* Kept for exactly one release: the deployed bundle still calls it. 0021 drops
   it. Delegating rather than duplicating means it cannot enforce a weaker rule
   than the function above. */
create or replace function si_set_user_role(
  p_uid uuid,
  p_role si_role,
  p_department_id text default null,
  p_plant_ids text[] default '{}'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select si_set_user_roles(p_uid, array[p_role], p_department_id, p_plant_ids);
$$;

revoke all on function si_set_user_roles(uuid, si_role[], text, text[]) from public, anon;
grant execute on function si_set_user_roles(uuid, si_role[], text, text[]) to authenticated;
revoke all on function si_set_user_role(uuid, si_role, text, text[]) from public, anon;
grant execute on function si_set_user_role(uuid, si_role, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Three stragglers that still decided on si_role()
-- ---------------------------------------------------------------------------
-- Found by auditing every si_role() caller rather than trusting the inventory.
-- The first two work by accident under a union — si_role() returns the highest
-- role held, and the roles they test for are the higher ones — but they are
-- authorization decisions asking "what is this person", which is precisely the
-- question this migration replaces. The third is not an accident: it would
-- break outright when 0021 drops the column.

-- technicians: Supervisor/Manager/Admin unrestricted, a technician limited to
-- their own row.
drop policy if exists technicians_update on technicians;
create policy technicians_update on technicians
  for update to authenticated
  using (
    si_is_supervisor() or si_is_manager() or si_is_admin() or user_id = auth.uid()
  )
  with check (
    si_is_supervisor() or si_is_manager() or si_is_admin() or user_id = auth.uid()
  );

-- The column guard behind that policy (0002): a technician may set their own
-- availability and nothing else.
create or replace function si_guard_technician_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if si_is_supervisor() or si_is_manager() or si_is_admin() then return new; end if;

  if (to_jsonb(new) - 'availability_status' - 'updated_at')
     <> (to_jsonb(old) - 'availability_status' - 'updated_at') then
    raise exception 'You may only change your own availability status.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke all on function si_guard_technician_update() from public, anon, authenticated;

/* 0018's deletion archive. This one is load-bearing for 0021.

   It declares `v_actor users%rowtype` and stamps
   `coalesce(si_role(), v_actor.role::text)`. plpgsql resolves record fields at
   execution time, so the moment 0021 drops users.role this function starts
   raising on every DELETE — and the only symptom would be that deleting a work
   order stopped working, with nothing pointing at the column that went away.

   Same fallback shape, reading the set instead. */
create or replace function si_archive_deleted_work_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor users%rowtype;
begin
  select * into v_actor from users where id = auth.uid();

  insert into work_order_deletions (
    work_order_id, wo_number, asset_name, department_id, status, priority,
    requester_name, assigned_to_name, raised_at,
    deleted_by, deleted_by_name, deleted_by_role, snapshot
  ) values (
    old.id, old.wo_number, old.asset_name, old.department_id,
    old.status::text, old.priority::text,
    old.requester_name, old.assigned_to_name, old.created_at,
    auth.uid(),
    v_actor.name,
    coalesce(
      si_role(),
      (select r::text from unnest(v_actor.roles) r
        order by si_role_rank(r::text) desc limit 1)
    ),
    to_jsonb(old)
  );

  delete from attachments   where entity_type = 'work_order' and entity_id = old.id;
  delete from comments      where entity_type = 'work_order' and entity_id = old.id;
  delete from notifications where entity_type = 'work_order' and entity_id = old.id;

  return old;
end;
$$;

revoke all on function si_archive_deleted_work_order() from public, anon, authenticated;
