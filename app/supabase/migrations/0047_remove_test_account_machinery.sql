-- SI — Service Inside · migration 0047
--
-- The test-account machinery comes out.
--
-- 0046 removed the five fixtures from production. This removes the two columns
-- that existed to hide them and to keep their work out of the statistics, along
-- with every policy, trigger and predicate built on the pair:
--
--   users.is_test_account   — 0028, 0029, 0030
--   work_orders.is_test_data — 0033, 0034
--
-- and the separate seeded-demo-data heuristic from 0012, which measured the same
-- thing by a different route and has nothing left to measure.
--
-- ORDER IS LOAD-BEARING, AND IT IS WHY THIS IS A SECOND FILE. Dropping the flag
-- while the fixture rows are still present un-hides them: they return to Admin →
-- Users, to every count, and to the technician roster on the assign panel — the
-- exact outcome 0028 was written to prevent, arrived at by removing 0028. The
-- accounts have to be gone first. Two migrations rather than one so that a
-- half-applied push cannot land in that state.
--
-- ---------------------------------------------------------------------------
-- WHAT IS NOT REMOVED, AND WHY
-- ---------------------------------------------------------------------------
-- si_is_placeholder_email(text) STAYS. It is not part of the demo heuristic even
-- though 0012 introduced them together: admin-users calls it to refuse a
-- recovery link to an address that can never receive mail, loudly, which is a
-- live feature and the one thing standing between an administrator and believing
-- they have helped somebody they have not.
--
-- user_deletions.is_test_account STAYS. That table is an archive, and 0046 has
-- just written five rows into it with the flag set to true. Dropping the column
-- would erase the record of what was removed at the moment the removal is being
-- recorded. Same reasoning 0036 used to keep priority_touched as an export
-- column that can now only read "No": a record's shape should not churn.
--
-- password_changed_at and last_login_at STAY. 0012 added them alongside the seed
-- columns and they are ordinary account facts, read by the profile screen.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. Policies, back to the shape they had before 0028
-- ===========================================================================
-- Each of these is its predecessor with one clause removed and nothing else
-- touched. The is_protected clauses stay exactly as they were — that is a
-- different rule, about accounts administered only from Supabase, and it is
-- unaffected.

-- 0028's users_select, less the is_test_account branch.
drop policy if exists users_select on users;
create policy users_select on users
  for select to authenticated
  using (
    (si_is_manager_or_admin() or si_is_supervisor() or id = auth.uid())
    and (id = auth.uid() or si_is_superuser() or not coalesce(is_protected, false))
  );

-- 0028's users_update, less the same branch. The rank rule from 0015 is
-- untouched: Administrators still cannot edit each other, and only a Superuser
-- still makes an Administrator.
drop policy if exists users_update on users;
create policy users_update on users
  for update to authenticated
  using (
    id = auth.uid()
    or (
      si_is_admin()
      and si_account_rank(roles, is_protected) < si_caller_rank()
    )
  )
  with check (
    id = auth.uid()
    or (
      si_is_admin()
      and si_account_rank(roles, is_protected) < si_caller_rank()
    )
  );

-- 0030's users_delete, less the clause 0030 added to catch up with 0028.
-- si_guard_user_delete is untouched and remains the real protection here: the
-- audit trail, not the mark, is what makes an account undeletable.
drop policy if exists users_delete on users;
create policy users_delete on users
  for delete to authenticated
  using (
    si_is_admin()
    and si_account_rank(roles, is_protected) < si_caller_rank()
  );

-- 0030's archive policy. The column stays (see the header); what goes is the
-- clause that hid a fixture's deletion from ordinary Administrators, since there
-- is no longer a category of account whose removal is anybody's secret.
drop policy if exists user_deletions_select on user_deletions;
create policy user_deletions_select on user_deletions
  for select to authenticated
  using (si_is_admin());

-- 0029's technicians_select, back to 0024's. The three-branch shape existed only
-- to keep a fixture out of the assign panel; with no fixtures there is nothing
-- for it to exclude, and si_is_test_account is dropped in section 5.
drop policy if exists technicians_select on technicians;
create policy technicians_select on technicians
  for select to authenticated
  using (si_signed_in());


-- ===========================================================================
-- 2. The guard that made the mark the Superuser's alone
-- ===========================================================================
-- Trigger before function, or the drop is refused for the dependency.
drop trigger if exists si_guard_test_account_trg on users;
drop function if exists si_guard_test_account();


