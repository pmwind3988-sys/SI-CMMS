-- ===========================================================================
-- 0042 — Web Push: an alert that arrives when the app is not running
-- ===========================================================================
-- lib/osNotifications.js can only present a notification while the app's
-- Realtime websocket is alive. Once the browser is closed there is no process
-- to present anything, so the alert has to be pushed TO the device by a sender
-- holding credentials. That sender is supabase/functions/push-notify; this file
-- is everything the database needs in order to call it and to know whether the
-- call worked.
--
-- Design doc: docs/superpowers/specs/2026-08-27-web-push-design.md
--
-- THE PART THAT IS NOT OBVIOUS FROM THIS FILE: si_guard_notification_update()
-- from 0002 refuses every change to a notification except `status`, and checks
-- it with a whole-row jsonb comparison. The sender runs on the service role,
-- where auth.uid() is null and si_is_admin() is therefore FALSE, so that guard
-- applies to it. Left alone it refuses the pushed_at stamp, nothing is ever
-- marked delivered, and the retry sweep below re-sends every notification
-- forever. The amendment appears early in this file, before the pushed_at
-- backfill that would otherwise trip the un-amended guard.
-- ===========================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- One row per browser per person. A phone and a laptop are two rows.
-- ---------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  -- The push service URL. It identifies the BROWSER, not the account, which is
  -- why si_register_push_subscription below has to be able to move it between
  -- accounts on a shared plant terminal.
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  failed_at    timestamptz,
  last_error   text
);

create index if not exists push_subscriptions_user_idx
  on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- Read and delete your own, and nothing else. There is deliberately no INSERT
-- or UPDATE policy: both go through the SECURITY DEFINER RPC below.
--
-- Deliberately not readable by an Administrator either. A row here is a list of
-- which devices a person uses and when they last used one; nothing in
-- Admin -> Users needs it, and exposing it would be a new disclosure justified
-- by nothing.
drop policy if exists push_subscriptions_select on push_subscriptions;
create policy push_subscriptions_select on push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on push_subscriptions;
create policy push_subscriptions_delete on push_subscriptions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The guard amendment — read the header of this file
-- ---------------------------------------------------------------------------
-- Without this, si_guard_notification_update() refuses the sender's pushed_at
-- stamp, nothing is ever marked delivered, and si_push_retry_sweep() re-sends
-- every notification once a minute forever. The failure does not look like a
-- permission error to anyone; it looks like the same alert arriving over and
-- over, and its cause is a trigger written thirty-seven migrations ago.
--
-- The early return is the same service-role door si_protected_override() opens
-- and si_guard_test_account() returns through, and carries the same accepted
-- risk: it is safe only because a null uid means a service-role connection,
-- authenticated as trusted somewhere else.
--
-- This has to run BEFORE the pushed_at backfill below, not after: the backfill
-- is itself an UPDATE on notifications and fires the OLD guard if the guard
-- isn't replaced first. Measured: pushing this migration with the amendment
-- left at the end of the file fails the backfill statement with "A
-- notification may only be marked read." (SQLSTATE 42501) — the old guard
-- still in force refusing its own replacement's prerequisite.
create or replace function si_guard_notification_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- service role: the sender
  if si_is_admin() then return new; end if;

  if new.status <> 'read' then
    raise exception 'A notification may only be marked read.'
      using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then
    raise exception 'Only the status of a notification may be changed.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Was this notification actually delivered?
-- ---------------------------------------------------------------------------
-- The whole safety net. Unstamped and older than two minutes is the retry set;
-- a growing count of unstamped rows is the only alarm that push has broken.
-- Without it this would be fire-and-forget, which is the same shape as every
-- control on this schema that decided nothing and failed silently.
alter table notifications add column if not exists pushed_at timestamptz;

-- Every notification that already exists predates push and must not be sent.
-- On first run this stamps the entire backlog, which is exactly right: nobody
-- registered a device before this migration existed. Without it the first
-- minute of si_push_retry_sweep attempts the whole history at once.
update notifications set pushed_at = now() where pushed_at is null;

create index if not exists notifications_unpushed_idx
  on notifications (created_at) where pushed_at is null;

