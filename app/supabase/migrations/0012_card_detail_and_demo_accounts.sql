-- ============================================================================
-- SI — Service Inside · 0012 Dashboard card detail + demo-account flagging
-- ============================================================================
-- Two unrelated-looking additions that share one idea: a number on a dashboard
-- should be able to show you the rows it came from.
--
-- 1. si_dashboard_card_rows(card) — the records behind each Manager/Admin stat
--    card. The card values themselves stay where they were, in the precomputed
--    `stats` row refreshed by pg_cron (0004); this is the on-demand drill-down
--    for one card at a time, so the "never scan work_orders from the client for
--    aggregates" rule is untouched.
--
--    The predicates here are copied line for line from si_compute_dashboard_stats
--    so the list can never disagree with the count it was opened from. If you
--    change one, change both — they are two readings of the same definition.
--
--    SECURITY INVOKER on purpose: RLS decides what comes back, exactly as it
--    does for every other read in the app.
--
-- 2. Demo-account flagging. The six accounts bootstrapUsers.js creates all share
--    one password and an @example.com address, and nothing in the app ever said
--    so. si_dummy_flags(users) is a PostgREST computed column returning one code
--    per unresolved reason, so each reason clears on its own as it is fixed:
--    change the password and 'default_password' goes; edit the profile and
--    'unchanged_profile' goes; sign in and 'never_signed_in' goes. An account
--    with no reasons left returns '{}' and stops being flagged.
--
--    Detecting "the password was never changed" needs a fact Postgres was not
--    recording: si_auth_user_activity on auth.users now stamps
--    users.password_changed_at, and finally populates users.last_login_at —
--    a column that has existed since 0001 and that nothing has ever written.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CARD DETAIL
-- ---------------------------------------------------------------------------