-- ===========================================================================
-- 3. The dashboard functions, without the predicates
-- ===========================================================================
-- These are 0034's definitions with `not is_test_data` and
-- `not si_is_test_account(...)` removed and nothing else altered. They have to
-- be replaced BEFORE the column is dropped in section 6 — a plpgsql body is not
-- parsed until it is called, so Postgres would let the column go and leave both
-- functions to fail at the next pg_cron sweep instead. That is the trap 0036's
-- header describes from the other direction: a successful push is not evidence
-- that a plpgsql function works.
--
-- The two timing averages recorded as a known gap in CLAUDE.md — a fixture's
-- four-minute close landing in avg_response_minutes — resolves itself here.
-- There are no fixtures, so there is nothing to weigh whether to exclude.

create or replace function si_compute_dashboard_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open     si_wo_status[] := si_open_statuses();
  v_terminal si_wo_status[] := si_terminal_statuses();
  v_cards    jsonb;
  v_charts   jsonb;
  v_response numeric;
begin
  -- Average minutes from raise to technician acceptance, taken from the audit
  -- trail rather than from the work order itself.
  select avg(extract(epoch from (h.created_at - w.created_at)) / 60)
    into v_response
    from work_order_history h
    join work_orders w on w.id = h.work_order_id
   where h.to_status = 'accepted'
     and h.created_at >= w.created_at;

  select jsonb_build_object(
    'total_open',           count(*) filter (where status = any (v_open)),
    'p1_critical',          count(*) filter (where status = any (v_open) and priority = 'P1'),
    'p2_high',              count(*) filter (where status = any (v_open) and priority = 'P2'),
    'p3_medium',            count(*) filter (where status = any (v_open) and priority = 'P3'),
    'p4_low',               count(*) filter (where status = any (v_open) and priority = 'P4'),
    'completed_today',      count(*) filter (where closed_at >= date_trunc('day', now())),
    'overdue',              count(*) filter (where status = any (v_open) and sla_breached),
    'avg_response_minutes', coalesce(round(v_response), 0),
    'avg_repair_minutes',   coalesce(round(avg(
                              extract(epoch from (closed_at - created_at)) / 60
                            ) filter (where status = any (v_terminal) and closed_at is not null)), 0),
    -- "Active technicians" is a headcount OF TECHNICIANS: distinct people, not
    -- work orders.
    'active_technicians',   count(distinct assigned_to_id) filter (
                              where status = any (v_open)
                                and assigned_to_id is not null)
  )
  into v_cards
  from work_orders;

  select jsonb_build_object(
    'monthly_work_orders', coalesce((
      select jsonb_agg(jsonb_build_object('month', label, 'count', n) order by bucket)
        from (
          select date_trunc('month', created_at) as bucket,
                 to_char(date_trunc('month', created_at), 'Mon YY') as label,
                 count(*) as n
            from work_orders
           where created_at >= date_trunc('month', now()) - interval '11 months'
           group by 1, 2
        ) m
    ), '[]'::jsonb),

    'department_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('department', name, 'count', n) order by n desc)
        from (
          select coalesce(d.name, w.department_id) as name, count(*) as n
            from work_orders w
            left join departments d on d.id = w.department_id
           group by 1
        ) x
    ), '[]'::jsonb),

    'machine_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('asset', name, 'count', n) order by n desc)
        from (
          select coalesce(w.asset_name, w.asset_id) as name, count(*) as n
            from work_orders w
           group by 1
           order by count(*) desc
           limit 10
        ) x
    ), '[]'::jsonb),

    -- Named-technician league table. Grouped on assigned_to_name, the
    -- denormalised copy (0001), so it still reads correctly for a technician
    -- whose account has since been deleted.
    'technician_performance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'technician', name,
               'completed', completed,
               'avg_repair_minutes', avg_minutes
             ) order by completed desc)
        from (
          select coalesce(w.assigned_to_name, w.assigned_to_id::text) as name,
                 count(*) filter (where w.status = any (v_terminal)) as completed,
                 coalesce(round(avg(
                   extract(epoch from (w.closed_at - w.created_at)) / 60
                 ) filter (where w.status = any (v_terminal) and w.closed_at is not null)), 0) as avg_minutes
            from work_orders w
           where w.assigned_to_id is not null
           group by 1
           order by count(*) filter (where w.status = any (v_terminal)) desc
           limit 10
        ) x
    ), '[]'::jsonb)
  )
  into v_charts;

  insert into stats (id, data, updated_at)
  values ('dashboard_cards', v_cards, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();

  insert into stats (id, data, updated_at)
  values ('dashboard_charts', v_charts, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke execute on function si_compute_dashboard_stats() from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- The drill-down, kept in step.
-- ---------------------------------------------------------------------------
-- Only the active_technicians branch differs from 0033: it is the one whose rows
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

  -- One row per technician rather than one per work order. `left join users u`
  -- returns null for a row the caller may not see, so the coalesce falls through
  -- to max(w.assigned_to_name), the denormalised copy.
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

revoke all on function si_dashboard_card_rows(text, int) from public, anon;
grant execute on function si_dashboard_card_rows(text, int) to authenticated, service_role;


-- ===========================================================================
-- 4. The stamp triggers
-- ===========================================================================
-- 0033 created both and 0034 replaced both in place. Nothing computes
-- is_test_data once the column is gone, so both come out with it.
--
-- c_stamp_work_order_test_data was named for its alphabetical position, ahead of
-- 0003's b_stamp_work_order. Removing it changes no ordering that matters — it
-- read the requester and wrote one boolean, and touched nothing else.
drop trigger if exists c_stamp_work_order_test_data on work_orders;
drop function if exists si_stamp_work_order_test_data();

-- Re-stamped every work order raised by an account whose mark had just been
-- switched. With no mark to switch, there is no event left to react to.
drop trigger if exists users_restamp_test_data on users;
drop function if exists si_restamp_test_data_for_user();


-- ===========================================================================
-- 5. The lookup
-- ===========================================================================
-- 0029's helper. SECURITY DEFINER because a policy expression evaluates with the
-- caller's privileges, so an inline read of users would have been filtered by
-- users_select and failed open — the trap that migration documents. Its three
-- callers are gone: technicians_select in section 1, and both dashboard
-- functions in section 3.
drop function if exists si_is_test_account(uuid);


-- ===========================================================================
-- 6. The archive function, then the columns
-- ===========================================================================
-- si_archive_deleted_user reads old.is_test_account, so it has to stop doing
-- that before the column goes. The user_deletions column itself stays and is now
-- historical: true for the five rows 0046 wrote, false for everything after.
-- to_jsonb(old) is unaffected — it snapshots whatever columns exist at the time,
-- which is the whole reason it is there.
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
    old.status::text, false,
    v_actor, v_actor_name, si_role(), to_jsonb(old)
  );

  return old;
end;
$$;
revoke all on function si_archive_deleted_user() from public, anon, authenticated;

comment on column user_deletions.is_test_account is
  'Historical only. True for the fixture accounts removed by migration 0046; '
  'false for every deletion after it, since users.is_test_account was dropped by 0047.';

alter table work_orders drop column if exists is_test_data;
alter table users       drop column if exists is_test_account;


-- ===========================================================================
-- 7. The seeded-demo-data heuristic (0012)
-- ===========================================================================
-- A separate mechanism that measured the same thing by a different route: not
-- "this is a fixture" but "this account still smells like one" — a placeholder
-- address, still on the password the seed script set, a profile never edited, or
-- never signed into. It drove a "Demo accounts" card on the Manager and Admin
-- dashboard, a banner and filter in Admin → Users, and a chip on each account.
--
-- 0028 explains why it was never the right thing to ENFORCE with: any
-- Administrator could clear seed_source and with it the flags. That same
-- looseness is why it can be removed without ceremony — nothing was ever gated
-- on it.
--
-- It has nothing left to report. Four of its flags key on seed_source, which
-- only the accounts 0046 deleted ever carried. The fifth, placeholder_email,
-- keeps working where it actually matters: si_is_placeholder_email survives and
-- admin-users still refuses to send a recovery link to an address that cannot
-- receive one.
drop function if exists si_dummy_flags(public.users);

-- si_guard_user_self_update lists the columns an ordinary account may not change
-- on its own row. The four seed columns are in that list and are about to not
-- exist. This is 0025's body with those four lines removed; every other rule —
-- roles, status, must_change_password, and the three self-checks above the admin
-- branch — is unchanged.
--
-- Same ordering rule as section 3: a plpgsql body is not parsed until it runs,
-- so dropping the columns without this would leave every profile edit by a
-- non-admin raising "record new has no field seed_source" at runtime, with a
-- clean push behind it.
create or replace function si_guard_user_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No JWT means this is not a client request: the auth-activity trigger (0012)
  -- writing last_login_at, or a service-role script.
  if auth.uid() is null then return new; end if;

  -- A deliberate system-maintained write, taking the same door 0016 uses.
  if si_protected_override() then return new; end if;

  if new.id = auth.uid() then
    if new.roles is distinct from old.roles then
      raise exception 'You cannot change your own roles. Ask someone above you, or change it in Supabase.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status is distinct from old.status then
      raise exception 'You cannot change your own account status.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.must_change_password is distinct from old.must_change_password then
      raise exception 'You cannot clear your own password-change requirement. Change your password instead.'
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
     or new.employee_id is distinct from old.employee_id
     or new.must_change_password is distinct from old.must_change_password
     or new.password_changed_at is distinct from old.password_changed_at
     or new.last_login_at is distinct from old.last_login_at then
    raise exception 'You may only change your own name, phone, and photo.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function si_guard_user_self_update() from public, anon, authenticated;

alter table users
  drop column if exists seed_source,
  drop column if exists seed_name,
  drop column if exists seed_phone,
  drop column if exists seeded_at;
