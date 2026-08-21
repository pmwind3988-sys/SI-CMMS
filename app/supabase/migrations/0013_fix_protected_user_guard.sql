-- ============================================================================
-- SI — Service Inside · 0013 Make the protected-user guard executable
-- ============================================================================
-- si_guard_protected_user() and si_protected_override() were added directly to
-- the hosted project and have never existed in this directory — see the note at
-- the bottom about the three migrations that are still only in the database.
--
-- THE BUG
--
-- The guard is SECURITY INVOKER, so its body runs as whoever triggered the
-- write. Its first statement is:
--
--     if si_protected_override() then ...
--
-- and si_protected_override() carries {postgres=X/postgres} — EXECUTE was
-- revoked from PUBLIC, presumably by a hardening pass modelled on 0007. So for
-- any signed-in user the guard raises
--
--     permission denied for function si_protected_override
--
-- on its first line, before reaching the is_protected test it exists to
-- perform. A guard meant to protect one account instead rejected every INSERT,
-- UPDATE and DELETE on public.users for every role including admin. In the app
-- that was Admin -> Users -> Edit and the activate/deactivate toggle failing,
-- and a user unable to change their own phone number. Role changes and password
-- changes survived only because they route through si_set_user_role() and the
-- admin-users Edge Function, which run as postgres and the service role.
--
-- THE FIX
--
-- Run the guard as its owner, which is what every other guard on this schema
-- already does — si_guard_user_self_update, si_guard_notification_update,
-- si_guard_comment_update, si_guard_technician_update and
-- si_guard_work_order_transition are all SECURITY DEFINER (migration 0002).
-- This one was written without it.
--
-- Chosen over `grant execute on function si_protected_override() to
-- authenticated` because that would publish the helper at
-- /rest/v1/rpc/si_protected_override. Harmless in itself — it only reports
-- whether a GUC the caller cannot set is set — but 0007, 0008 and 0011 spent
-- three migrations closing exactly that kind of hole, and there is no reason to
-- reopen one when the alternative is a single word.
--
-- The override itself is unaffected: current_setting() reads session state, not
-- role state, so a DBA doing
--     set si.allow_protected_write = 'on';
-- in psql still bypasses the guard exactly as before.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- FIRST, THE THREE OBJECTS THIS FILE USED TO ASSUME (added 2026-08-21)
--
-- Everything above was written against a database that already had them. This
-- directory never did, so `supabase db push` into a fresh project stopped on
-- the very next statement with
--
--     ERROR: function public.si_guard_protected_user() does not exist (42883)
--
-- — measured while standing up the SI-CMMS-test project. 0001-0012 applied,
-- 0013 failed there, and nothing after it ran. The note at the bottom of this
-- file predicted exactly this and was never acted on; this is acting on it.
--
-- These are a RECONSTRUCTION from the contract 0013, 0015, 0016, 0017, 0020,
-- 0025, 0028 and 0030 describe between them — NOT a copy of production's
-- bodies, which have never been read. Reading them needs `supabase db dump`
-- (Docker), psql, or a management API token, and the machine this was written
-- on has none of the three.
--
-- So each statement is conditional on the object being ABSENT. On production,
-- where all three exist, every test below fails and nothing changes — which is
-- the point: an unconditional `create or replace` would overwrite the real
-- guard with this guess, and that is worse than the drift. On a fresh project
-- they are created, and this schema becomes buildable from this directory for
-- the first time.
--
-- To replace the guess with the real thing, run this in the production SQL
-- editor and paste the output in place of the conditionals:
--
--     select pg_get_functiondef(p.oid)
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('si_protected_override', 'si_guard_protected_user');
--
--     select tgname, pg_get_triggerdef(oid)
--       from pg_trigger
--      where tgrelid = 'public.users'::regclass and not tgisinternal;
--
-- The revokes at the end of this file cover a function created here too.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists is_protected boolean not null default false;