-- Distinct from pushed_at on purpose (review finding 4): pushed_at means "the
-- database handed this to the sender and it was actually delivered" and must
-- keep meaning that. The 24-hour give-up below writes here instead, so a
-- total outage still shows as a growing pushed_at-is-null count for as long
-- as it lasts, rather than the count quietly returning to zero once the
-- oldest rows time out. A row can carry both: gave-up-and-later-delivered is
-- not a contradiction, it just stops mattering to the retry set.
alter table notifications add column if not exists push_gave_up_at timestamptz;

-- The claim lease. Set by the sender to fence a concurrent invocation of the
-- SAME notification (the trigger and the sweep can both reach one row, and a
-- slow invocation can still be mid-loop when the sweep re-fires a minute
-- later): the sender claims a row by setting this to now() before it starts
-- sending, and releases it (sets it back to null) once it knows the outcome.
--
-- It EXPIRES rather than being a plain lock, and that is the whole point of
-- it existing as a separate column from pushed_at. A killed invocation --
-- Deno isolate recycled mid-loop, a deploy landing mid-request, an uncaught
-- throw between the claim and the release -- cannot be relied on to run its
-- own cleanup. No amount of try/finally in the function fixes that: a
-- platform-level kill does not unwind a finally block. So the lease has to
-- recover on its own by going stale, which si_push_retry_sweep's predicate
-- below now checks: a claim older than 5 minutes is treated as abandoned and
-- the row re-enters the retry set exactly as if it had never been claimed.
-- Before this column existed, that same kill left pushed_at null and the
-- sweep still delivered the alert a minute later -- worse in latency, never
-- in correctness. A lease with no expiry would have been worse than that: a
-- single kill would permanently mark the row delivered, invisible to the
-- sweep and invisible to the unstamped-count alarm, with the notification
-- simply never arriving and nothing reporting it.
alter table notifications add column if not exists push_claimed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Registering a device
-- ---------------------------------------------------------------------------
-- An RPC rather than a client upsert, because of the shared workshop terminal.
-- When a second person signs in on the same browser the endpoint is
-- byte-identical, and the row must move to them. A client-side insert-or-update
-- cannot do it: RLS correctly refuses to touch a row owned by somebody else, so
-- the write fails and the previous holder keeps receiving alerts on a machine
-- they walked away from. Same hazard lib/draftRecovery.js designs around by
-- putting the uid in every draft key.
create or replace function si_register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in before registering for alerts.'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = ''
     or coalesce(p_auth, '') = '' then
    raise exception 'A push subscription needs an endpoint and both keys.';
  end if;

  delete from push_subscriptions where endpoint = p_endpoint;

  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent);
end;
$$;

create or replace function si_unregister_push_subscription(p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  delete from push_subscriptions
   where endpoint = p_endpoint and user_id = auth.uid();
end;
$$;

revoke all on function si_register_push_subscription(text, text, text, text)
  from public, anon;
revoke all on function si_unregister_push_subscription(text) from public, anon;
grant execute on function si_register_push_subscription(text, text, text, text)
  to authenticated;
grant execute on function si_unregister_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Handing a notification to the sender
-- ---------------------------------------------------------------------------
-- net.http_post QUEUES the request and returns. That is a requirement, not a
-- convenience: a slow or dead Edge Function must never block or fail the
-- transaction that raised the work order. A push outage cannot be allowed to
-- stop somebody reporting a fault.
create or replace function si_enqueue_push(p_notification_id uuid)
returns void
language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  v_secret text;
  v_url    text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'push_trigger_secret';
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'push_function_url';

  -- Not configured yet is not an error. This runs inside the transaction that
  -- writes a notification, and a project without the secrets set must still be
  -- able to raise work orders.
  if v_secret is null or v_url is null then return; end if;

  -- review finding 1: this call runs inside the AFTER INSERT trigger on
  -- notifications, which runs inside whatever transaction just moved a work
  -- order — accept, decline, raise, assign. Before this handler existed, any
  -- failure here (the net schema not resolving, pg_net mid-upgrade, a bad
  -- value saved into push_function_url) would propagate out of the trigger,
  -- abort the notification INSERT, and take the work-order transition down
  -- with it. That contradicts this function's own comment above: a push
  -- outage must never stop somebody reporting a fault. Only the
  -- "not configured" branch above actually honoured that promise; this
  -- handler is what makes every other failure mode honour it too. A warning
  -- is visible in the Postgres logs without being visible to the user whose
  -- transaction must still succeed.
  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('notification_id', p_notification_id),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-push-secret', v_secret),
      timeout_milliseconds := 8000
    );
  exception when others then
    raise warning 'si_enqueue_push: net.http_post failed for notification %: %',
      p_notification_id, sqlerrm;
    return;
  end;
