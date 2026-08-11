-- ============================================================================
-- SI — Service Inside · 0015 Role hierarchy
-- ============================================================================
-- Replaces the flat "an Administrator may write any users row" rule with a rank
-- comparison that applies at every level, not just at the top.
--
--   requester(1) → technician(2) → supervisor(3) → manager(4) → admin(5)
--                                                            → superuser(6)
--
-- The rule, in one sentence: you may write a users row if it is your own, or if
-- its rank is strictly below yours. Everything below is that sentence applied to
-- the four policies, the column guard, and the one RPC that bypasses them.
--
-- Consequences, all deliberate:
--   * A Superuser can create and edit Administrators. 5 is below 6.
--   * An Administrator cannot. 5 is not below 5 — so Administrators can neither
--     edit each other nor mint peers, and the only route to a new Administrator
--     is a Superuser.
--   * Every other rank works identically: a Manager reaches Supervisors and
--     below, a Supervisor reaches Technicians and Requesters. That is the rule
--     being uniform, not a new grant — see the note on screens below.
--   * Nobody changes their own role or account status, Superuser included.
--     RLS always lets you write your own row, so si_guard_user_self_update is
--     the only place that hole closes. It also removes the last way an
--     Administrator could lock themselves out.
--
-- ON SCREENS. This migration changes who the *database* permits, not who gets a
-- Users screen. users_update still gates its non-self branch on si_is_admin(),
-- so Managers and Supervisors write no rows but their own, exactly as before,
-- and /admin/users stays Admin-only per CLAUDE.md. Where the uniform rule does
-- reach them is si_set_user_role, which they have always been able to call —
-- see the escalation note on that function.
--
-- ON "SUPERUSER". There is no sixth value in the si_role enum, and adding one
-- would be the expensive way to do this: si_is_admin() would start returning
-- false for the very account that needs the most access, so every policy, every
-- RequireRole and every wo_status_transitions row would need auditing. Instead a
-- Superuser is role='admin' with users.is_protected — the flag the hosted
-- project already carries and already injects into the JWT. Every existing admin
-- check keeps passing for them untouched; only the rank comparison sees the
-- extra tier.
--
-- That does fuse two ideas — "outranks everyone" and "administered only from
-- Supabase" — into one column. For this system they are the same account, so
-- the fusion is honest rather than lazy. If a protected non-superuser account is
-- ever wanted, splitting them is one new column plus a line in
-- custom_access_token_hook.
--
-- A Superuser is still unwritable from the app: si_guard_protected_user refuses
-- every write to a protected row whoever is asking, so even they change their
-- own name in Supabase. That is the point of the flag.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The hierarchy
-- ---------------------------------------------------------------------------
-- Unknown or absent roles rank 0, below every real role, so a caller with no
-- usable claim can write nobody's row rather than everybody's. The failure
-- direction matters more than the numbers.
create or replace function si_role_rank(p_role text)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_role
           when 'requester'  then 1
           when 'technician' then 2
           when 'supervisor' then 3
           when 'manager'    then 4
           when 'admin'      then 5
           else 0
         end;
$$;

/* Is the *caller* a Superuser? Read from the JWT claim rather than from
   public.users, for the same reason every other policy helper does: a policy
   that joins back to users to decide access to users is a recursion waiting to
   happen. A missing claim reads false, so a token issued before the hook
   carried it fails closed to plain admin. */
create or replace function si_is_superuser()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'is_protected')::boolean, false);
$$;

/* The rank of an actual account, as opposed to the rank of a role name. */
create or replace function si_account_rank(p_role text, p_is_protected boolean)
returns int
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_is_protected, false) then 6 else si_role_rank(p_role) end;
$$;

/* The caller's own rank. */
create or replace function si_caller_rank()
returns int
language sql
stable
set search_path = public
as $$
  select case when si_is_superuser() then 6 else si_role_rank(si_role()) end;
$$;

-- Policy expressions are evaluated with the querying user's privileges, so these
-- must be callable by them — the carve-out 0007 documents for si_role() and the
-- si_is_* helpers. Each reports either a fixed number for a role name or a claim
-- from the caller's own token, so exposing them tells a caller nothing new.
revoke all on function si_role_rank(text)                from public, anon;
revoke all on function si_is_superuser()                 from public, anon;
revoke all on function si_account_rank(text, boolean)    from public, anon;
revoke all on function si_caller_rank()                  from public, anon;
grant execute on function si_role_rank(text)             to authenticated, service_role;
grant execute on function si_is_superuser()              to authenticated, service_role;
grant execute on function si_account_rank(text, boolean) to authenticated, service_role;
grant execute on function si_caller_rank()               to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- SELECT: unchanged, except that a protected account is visible only to itself
-- and to a Superuser. That is what keeps the Superuser out of Admin → Users,
-- out of every count and out of every picker, while leaving it able to sign in
-- and use the app normally.
drop policy if exists users_select on users;
create policy users_select on users
  for select to authenticated
  using (
    (si_is_manager_or_admin() or si_is_supervisor() or id = auth.uid())
    and (id = auth.uid() or si_is_superuser() or not coalesce(is_protected, false))
  );

