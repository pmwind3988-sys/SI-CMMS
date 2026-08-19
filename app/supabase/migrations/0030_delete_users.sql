-- SI — Service Inside · Migration 0030
--
-- Two things, and the first is a hole rather than a feature.
--
-- PART A. 0028 sealed test accounts against SELECT and UPDATE and left DELETE
-- open. `users_delete` has existed since 0002 (rank rule since 0015/0020) and
-- 0028 never touched it, and `si_guard_test_account_trg` was declared
-- `before insert or update`. A DELETE policy's USING clause is evaluated
-- independently of the SELECT policy, so hiding a row from SELECT does not stop
-- anyone deleting it: an ordinary Administrator holding a fixture's uuid could
-- destroy the account they are not allowed to see or switch. Fixtures are all
-- rank <= 4, so the rank rule did not save them the way it saves a protected
-- account (rank 6 is not below rank 5, which is why the Superuser was never
-- exposed to this).
--
-- PART B. Deleting a user account, Superuser-only.
--
-- The audit trail is the boundary, and it already was: six of the ten foreign
-- keys onto users(id) are ON DELETE NO ACTION —
--   work_orders.requester_id / assigned_to_id / verified_by,
--   work_order_history.actor_id, comments.author_id, attachments.uploaded_by_id
-- so Postgres already refuses to delete anyone who has raised, been assigned,
-- verified, commented, uploaded or appeared in history. That is not an obstacle
-- to route around; it is the audit trail defending itself. This migration makes
-- the refusal legible instead of surfacing a raw constraint violation, and does
-- NOT add cascades. Deactivation remains the answer for a person who has worked.
--
-- The other four are already right and are left alone: technicians.user_id and
-- notifications.recipient_id cascade (a profile extension and ephemera),
-- departments.manager_id and work_orders.updated_by set null.

-- ---------------------------------------------------------------------------
-- 1. The audit trail for deletions
-- ---------------------------------------------------------------------------
-- Same shape as work_order_deletions (0018): columns lifted out of the snapshot
-- so the list reads without unpacking jsonb, plus the whole row for the field
-- these columns did not anticipate.
create table if not exists user_deletions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid        not null,
  name             text,
  email            text,
  employee_id      text,
  roles            text[],
  department_id    text,
  status           text,
  is_test_account  boolean,
  deleted_at       timestamptz not null default now(),
  deleted_by       uuid,
  deleted_by_name  text,
  deleted_by_role  text,
  snapshot         jsonb       not null
);

create index if not exists user_deletions_deleted_at_idx on user_deletions (deleted_at desc);

alter table user_deletions enable row level security;

-- Written only by the trigger below, which runs as the owner. No insert, update
-- or delete policy exists, so the trail cannot be forged or tidied from a
-- client — the shape work_order_history and work_order_deletions both use.
--
-- The test-account branch is not decoration. Without it this table would hand an
-- Administrator the name of every fixture the Superuser ever removed, which is
-- the same leak 0029 closed on the technicians roster: the account is hidden but
-- its name arrives through a side door.
create policy user_deletions_select on user_deletions
  for select to authenticated
  using (
    si_is_admin()
    and (si_is_superuser() or not coalesce(is_test_account, false))
  );

-- ---------------------------------------------------------------------------
-- 2. PART A — close the DELETE hole
-- ---------------------------------------------------------------------------
drop policy if exists users_delete on users;

create policy users_delete on users
  for delete to authenticated
  using (
    si_is_admin()
    and si_account_rank(roles, is_protected) < si_caller_rank()
    -- 0028's clause, which this policy should have received at the time.
    and (si_is_superuser() or not coalesce(is_test_account, false))
  );

-- The guard gains a DELETE branch. Kept in the SAME function rather than split
-- into a new one so that the whole test-account rule is readable in one place —
-- the discipline this schema keeps failing at is a rule living in three
-- enforcement points and being updated in two of them.
--
-- `new` is NULL on DELETE and `old` is NULL on INSERT, so every reference is
-- guarded by tg_op. That is the cost of one function over two, and it is the
-- reason to write it carefully rather than the reason not to.
create or replace function si_guard_test_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_test boolean := coalesce(case when tg_op = 'INSERT' then false else old.is_test_account end, false);
  v_is_test  boolean := coalesce(case when tg_op = 'DELETE' then false else new.is_test_account end, false);
  v_result   record  := case when tg_op = 'DELETE' then old else new end;
begin
  -- No JWT: a migration, a script, or the service role. Trusted, as everywhere.
  -- Consequence worth stating: the admin-users Edge Function runs on the service
  -- role, so this does not constrain it and it has to check for itself. It does.
  if auth.uid() is null then return v_result; end if;

  -- A system-maintained write taking the same door 0016 opened.
  if si_protected_override() then return v_result; end if;

  if si_is_superuser() then return v_result; end if;

  -- Deleting one. THE hole this migration closes. Placed above the mark check
  -- because a DELETE changes no columns and would otherwise fall through every
  -- test below and be allowed.
  if tg_op = 'DELETE' and v_was_test then
    raise exception 'This is a test account. Only the Superuser can delete it.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Marking or unmarking is itself the privilege. Without this an Administrator
  -- could hide an account from every other Administrator, which is how a
  -- backdoor account would be concealed — or unhide the fixtures and edit them.
  if tg_op <> 'DELETE' and v_is_test is distinct from v_was_test then
    raise exception 'Only the Superuser can mark an account as a test account.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Switching one on or off. The narrow rule 0028 exists for.
  --
  -- Deliberately not a blanket "no writes to a test account". A fixture exists
  -- to be used as that role, and exercising the app includes a Requester
  -- editing their own phone number — refusing that would break the thing being
  -- kept.
  if (v_was_test or v_is_test) and tg_op = 'UPDATE'
     and new.status is distinct from old.status then
    raise exception 'This is a test account. Only the Superuser can switch it on or off.'
      using errcode = 'insufficient_privilege';
  end if;

  return v_result;
