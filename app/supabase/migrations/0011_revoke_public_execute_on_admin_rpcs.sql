-- SI — Service Inside · migration 0011
--
-- Completes what migration 0008 set out to do and got wrong.
--
-- 0008 ran `revoke all on function … from anon`. That is not enough: Postgres
-- grants EXECUTE to PUBLIC by default, and PUBLIC *includes* anon, so revoking
-- the role-specific grant leaves the blanket one in place. It showed up as a
-- leading `=X/postgres` entry in the function's ACL, and Supabase's linter kept
-- reporting both functions as anon-callable — correctly.
--
-- Not exploitable in practice: both function bodies check auth.uid() and raise
-- 'Sign in required.' with errcode insufficient_privilege before doing anything,
-- which was verified by calling them over HTTP with the publishable key and no
-- session (both returned 401 and no role changed). Fixed anyway — relying only on
-- the body means one future function written without that guard silently becomes
-- an anonymous RPC, which is exactly how si_notify went wrong before 0007.
--
-- The correct order is always: revoke from public FIRST, then grant to the roles
-- that should have it. Compare si_transition_work_order in migration 0010, which
-- does it right.

revoke all on function si_refresh_dashboard_stats() from public;
revoke all on function si_refresh_dashboard_stats() from anon;
grant execute on function si_refresh_dashboard_stats() to authenticated;

revoke all on function si_set_user_role(uuid, si_role, text, text[]) from public;
revoke all on function si_set_user_role(uuid, si_role, text, text[]) from anon;
grant execute on function si_set_user_role(uuid, si_role, text, text[]) to authenticated;