-- UPDATE: your own row, or one strictly below you.
--
-- `role` and `is_protected` are columns of the row being checked, so the rank
-- comparison needs no subquery — USING sees the rank the target holds now,
-- WITH CHECK the rank they would hold after the write. Both must be below the
-- caller, which is what stops an Administrator promoting a Manager to
-- Administrator: the resulting row would sit at their own rank. For a Superuser
-- the same expression permits it, because theirs is 6.
--
-- Protected rows are left to si_guard_protected_user rather than filtered out
-- here: a policy that excludes them yields a silent zero-row update, whereas the
-- trigger raises 'This account is protected...'. A rejected write should look
-- like a rejected write.
drop policy if exists users_update on users;
create policy users_update on users
  for update to authenticated
  using (
    id = auth.uid()
    or (si_is_admin() and si_account_rank(role::text, is_protected) < si_caller_rank())
  )
  with check (
    id = auth.uid()
    or (si_is_admin() and si_account_rank(role::text, is_protected) < si_caller_rank())
  );

-- INSERT / DELETE: the same rule minus the self branch — you cannot create or
-- delete yourself. Defence in depth for INSERT, since account creation actually
-- runs through the admin-users Edge Function on the service-role key, which
-- bypasses RLS entirely; the matching check lives there too.
drop policy if exists users_insert on users;
create policy users_insert on users
  for insert to authenticated
  with check (
    si_is_admin() and si_account_rank(role::text, is_protected) < si_caller_rank()
  );

drop policy if exists users_delete on users;
create policy users_delete on users
  for delete to authenticated
  using (
    si_is_admin() and si_account_rank(role::text, is_protected) < si_caller_rank()
  );

-- ---------------------------------------------------------------------------
-- Column guard — extends 0002 and 0012
-- ---------------------------------------------------------------------------
-- The self role/status lock runs before the admin exemption because it applies
-- to Administrators and Superusers too. RLS always lets you write your own row,
-- so this is the only place that hole can be closed.
create or replace function si_guard_user_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No JWT means this is not a client request: the auth-activity trigger (0012)
  -- writing last_login_at, or a service-role script. users_update is
  -- `to authenticated` and matches no row when auth.uid() is null, so a browser
  -- can never reach this branch.
  if auth.uid() is null then return new; end if;

  if new.id = auth.uid() then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own role. Ask someone above you, or change it in Supabase.'
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
     or new.role is distinct from old.role
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
-- si_set_user_role — the RPC that bypasses all of the above
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, so no policy applies to it and every rule has to be
-- restated. It previously checked only that the caller was a Supervisor,
-- Manager or Admin, and that a Supervisor stayed inside their own department —
-- which meant a Supervisor could set anyone in their department to 'admin',
-- including themselves. That was a privilege-escalation hole independent of
-- this migration, and it is the place the uniform rank rule matters most.
--
-- The caller list is unchanged: Supervisor and Manager may still call this,
-- exactly as before. They simply cannot reach upward any more.
create or replace function si_set_user_role(
  p_uid uuid,
  p_role si_role,
  p_department_id text default null,
  p_plant_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := si_role();
  v_caller_rank int  := si_caller_rank();
  v_target      record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;
  if v_caller_role not in ('supervisor','manager','admin') then
    raise exception 'Only a Supervisor, Manager, or Admin can set roles.'
      using errcode = 'insufficient_privilege';
  end if;

  select id, role, is_protected into v_target from users where id = p_uid;
  if not found then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;

  if coalesce(v_target.is_protected, false) then
    raise exception 'This account is protected. It can only be changed from the database.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_uid = auth.uid() then
    raise exception 'You cannot change your own role.'
      using errcode = 'insufficient_privilege';
  end if;

  if si_account_rank(v_target.role::text, v_target.is_protected) >= v_caller_rank then
    raise exception 'You can only change the role of someone below you.'
      using errcode = 'insufficient_privilege';
  end if;

  if si_role_rank(p_role::text) >= v_caller_rank then
    raise exception 'You cannot grant a role at or above your own.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_caller_role = 'supervisor'
     and p_department_id is distinct from si_department_id() then
    raise exception 'A Supervisor may only provision users within their own department.'
      using errcode = 'insufficient_privilege';
  end if;

  update users
     set role = p_role,
         department_id = p_department_id,
         plant_ids = coalesce(p_plant_ids, '{}')
   where id = p_uid;

  -- Keep the technicians profile in step with the role.
  if p_role = 'technician' then
    insert into technicians (user_id, name)
    select p_uid, name from users where id = p_uid
    on conflict (user_id) do nothing;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function si_set_user_role(uuid, si_role, text, text[]) from public, anon;
grant execute on function si_set_user_role(uuid, si_role, text, text[]) to authenticated;