-- One row shape for every card, so a single component can render all of them.
-- metric_kind tells the client how to read metric_value:
--   'sla_remaining' — minutes until the resolution deadline, negative if passed
--   'duration'      — minutes elapsed, the figure that card averages
--   'count'         — a plain tally
--   'none'          — no metric; metric_value is null
create or replace function si_dashboard_card_rows(p_card text, p_limit int default 200)
returns table (
  ref_id       text,
  kind         text,
  title        text,
  subtitle     text,
  meta         text,
  priority     text,
  status       text,
  metric_kind  text,
  metric_value numeric,
  occurred_at  timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_open     si_wo_status[] := si_open_statuses();
  v_terminal si_wo_status[] := si_terminal_statuses();
  v_limit    int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_priority si_priority;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- total_open / p1..p4 / overdue are one query: the open set, optionally
  -- narrowed by priority or to the breached ones. Matches the
  -- count(*) filter (where status = any (v_open) and ...) expressions in
  -- si_compute_dashboard_stats.
  if p_card in ('total_open', 'p1_critical', 'p2_high', 'p3_medium', 'p4_low', 'overdue') then
    v_priority := (case p_card
                     when 'p1_critical' then 'P1'
                     when 'p2_high'     then 'P2'
                     when 'p3_medium'   then 'P3'
                     when 'p4_low'      then 'P4'
                   end)::si_priority;

    return query
      select w.id::text,
             'work_order'::text,
             coalesce(w.wo_number, 'Pending…')::text,
             coalesce(w.asset_name, w.asset_id)::text,
             (coalesce(d.name, w.department_id) || ' · ' ||
              coalesce(w.assigned_to_name, 'Unassigned'))::text,
             w.priority::text,
             w.status::text,
             'sla_remaining'::text,
             round(extract(epoch from (w.sla_resolution_due_at - now())) / 60)::numeric,
             w.created_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.status = any (v_open)
         and (v_priority is null or w.priority = v_priority)
         and (p_card <> 'overdue' or w.sla_breached)
       order by w.sla_resolution_due_at asc nulls last
       limit v_limit;

  -- completed_today counts closed_at >= midnight, not status = 'completed'.
  -- Keeping the same predicate here is the whole point of this function.
  elsif p_card = 'completed_today' then
    return query
      select w.id::text,
             'work_order'::text,
             coalesce(w.wo_number, 'Pending…')::text,
             coalesce(w.asset_name, w.asset_id)::text,
             (coalesce(d.name, w.department_id) || ' · ' ||
              coalesce(w.assigned_to_name, 'Unassigned'))::text,
             w.priority::text,
             w.status::text,
             'duration'::text,
             round(extract(epoch from (w.closed_at - w.created_at)) / 60)::numeric,
             w.closed_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.closed_at >= date_trunc('day', now())
       order by w.closed_at desc
       limit v_limit;

  -- The response-time average is taken from the audit trail, so its detail is
  -- history rows: one per acceptance, which means a reassigned-then-reaccepted
  -- work order legitimately contributes twice, here and in the average.
  elsif p_card = 'avg_response_minutes' then
    return query
      select w.id::text,
             'work_order'::text,
             coalesce(w.wo_number, 'Pending…')::text,
             coalesce(w.asset_name, w.asset_id)::text,
             ('Accepted by ' || coalesce(h.actor_name, 'a technician'))::text,
             w.priority::text,
             w.status::text,
             'duration'::text,
             round(extract(epoch from (h.created_at - w.created_at)) / 60)::numeric,
             h.created_at
        from work_order_history h
        join work_orders w on w.id = h.work_order_id
       where h.to_status = 'accepted'
         and h.created_at >= w.created_at
       order by h.created_at desc
       limit v_limit;

  elsif p_card = 'avg_repair_minutes' then
    return query
      select w.id::text,
             'work_order'::text,
             coalesce(w.wo_number, 'Pending…')::text,
             coalesce(w.asset_name, w.asset_id)::text,
             (coalesce(d.name, w.department_id) || ' · ' ||
              coalesce(w.assigned_to_name, 'Unassigned'))::text,
             w.priority::text,
             w.status::text,
             'duration'::text,
             round(extract(epoch from (w.closed_at - w.created_at)) / 60)::numeric,
             w.closed_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.status = any (v_terminal)
         and w.closed_at is not null
       order by w.closed_at desc
       limit v_limit;

  -- count(distinct assigned_to_id) over the open set — so the detail is one row
  -- per technician, carrying the open load that made them count as active.
  elsif p_card = 'active_technicians' then
    return query
      select w.assigned_to_id::text,
             'technician'::text,
             coalesce(u.name, max(w.assigned_to_name), 'Unknown technician')::text,
             coalesce(nullif(array_to_string(t.skills, ', '), ''), 'No skills recorded')::text,
             coalesce(u.department_id, '—')::text,
             null::text,
             null::text,
             'count'::text,
             count(*)::numeric,
             max(w.created_at)
        from work_orders w
        left join users u       on u.id = w.assigned_to_id
        left join technicians t on t.user_id = w.assigned_to_id
       where w.status = any (v_open)
         and w.assigned_to_id is not null
       group by w.assigned_to_id, u.name, t.skills, u.department_id
       order by count(*) desc
       limit v_limit;

  else
    raise exception 'Unknown dashboard card: %', p_card
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke all on function si_dashboard_card_rows(text, int) from public;
revoke all on function si_dashboard_card_rows(text, int) from anon;
grant execute on function si_dashboard_card_rows(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. DEMO ACCOUNTS
-- ---------------------------------------------------------------------------

alter table users
  add column if not exists seed_source         text,
  add column if not exists seed_name           text,
  add column if not exists seed_phone          text,
  add column if not exists seeded_at           timestamptz,
  add column if not exists password_changed_at timestamptz;

comment on column users.seed_source is
  'Non-null when this account was created by a seeding script rather than by a '
  'person. Clearing it is how an Administrator says "this is a real account now".';
comment on column users.password_changed_at is
  'Maintained by si_auth_user_activity on auth.users. Null on a seeded account '
  'means it is still on the password the seed script set.';

-- Domains that only ever appear in demo data. Deliberately a function and not a
-- reference table: this is a hygiene rule, not something an Administrator tunes
-- per plant, and the RFC 2606 names at the top of the list can never be real.
create or replace function si_is_placeholder_email(p_email text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(split_part(coalesce(p_email, ''), '@', 2)) = any (array[
    'example.com', 'example.org', 'example.net', 'example.edu',
    'test.com', 'test.local', 'localhost', 'local', 'invalid',
    'demo.com', 'sample.com', 'mailinator.com', 'yopmail.com'
  ]);
$$;

-- A PostgREST computed column: select it with
--   .select("id, name, …, si_dummy_flags")
-- Every reason is independently clearable, which is what "stop flagging it once
-- it has been dealt with" actually requires. An empty array means the account
-- carries no demo-data smell at all.
create or replace function si_dummy_flags(u public.users)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(f order by f), '{}'::text[])
    from (
      -- The sign-in identity itself is fake. Only fixable by replacing the
      -- account, so this one persists — correctly — after a password change.
      select 'placeholder_email' as f where si_is_placeholder_email(u.email)
      union all
      -- Still on the password the seed script set.
      select 'default_password'  where u.seed_source is not null
                                   and u.password_changed_at is null
      union all
      -- Name and phone are still character-for-character what was seeded.
      select 'unchanged_profile' where u.seed_source is not null
                                   and u.seed_name is not null
                                   and u.name = u.seed_name
                                   and coalesce(u.phone, '') = coalesce(u.seed_phone, '')
      union all
      -- Provisioned but never actually used by anybody.
      select 'never_signed_in'   where u.seed_source is not null
                                   and u.last_login_at is null
    ) s;
$$;

revoke all on function si_is_placeholder_email(text) from public, anon;
grant execute on function si_is_placeholder_email(text) to authenticated, service_role;

revoke all on function si_dummy_flags(public.users) from public, anon;
grant execute on function si_dummy_flags(public.users) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Facts Postgres was not recording.
--
-- GoTrue owns auth.users and writes it directly, so these two columns can only
-- be kept in step by a trigger on that table. SECURITY DEFINER because the
-- caller here is supabase_auth_admin, which has no rights on public.users.
-- ---------------------------------------------------------------------------
create or replace function si_sync_auth_user_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.users set password_changed_at = now() where id = new.id;
  end if;

  if new.last_sign_in_at is distinct from old.last_sign_in_at
     and new.last_sign_in_at is not null then
    update public.users set last_login_at = new.last_sign_in_at where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists si_auth_user_activity on auth.users;
create trigger si_auth_user_activity
  after update on auth.users
  for each row execute function si_sync_auth_user_activity();

-- The self-update guard from 0002 would reject the write above: it runs BEFORE
-- UPDATE on public.users and, with no JWT in the session, si_is_admin() is
-- false. Without this exemption every sign-in would fail on the last_login_at
-- stamp. auth.uid() being null is a safe signal that the write did not come
-- from a client — users_update is `to authenticated` and matches no row when
-- auth.uid() is null, so a browser can never reach this trigger without one.
--
-- The tracking columns are added to the rejected set for the same reason the
-- role and status columns are there: a flagged user must not be able to clear
-- their own flag. An Administrator still can, and that is the escape hatch for
-- an account this migration mis-marked.
create or replace function si_guard_user_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or si_is_admin() then return new; end if;

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
revoke all on function si_sync_auth_user_activity() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Mark whatever bootstrapUsers.js already created. Matching on the seed email
-- list is the only evidence available after the fact; from now on the script
-- writes these columns itself.
update public.users u
   set seed_source = 'bootstrap',
       seed_name   = coalesce(u.seed_name, u.name),
       seed_phone  = coalesce(u.seed_phone, u.phone),
       seeded_at   = coalesce(u.seeded_at, u.created_at)
 where u.seed_source is null
   and lower(u.email) in (
     'requester@example.com',
     'tech.arun@example.com',
     'tech.meera@example.com',
     'supervisor@example.com',
     'manager@example.com',
     'admin@example.com'
   );

-- last_login_at has never been written, so recover what auth.users already
-- knows rather than showing every existing account as never signed in.
update public.users u
   set last_login_at = a.last_sign_in_at
  from auth.users a
 where a.id = u.id
   and u.last_login_at is null
   and a.last_sign_in_at is not null;

-- password_changed_at cannot be recovered: GoTrue keeps no history of it. A
-- seeded account whose password was already rotated before this migration will
-- carry 'default_password' until it is rotated again, or until an Administrator
-- clears seed_source. Both are one action in the Users screen.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- users was left out of the publication in 0005, so listenUsers() has really
-- been a one-shot fetch. Adding it makes the demo-account flags clear from the
-- Users screen and the Admin dashboard the moment they are dealt with, instead
-- of on the next page load. Realtime applies the same SELECT policy, so a
-- Requester is still only woken for their own row.
do $$
begin
  execute 'alter publication supabase_realtime add table users';
exception when duplicate_object then null;
end $$;