comment on column public.users.is_protected is
  'Marks an account administered only from Supabase. See migration 0013 — reconstructed from contract, not copied from production.';

-- ---------------------------------------------------------------------------
-- si_protected_override()
--
-- The documented door for a system write: this file says, below, that a DBA doing
--   set si.allow_protected_write = 'on';
-- bypasses the guard, and 0016, 0025, 0028 and 0030 all take that same door.
-- current_setting(..., true) — the second argument suppresses the error when
-- the GUC has never been set in this session, which is the normal case.
-- ---------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('public.si_protected_override()') is null then
    execute $fn$
      create function public.si_protected_override()
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select coalesce(current_setting('si.allow_protected_write', true), 'off') = 'on';
      $body$;
    $fn$;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- si_guard_protected_user()
--
-- 0020 describes it as raising on ANY write to a protected row, and 0030 needs
-- DELETE covered too — a DELETE changes no columns, so a guard written only for
-- INSERT/UPDATE would let a protected account be destroyed. SECURITY DEFINER
-- because 0013 exists entirely to make it so: shipped SECURITY INVOKER, its
-- first line called si_protected_override(), which is revoked from
-- authenticated, so it raised "permission denied" on every write to users for
-- every role.
-- ---------------------------------------------------------------------------
do $do$
begin
  if to_regprocedure('public.si_guard_protected_user()') is null then
    execute $fn$
      create function public.si_guard_protected_user()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      begin
        if si_protected_override() then
          return case when tg_op = 'DELETE' then old else new end;
        end if;

        if tg_op = 'DELETE' then
          if old.is_protected then
            raise exception 'This account is administered from Supabase only and cannot be deleted here.'
              using errcode = 'insufficient_privilege';
          end if;
          return old;
        end if;

        if tg_op = 'UPDATE' and old.is_protected then
          raise exception 'This account is administered from Supabase only and cannot be changed here.'
            using errcode = 'insufficient_privilege';
        end if;

        if tg_op = 'INSERT' and new.is_protected then
          raise exception 'A protected account can only be created from Supabase.'
            using errcode = 'insufficient_privilege';
        end if;

        return new;
      end
      $body$;
    $fn$;
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- The trigger.
--
-- Matched by the function it calls, not by name: if production's copy is
-- attached under some other name, this must not add a second one. Named in
-- 0002's style (guard_user_self_update), and it sorts ahead of that one and of
-- si_guard_test_account_trg — BEFORE row triggers fire in name order, and the
-- most absolute refusal running first is the right way round.
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.users'::regclass
       and not t.tgisinternal
       and t.tgfoid = 'public.si_guard_protected_user()'::regprocedure
  ) then
    execute 'create trigger guard_protected_user'
         || ' before insert or update or delete on public.users'
         || ' for each row execute function public.si_guard_protected_user()';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- AND NOW THE FIX THIS FILE WAS ORIGINALLY WRITTEN FOR.
-- ---------------------------------------------------------------------------
alter function public.si_guard_protected_user() security definer;

-- Belt and braces, matching 0007: a trigger function is never called directly,
-- and the executor does not check EXECUTE when firing one.
revoke all on function public.si_guard_protected_user() from public, anon, authenticated;
revoke all on function public.si_protected_override()   from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- NOTE ON MIGRATION DRIFT
-- `supabase migration list` reports 14 timestamped versions applied to the
-- hosted project and zero of the 0001-0014 filenames in this directory. The
-- protected-user guard, si_protected_override() and users.is_protected are part
-- of that gap: they are live, and this repository has no record of them.
--
-- CLAUDE.md states that supabase/migrations/*.sql is the source of truth for
-- schema, RLS and triggers. Until those three unrecorded migrations are pulled
-- back into this directory, that is not true, and the next person to read this
-- directory will draw conclusions about public.users that the database does not
-- share.
-- ---------------------------------------------------------------------------
