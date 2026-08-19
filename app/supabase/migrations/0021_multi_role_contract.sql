-- ============================================================================
-- SI — Service Inside · 0021 Multi-role accounts (contract)
-- ============================================================================
-- 0020 added users.roles and kept users.role alive as a derived mirror, plus
-- si_set_user_role as a wrapper over si_set_user_roles, so the build deployed at
-- the time — which selected the column and called the old RPC — kept working
-- across the migration. This removes both, so there is one source of truth
-- again.
--
-- DO NOT APPLY THIS UNTIL THE MULTI-ROLE CLIENT IS DEPLOYED.
--
-- The failure mode is a signed-in user whose profile read 400s on a column that
-- no longer exists, and an Admin -> Users role change that fails on a function
-- that no longer exists. Both are immediate and affect everyone.
--
-- What made this safe to write: si_archive_deleted_work_order (0018) declared
-- `v_actor users%rowtype` and read v_actor.role. plpgsql resolves record fields
-- at execution time, so dropping the column would have made every work order
-- DELETE start raising — with nothing in the error pointing at the column that
-- went away. 0020 rewrote it to read the set first. If you are reading this
-- because deletes broke anyway, that is the shape of the bug to look for
-- elsewhere.
-- ============================================================================

-- The mirror. Nothing derives `role` any more because nothing reads it.
drop trigger if exists z_sync_user_primary_role on users;
drop function if exists si_sync_user_primary_role();

-- The compatibility wrapper. si_set_user_roles is the only way in now.
drop function if exists si_set_user_role(uuid, si_role, text, text[]);

-- Superseded by si_account_rank(si_role[], boolean). Dropped rather than left
-- alongside: two overloads differing only in the first argument's type is an
-- invitation for a future policy to call the wrong one and silently compare a
-- single role against a set.
drop function if exists si_account_rank(text, boolean);

alter table users drop column role;
