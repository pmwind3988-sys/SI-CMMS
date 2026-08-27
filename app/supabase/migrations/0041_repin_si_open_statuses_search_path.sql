-- ===========================================================================
-- 0041 — Put si_open_statuses()'s search_path back
--
-- A regression introduced by 0039, caught by the Supabase advisor on
-- production and by nothing else. Advisor run after 0039/0040: nine warnings
-- against a seven-warning baseline. One of the two new ones is
-- `Function Search Path Mutable · public.si_open_statuses`.
--
-- 0039 section 1.5 trimmed the two removed statuses out of that function with a
-- plain `create or replace ... language sql immutable`, copying 0004's original
-- header. But 0004's header never carried the setting: **0007 line 74 pins it
-- with `alter function si_open_statuses() set search_path = public`**, and a
-- later `create or replace` resets options an earlier `alter` set. So the
-- rewrite silently unpinned it.
--
-- This is the exact trap CLAUDE.md documents twice — once under "traps if you
-- ever audit this statically" and once in 0034's header — and 0039 itself cites
-- it when re-issuing the revoke on si_notify_work_order_update. Getting it
-- right for one function in a migration and wrong for another in the same file
-- is what makes it worth a migration of its own rather than a quiet edit.
--
-- The setting is written into the function HEADER this time rather than added
-- by a trailing `alter`. Same effect, but the next person to rewrite this
-- function sees it in the definition they are editing instead of having to know
-- that a file three migrations earlier pinned it out of sight. `pg_get_functiondef`
-- shows it either way; a migration diff does not.
--
-- Nothing else in 0039 or 0040 is affected. The advisor's other eight warnings
-- are accounted for: five are the deliberate `authenticated` grants on
-- SECURITY DEFINER functions that policy expressions need (see 0007's header
-- before "fixing" any of them); `si_decline_work_order` is a sixth of that same
-- kind, deliberate since 0037 because the client calls it, and it appears now
-- only because no advisor run was recorded between 0037 and this one; `si_rank`
-- is the function that exists in the database and in no migration, described in
-- CLAUDE.md and left alone deliberately; and leaked-password protection is auth
-- configuration, not schema.
--
-- Neither function 0039 and 0040 actually added -- si_stamp_attachment and the
-- replaced si_eligible_roles -- is flagged, which is the evidence their revokes
-- landed.
-- ===========================================================================

create or replace function si_open_statuses()
returns si_wo_status[]
language sql
immutable
set search_path = public
as $$
  select array['open','assigned','accepted',
               'repairing','waiting_spare_part','testing']::si_wo_status[];
$$;