end;
$$;

create or replace function si_after_notification_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform si_enqueue_push(new.id);
  return null;  -- AFTER trigger; the return value is discarded
end;
$$;

drop trigger if exists z_push_notification on notifications;
create trigger z_push_notification
  after insert on notifications for each row
  execute function si_after_notification_insert();

-- ---------------------------------------------------------------------------
-- The safety net
-- ---------------------------------------------------------------------------
-- The trigger gives latency; this gives the guarantee. Anything the trigger
-- failed to deliver — function mid-deploy, push service down, secret rotated —
-- is retried here instead of being lost.
create or replace function si_push_retry_sweep()
returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  -- Given up on after 24 hours. A push about a work order that moved on
  -- yesterday is noise, and an unbounded retry set is a queue that only grows.
  --
  -- review finding 4: this sets push_gave_up_at, not pushed_at. pushed_at
  -- means "actually delivered"; if the give-up wrote it instead, a full day
  -- of total outage would end with every unstamped row silently marked
  -- pushed_at and the "growing count of unstamped rows" alarm this file's own
  -- header calls "the only alarm that push has broken" would read clean right
  -- when it matters most. The retry-set predicate below excludes gave-up rows
  -- so the sweep stops retrying them, but pushed_at stays null on them
  -- forever, so the alarm keeps ringing.
  update notifications
     set push_gave_up_at = now()
   where pushed_at is null
     and push_gave_up_at is null
     and created_at < now() - interval '24 hours';

  -- review finding 3: a recipient with no registered device can never be
  -- stamped by the sender (there is nothing to push to), so without this
  -- exclusion every such notification sits in the retry set for the full
  -- 24 hours and gets re-enqueued once a minute — up to 1,440 Edge Function
  -- invocations per notification, most of them for recipients who have never
  -- opted in to push at all. Skipping recipients with zero push_subscriptions
  -- rows leaves the row's pushed_at null (it genuinely was not delivered, so
  -- the alarm is still honest) without spending a function call on it every
  -- minute. If they later register a device, the next sweep picks the row up
  -- normally — nothing here marks it as sent.
  --
  -- The two-minute floor keeps this from racing the trigger's own in-flight
  -- request and sending everything twice.
  for r in
    select n.id from notifications n
     where n.pushed_at is null
       and n.push_gave_up_at is null
       and n.created_at < now() - interval '2 minutes'
       -- A stale claim (older than 5 minutes) is treated as abandoned --
       -- see push_claimed_at's own comment above for why an expiring lease
       -- is the only shape that survives a killed invocation.
       and (n.push_claimed_at is null or n.push_claimed_at < now() - interval '5 minutes')
       and exists (
         select 1 from push_subscriptions ps where ps.user_id = n.recipient_id
       )
     order by n.created_at
     limit 200
  loop
    perform si_enqueue_push(r.id);
  end loop;
end;
$$;

revoke all on function si_enqueue_push(uuid) from public, anon, authenticated;
revoke all on function si_after_notification_insert() from public, anon, authenticated;
revoke all on function si_push_retry_sweep() from public, anon, authenticated;

-- Idempotent the same way 0027's sweep is: cron.schedule raises on a duplicate
-- job name, and this migration must be re-runnable against a project that has
-- already had it.
select cron.unschedule('si-push-retry') where exists (
  select 1 from cron.job where jobname = 'si-push-retry'
);
select cron.schedule('si-push-retry', '* * * * *', $$select si_push_retry_sweep()$$);
