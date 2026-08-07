-- ============================================================================
-- SI — Service Inside · 0007 Harden function grants
-- ============================================================================
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and
-- PostgREST exposes anything executable in the `public` schema at
-- /rest/v1/rpc/{name}. That combination meant the helper and trigger functions
-- from 0002-0004 were reachable as HTTP endpoints. Two of them mattered:
--
--   si_notify(...)                -> SECURITY DEFINER insert into notifications,
--                                    a table no client role may write. Callable
--                                    by anon. Anyone could forge a notification
--                                    to any recipient with any content.
--   si_department_supervisors(),
--   si_managers()                 -> SECURITY DEFINER reads that bypass the
--                                    users SELECT policy, leaking the staff
--                                    roster and their uuids to anon.
--
-- The trigger functions were exposed too. That is less exploitable (calling one
-- outside a trigger context errors on the missing OLD/NEW records) but there is
-- no reason to publish them.
--
-- Revoking EXECUTE does not affect triggers: the executor invokes a trigger
-- function directly as part of the table operation and does not perform the
-- function-level permission check that an RPC call goes through.
--
-- Deliberately still granted to `authenticated`:
--   si_refresh_dashboard_stats(), si_set_user_role(...)  -- the two real RPCs,
--     both of which re-check the caller's role internally.
--   si_role(), si_department_id(), si_is_*(), si_in_same_department(),
--   si_signed_in()  -- required, because RLS policy expressions are evaluated
--     with the querying user's privileges. Exposing them is harmless: each one
--     only reports back a claim from the caller's own JWT.
-- ============================================================================

-- Trigger functions — never called directly by anyone.
revoke all on function si_before_work_order_insert()     from public, anon, authenticated;
revoke all on function si_after_work_order_insert()      from public, anon, authenticated;
revoke all on function si_notify_work_order_update()     from public, anon, authenticated;
revoke all on function si_guard_work_order_transition()  from public, anon, authenticated;
revoke all on function si_stamp_work_order()             from public, anon, authenticated;
revoke all on function si_guard_user_self_update()       from public, anon, authenticated;
revoke all on function si_guard_notification_update()    from public, anon, authenticated;
revoke all on function si_guard_comment_update()         from public, anon, authenticated;
revoke all on function si_guard_technician_update()      from public, anon, authenticated;
revoke all on function si_touch_updated_at()             from public, anon, authenticated;

-- SECURITY DEFINER internals. si_notify is the one that actually mattered.
revoke all on function si_notify(uuid, si_role, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function si_department_supervisors(text)   from public, anon, authenticated;
revoke all on function si_managers()                     from public, anon, authenticated;

-- Belt and braces on the three already revoked in 0004.
revoke all on function si_sla_breach_sweep()             from public, anon, authenticated;
revoke all on function si_sla_warning_sweep()            from public, anon, authenticated;
revoke all on function si_compute_dashboard_stats()      from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pin search_path on the remaining helpers. Without it, the resolution of an
-- unqualified name inside the function body depends on the caller's search_path
-- — the standard privilege-escalation vector for SECURITY DEFINER code, and
-- untidy even for the invoker-rights ones.
-- ---------------------------------------------------------------------------

alter function si_signed_in()               set search_path = public;
alter function si_is_requester()            set search_path = public;
alter function si_is_technician()           set search_path = public;
alter function si_is_supervisor()            set search_path = public;
alter function si_is_manager()              set search_path = public;
alter function si_is_admin()                set search_path = public;
alter function si_is_manager_or_admin()     set search_path = public;
alter function si_in_same_department(text)  set search_path = public;
alter function si_touch_updated_at()        set search_path = public;
alter function si_open_statuses()           set search_path = public;
alter function si_terminal_statuses()       set search_path = public;

-- ---------------------------------------------------------------------------
-- NOTE ON `counters`
-- The linter reports public.counters as "RLS enabled, no policies". That is the
-- intended state, not an oversight: firestore.rules had
--   match /counters/{counterId} { allow read, write: if false; }
-- because wo_number sequence integrity depends on the table being reachable
-- only from si_before_work_order_insert(). RLS with zero policies is exactly
-- how Postgres expresses "no client access at any role". Leave it.
-- ---------------------------------------------------------------------------
