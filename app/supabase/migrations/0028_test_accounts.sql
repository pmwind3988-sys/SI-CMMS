-- ============================================================================
-- 0028 — Test accounts: the Superuser's, and nobody else's
--
-- The seeded demo accounts are kept deliberately, as a test fixture to exercise
-- changes against. That only works if they are invisible to real staff and
-- switchable by exactly one person, or they are just six extra employees nobody
-- can account for.
--
-- Two rules, and they are separate:
--   VISIBILITY — nobody but a Superuser sees a test account at all, on or off.
--   CONTROL    — nobody but a Superuser switches one on or off, or marks one.
--
-- ---------------------------------------------------------------------------
-- WHY NOT REUSE seed_source
-- ---------------------------------------------------------------------------
-- The demo marker already exists, and it cannot carry this rule: Admin → Users
-- offers "Not a demo account", which clears seed_source, to any Administrator
-- who can edit the row. A marker that the people being restricted can remove is
-- not a restriction. It also means something different — "this row came from the
-- bootstrap script" is a fact about history, not a decision about access.
--
-- ---------------------------------------------------------------------------
-- WHY NOT REUSE is_protected
-- ---------------------------------------------------------------------------
-- is_protected already hides a row from everyone but its holder, which is half
-- of what is wanted. The other half is wrong: si_guard_protected_user refuses
-- EVERY write to such a row, so the Superuser could not toggle status either —
-- the account would be administered only from Supabase, which is the opposite of
-- the point. Hence a second flag with its own guard.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table users add column if not exists is_test_account boolean not null default false;

comment on column users.is_test_account is
  'A fixture account for exercising changes. Invisible to everyone but a Superuser, whether active or not, and only a Superuser may switch it on or off or set this flag. Distinct from is_protected, which forbids all writes, and from seed_source, which any Administrator can clear.';

/* Backfill: the accounts bootstrapUsers.js created, and only those.

   seed_source is a precise, explainable predicate — "this row came from the
   bootstrap script" — and it is the right one HERE even though it is the wrong
   one to enforce with, because this is a one-off statement whose result a human
   can read back, not a rule anybody can edit their way around afterwards.

   Deliberately not marked: the Superuser, any real Administrator, and any
   account created through the app. Those are marked by hand if wanted, which is
   the safer default — an automatic rule that hides accounts is a bad thing to
   get slightly wrong.

   No si_protected_override() needed: seed_source is null on the protected
   account, so this statement does not touch it. */
update users set is_test_account = true where seed_source is not null;

-- ---------------------------------------------------------------------------
-- 2. Visibility
-- ---------------------------------------------------------------------------
/* 0020's policy with a second exclusion beside the is_protected one, in the same
   shape and for the same reason. Reading it aloud: you must be staff who can see
   users at all, or looking at yourself; AND the row must not be hidden from you.

   `id = auth.uid()` stays first in the second clause, so a test account can
   always read its own row. It has to: AuthContext enriches the display name from
   it, and /change-password could not render otherwise.

   CONSEQUENCE, INTENDED. Every list built from users narrows for everyone else
   too — most visibly the technician assignment roster, which inner-joins users,
   so a test technician cannot be assigned work by a real Supervisor. Work orders
   are unaffected: requester_name and assigned_to_name are denormalised columns
   (0001), so an existing record still reads correctly even when the person
   behind it is hidden. */
drop policy if exists users_select on users;
create policy users_select on users
  for select to authenticated
  using (
    (si_is_manager_or_admin() or si_is_supervisor() or id = auth.uid())
    and (id = auth.uid() or si_is_superuser() or not coalesce(is_protected, false))
    and (id = auth.uid() or si_is_superuser() or not coalesce(is_test_account, false))
  );

-- ---------------------------------------------------------------------------
-- 3. Control
-- ---------------------------------------------------------------------------
/* The rank rule, plus: a test account is writable only by a Superuser.

   Self is preserved — a signed-in test account still changes its own password
   and profile, which is most of what a fixture is for. */
drop policy if exists users_update on users;
create policy users_update on users
  for update to authenticated
  using (
    id = auth.uid()
    or (
      si_is_admin()
      and si_account_rank(roles, is_protected) < si_caller_rank()
      and (si_is_superuser() or not coalesce(is_test_account, false))
    )
  )
  with check (
    id = auth.uid()
    or (
      si_is_admin()
      and si_account_rank(roles, is_protected) < si_caller_rank()
      and (si_is_superuser() or not coalesce(is_test_account, false))
    )
  );

/* THE POLICY IS NOT ENOUGH, and this is the lesson 0026 taught the hard way.

   si_set_user_roles is SECURITY DEFINER, so no policy on users ever sees its
   writes. A trigger does — triggers fire whoever wrote the row — and auth.uid()
   is still the caller's inside a SECURITY DEFINER function, because it reads a
   JWT claim rather than the current database role. So this one guard covers both
   the policy path and the RPC.

   It does NOT cover the service role, where auth.uid() is null and the guard
   returns early by the same convention every other guard here uses. That path is
   supabase/functions/admin-users, which checks the flag itself. Two enforcement
   points, deliberately, not an oversight. */
create or replace function si_guard_test_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_test boolean := coalesce(case when tg_op = 'INSERT' then false else old.is_test_account end, false);
  v_is_test  boolean := coalesce(new.is_test_account, false);
begin
  -- No JWT: a migration, a script, or the service role. Trusted, as everywhere.
  if auth.uid() is null then return new; end if;

  -- A system-maintained write taking the same door 0016 opened.
  if si_protected_override() then return new; end if;

  if si_is_superuser() then return new; end if;

  -- Marking or unmarking is itself the privilege. Without this an Administrator
  -- could hide an account from every other Administrator, which is how a
  -- backdoor account would be concealed — or unhide the fixtures and edit them.
  if v_is_test is distinct from v_was_test then
    raise exception 'Only the Superuser can mark an account as a test account.'
      using errcode = 'insufficient_privilege';
  end if;

  /* Switching one on or off. THE narrow rule this migration exists for.

     Deliberately not a blanket "no writes to a test account". A fixture exists to
     be used as that role, and exercising the app includes a Requester editing
     their own phone number — refusing that would break the thing being kept.

     Nor does the narrowness open a way for a fixture to switch itself on:
     si_guard_user_self_update already refuses a self status change to everybody,
     Superuser included. This adds the other half, that nobody ELSE below
     Superuser can switch one either.

     Unreachable through the policy path as things stand, because users_update
     above already excludes test accounts from a non-Superuser. Kept anyway, on
     the same principle as the rank check inside set_password: it is the line
     that keeps the rule true if that policy is ever widened. */
  if (v_was_test or v_is_test) and tg_op = 'UPDATE'
     and new.status is distinct from old.status then
    raise exception 'This is a test account. Only the Superuser can switch it on or off.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
revoke all on function si_guard_test_account() from public, anon, authenticated;

drop trigger if exists si_guard_test_account_trg on users;
create trigger si_guard_test_account_trg
  before insert or update on users
  for each row execute function si_guard_test_account();
