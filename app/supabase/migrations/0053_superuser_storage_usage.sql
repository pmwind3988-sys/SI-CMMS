-- 0053 — How full is this project? (Superuser only)
--
-- DATA_AND_STORAGE.md §3 lists the SQL for this and says to run it in the
-- Supabase SQL Editor. That is the right place for the destructive half (§3's
-- "Clear"), and the wrong place for the question that comes first: is anything
-- close to full? Answering that needed a dashboard login, so in practice nobody
-- asked until an upload failed. This puts the reading — and only the reading —
-- in front of the one account that would act on it.
--
-- ONE FUNCTION, READ-ONLY. No cleanup, no delete, nothing scheduled. Free has
-- no backups at all (§1), so every destructive operation in §3 stays where it
-- is, behind a dashboard login, deliberately.
--
-- Why SECURITY DEFINER, and why that is not a widening:
--
--   * `storage.objects` is RLS-enabled and `authenticated` reaches only what the
--     bucket policies grant, so a per-caller sum would report whatever that one
--     user can see rather than the bucket's size.
--   * `pg_database_size()` and `pg_total_relation_size()` need privileges on the
--     objects being measured, which `authenticated` does not hold.
--
-- So the grant is the shape 0043 used for si_replace_attachment: definer rights,
-- `search_path` pinned, revoked from public and anon, granted to
-- `authenticated`, and the caller re-checked IN THE BODY. It will therefore show
-- up in the advisor under "Signed-In Users Can Execute SECURITY DEFINER
-- Function", alongside si_replace_attachment, si_set_user_roles and
-- si_refresh_dashboard_stats. That row is expected and must not be "fixed":
-- revoking `authenticated` stops the browser calling it at all.
--
-- si_is_superuser() rather than si_is_admin(). An ordinary Administrator can do
-- nothing about a full quota — upgrading the plan and taking a backup are both
-- dashboard operations — and the largest-objects list names files and uploaders
-- across the whole plant, which is a wider read than any screen currently
-- offers. It follows the pattern 0031 set for retirement: the account that has
-- the dashboard is the account that gets the number.
--
-- The quota LIMITS are not in here on purpose. 500 MB and 1 GB are properties of
-- the billing plan, not of the database, and nothing in Postgres knows which
-- plan a project is on. They live in src/lib/constants.js as PLATFORM_QUOTAS,
-- mirroring DATA_AND_STORAGE.md §1 — and, like suggestPriority() against
-- si_derive_priority(), MUST BE CHANGED IN BOTH PLACES if this project moves to
-- Pro. Putting a guessed limit in the function would have made the gauge read
-- 6% full on a plan whose real ceiling is sixteen times larger.
--
-- Egress is absent, and cannot be added. It exists only in Supabase's billing
-- API, which needs a personal access token — and this app is a static export, so
-- any token it held would be shipped to every browser. §2 is clear that egress
-- is the quota this app spends fastest, so the panel says so in words and links
-- to Settings → Usage rather than leaving a Superuser to infer that two green
-- gauges mean everything is fine.

create or replace function si_storage_usage()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  v_database_bytes bigint;
  v_storage_bytes  bigint;
  v_objects        bigint;
  v_tables         jsonb;
  v_largest        jsonb;
  v_cron           jsonb;
begin
  -- The boundary. Definer rights mean the grant cannot be it.
  if not si_is_superuser() then
    raise exception 'Only the Superuser can see the project''s storage usage.'
      using errcode = 'insufficient_privilege';
  end if;

  select pg_database_size(current_database()) into v_database_bytes;

  -- coalesce twice: sum() over zero rows is NULL, and an object whose metadata
  -- has no size (a failed or in-flight upload) contributes nothing rather than
  -- turning the whole total NULL.
  select coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0),
         count(*)
    into v_storage_bytes, v_objects
    from storage.objects
   where bucket_id = 'attachments';

  -- Biggest tables in public, data and indexes together, since that is what the
  -- 500 MB ceiling is measured against.
  select coalesce(jsonb_agg(t order by t.total_bytes desc), '[]'::jsonb)
    into v_tables
    from (
      select c.relname                                             as name,
             pg_total_relation_size(c.oid)                          as total_bytes,
             pg_relation_size(c.oid)                                as heap_bytes,
             coalesce(s.n_live_tup, 0)                              as live_rows
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_stat_user_tables s on s.relid = c.oid
       where n.nspname = 'public'
         and c.relkind = 'r'
       order by pg_total_relation_size(c.oid) desc
       limit 6
    ) t;

  -- pg_cron's own log sits outside public and is therefore invisible above,
  -- while accruing ~670 rows a day from the three sweeps in 0004 whether or not
  -- anything happened. §2 says to check it before blaming an application table,
  -- so it is reported separately instead of being left out.
  --
  -- to_regclass, not a cast: a project without pg_cron has no such table, and
  -- 'cron.job_run_details'::regclass would raise rather than return null.
  if to_regclass('cron.job_run_details') is not null then
    select jsonb_build_object(
             'name',        'cron.job_run_details',
             'total_bytes', pg_total_relation_size(to_regclass('cron.job_run_details')),
             'rows',        (select count(*) from cron.job_run_details)
           )
      into v_cron;
  end if;

  -- The 5 largest objects. A surprise gigabyte is usually four files.
  select coalesce(jsonb_agg(o order by o.bytes desc), '[]'::jsonb)
    into v_largest
    from (
      select name,
             coalesce((metadata->>'size')::bigint, 0) as bytes,
             created_at
        from storage.objects
       where bucket_id = 'attachments'
       order by coalesce((metadata->>'size')::bigint, 0) desc
       limit 5
    ) o;

  return jsonb_build_object(
    'database_bytes', v_database_bytes,
    'storage_bytes',  v_storage_bytes,
    'storage_objects', v_objects,
    'tables',         v_tables,
    'cron_log',       v_cron,
    'largest_objects', v_largest,
    'measured_at',    now()
  );
end;
$fn$;

revoke all on function si_storage_usage() from public, anon;
grant execute on function si_storage_usage() to authenticated;

comment on function si_storage_usage() is
  'Point-in-time size of the database and the attachments bucket, with the '
  'biggest contributors to each. Superuser only, re-checked in the body because '
  'SECURITY DEFINER means the grant cannot be the boundary. Read-only. The quota '
  'limits it is compared against are not here — they are a property of the '
  'billing plan and live in src/lib/constants.js (PLATFORM_QUOTAS). Egress is '
  'not obtainable from SQL at all; see migration 0053''s header.';