end;
$$;

drop trigger if exists si_guard_test_account_trg on users;
create trigger si_guard_test_account_trg
  before insert or update or delete on users
  for each row execute function si_guard_test_account();

-- ---------------------------------------------------------------------------
-- 3. PART B — make the refusal legible
-- ---------------------------------------------------------------------------
-- The six NO ACTION foreign keys already stop this delete. They stop it with
-- `update or delete on table "users" violates foreign key constraint
-- "work_order_history_actor_id_fkey" on table "work_order_history"`, which tells
-- an administrator nothing about what to do instead. describeError() surfaces
-- server messages verbatim precisely so that a trigger can be the copy, so this
-- counts first and says what it found.
--
-- Deliberately NOT behind the auth.uid() early return the other guards use: the
-- foreign keys block the service role too, so skipping the check there would
-- only swap a good message for a bad one, never permit anything.
create or replace function si_guard_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo      int;
  v_hist    int;
  v_comment int;
  v_attach  int;
  v_parts   text[] := '{}';
begin
  select count(*) into v_wo from work_orders
   where requester_id = old.id or assigned_to_id = old.id or verified_by = old.id;
  select count(*) into v_hist    from work_order_history where actor_id       = old.id;
  select count(*) into v_comment from comments           where author_id      = old.id;
  select count(*) into v_attach  from attachments        where uploaded_by_id = old.id;

  if v_wo > 0 then
    v_parts := v_parts || format('%s work order%s', v_wo, case when v_wo = 1 then '' else 's' end);
  end if;
  if v_hist > 0 then
    v_parts := v_parts || format('%s history row%s', v_hist, case when v_hist = 1 then '' else 's' end);
  end if;
  if v_comment > 0 then
    v_parts := v_parts || format('%s comment%s', v_comment, case when v_comment = 1 then '' else 's' end);
  end if;
  if v_attach > 0 then
    v_parts := v_parts || format('%s attachment%s', v_attach, case when v_attach = 1 then '' else 's' end);
  end if;

  if array_length(v_parts, 1) is not null then
    raise exception
      '% has %. Deleting the account would break that audit trail, so it is refused. Deactivate the account instead — that keeps the history and removes the access.',
      coalesce(old.name, 'This account'),
      array_to_string(v_parts, ', ')
      using errcode = 'foreign_key_violation';
  end if;

  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. PART B — archive, then let it go
-- ---------------------------------------------------------------------------
-- The `z_` prefix is load-bearing. BEFORE triggers fire in name order, so this
-- has to sort after both guards — otherwise a refused delete would write an
-- archive row first. The transaction would roll it back anyway, but relying on
-- the rollback to undo a record of something that did not happen is not a
-- design. 0020's z_sync_user_primary_role uses the prefix for the same reason.
create or replace function si_archive_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text;
begin
  -- Null for a service-role or migration delete, which is why the admin-users
  -- function performs the users row delete with the CALLER's token rather than
  -- the service-role key: it is the only way this trail records a person.
  if v_actor is not null then
    select name into v_actor_name from users where id = v_actor;
  end if;

  insert into user_deletions (
    user_id, name, email, employee_id, roles, department_id, status,
    is_test_account, deleted_by, deleted_by_name, deleted_by_role, snapshot
  ) values (
    old.id, old.name, old.email, old.employee_id, old.roles::text[], old.department_id,
    old.status::text, coalesce(old.is_test_account, false),
    v_actor, v_actor_name, si_role(), to_jsonb(old)
  );

  return old;
end;
$$;

drop trigger if exists si_guard_user_delete_trg on users;
create trigger si_guard_user_delete_trg
  before delete on users
  for each row execute function si_guard_user_delete();

drop trigger if exists z_archive_deleted_user_trg on users;
create trigger z_archive_deleted_user_trg
  before delete on users
  for each row execute function si_archive_deleted_user();

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- Any new function in public is an anon-callable RPC by default; 0007, 0008 and
-- 0011 exist because of that. These are trigger functions, so revoking EXECUTE
-- does not affect them — the executor invokes a trigger function as part of the
-- table operation without the function-level permission check an RPC goes
-- through (0007 documents this).
revoke all on function si_guard_user_delete()    from public, anon, authenticated;
revoke all on function si_archive_deleted_user() from public, anon, authenticated;

comment on table user_deletions is
  'Snapshot of every deleted user account. Written only by z_archive_deleted_user_trg. Test-account deletions are visible to the Superuser only, for the reason 0029 documents.';
