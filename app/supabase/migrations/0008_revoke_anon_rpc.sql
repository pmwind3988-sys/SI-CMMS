-- ============================================================================
-- SI — Service Inside · 0008 Remove anon from the two real RPCs
-- ============================================================================
-- si_refresh_dashboard_stats() and si_set_user_role() are meant to be callable,
-- but only by a signed-in user. Both already raise on `auth.uid() is null`, so
-- an anon call fails safely — but failing safely at the top of the function body
-- is a second line of defence, not the first one. Anon has no business reaching
-- these at all.
--
-- After this, the only remaining security lints are:
--   - authenticated may execute the two RPCs above (intended; each re-checks
--     the caller's role internally)
--   - public.counters has RLS on with no policies (intended; see 0007)
-- ============================================================================

revoke all on function si_refresh_dashboard_stats() from anon;
revoke all on function si_set_user_role(uuid, si_role, text, text[]) from anon;
