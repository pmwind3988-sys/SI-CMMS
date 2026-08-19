-- ============================================================================
-- 0027 — Signing in by employee number: the lookup, and the attempt delay
--
-- Applied with `supabase db push`, which needs no Docker (see 0025's header).
--
-- ---------------------------------------------------------------------------
-- 1. THE LOOKUP
-- ---------------------------------------------------------------------------
-- One definition of "the same employee number", shared by the unique index in
-- 0025 and by the auth-signin Edge Function.
--
-- Doing this inside the function with PostgREST's .ilike() would NOT be the same
-- thing, and the difference is exactly the kind that goes unnoticed: ilike
-- ignores case but not the whitespace the index normalises away, and it treats
-- % and _ in user input as wildcards. Two disagreeing notions of sameness, at
-- the one moment sign-in has to be unambiguous — including a caller who types
-- "%" and matches somebody.
--
-- SECURITY DEFINER, and granted to service_role ONLY. Every function in `public`
-- is an anon-callable RPC by default — Postgres grants EXECUTE to PUBLIC and
-- PostgREST publishes it — and this one maps an employee number to an email
-- address. Published, it is a staff directory and a credential-stuffing target
-- list, walkable in a loop. Migrations 0007, 0008 and 0011 exist because of that
-- default; this is not the migration to rediscover it.
--
-- IT DOES NOT FILTER ON status, deliberately. Filtering here would make an
-- inactive account fail at resolution while a wrong password fails at GoTrue,
-- and the two would become distinguishable — handing back exactly the oracle the
-- generic error message exists to deny. An inactive account authenticates
-- normally and is then denied by carrying no role claims (0026), which is the
-- only place that decision belongs.
-- ---------------------------------------------------------------------------

create or replace function si_email_by_employee_id(p_employee_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
    from public.users u
   where u.employee_id is not null
     and upper(btrim(u.employee_id)) = upper(btrim(p_employee_id))
   limit 1;
$$;

comment on function si_email_by_employee_id(text) is
  'Resolve an employee number to its sign-in address, normalised exactly as users_employee_id_key is. service_role only: published to anon it would be a staff directory. Deliberately does not filter on status.';

revoke all     on function si_email_by_employee_id(text) from public, anon, authenticated;
grant  execute on function si_email_by_employee_id(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. THE ATTEMPT DELAY
-- ---------------------------------------------------------------------------
-- GoTrue throttles by origin. Every employee-ID sign-in reaches it from the
-- auth-signin function's egress address, so its per-IP counter sees one client
-- for the whole plant: it will either throttle everybody at once or protect
-- nobody. Adding the function without this makes brute-force protection WORSE
-- than not having the function at all — a regression disguised as a feature.
--
-- An Edge Function is stateless, so the counter lives here.
--
-- WHY A SELF-EXPIRING DELAY AND NOT A LOCKOUT. The key is an identifier anyone
-- can read off a badge, so a lockout an administrator has to lift would be a
-- denial-of-service wearing a security control's clothes: fail three times
-- against a number you do not own and its holder is locked out. This expires on
-- its own and nobody has to clear it.
-- ---------------------------------------------------------------------------

create table if not exists login_attempts (
  identifier   text        primary key,          -- lower(btrim(...)), as typed
  failed_count int         not null default 0,
  first_failed timestamptz not null default now(),
  locked_until  timestamptz
);

comment on table login_attempts is
  'Failed sign-in counter for the auth-signin Edge Function. Written only with the service-role key; no policies, so unreachable from PostgREST. Rows are transient and swept daily.';

-- Written only with the service-role key, which bypasses RLS entirely. RLS is
-- enabled anyway and there are no policies: a table in `public` with RLS on and
-- no policies is unreachable from PostgREST even if a grant is added by mistake.
alter table login_attempts enable row level security;
revoke all on table login_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE SWEEP
-- ---------------------------------------------------------------------------
-- Nothing older than a day tells us anything, and this table would otherwise
-- grow one row per typo forever — the same unbounded-growth problem
-- DATA_AND_STORAGE.md flags for notifications.
--
-- A function rather than inline SQL in the cron entry, matching the three sweeps
-- 0004 schedules, and revoked from every client role for the same reason: it is
-- cron-driven only.
-- ---------------------------------------------------------------------------

create or replace function si_sweep_login_attempts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.login_attempts
   where first_failed < now() - interval '1 day'
     and (locked_until is null or locked_until < now());
$$;

revoke execute on function si_sweep_login_attempts() from authenticated, anon, public;

-- Idempotent: cron.schedule raises on a duplicate job name, and this migration
-- may be re-run against a project where it already exists.
select cron.unschedule('si-sweep-login-attempts')
 where exists (select 1 from cron.job where jobname = 'si-sweep-login-attempts');

select cron.schedule('si-sweep-login-attempts', '17 3 * * *', $$select si_sweep_login_attempts()$$);
