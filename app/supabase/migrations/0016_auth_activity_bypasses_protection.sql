-- ============================================================================
-- SI — Service Inside · 0016 Let the auth-activity trigger write protected rows
-- ============================================================================
-- Fixes a defect introduced by 0012 and only reachable once 0013 made
-- si_guard_protected_user actually run.
--
-- THE BUG
--
-- si_sync_auth_user_activity (0012) is an AFTER UPDATE trigger on auth.users
-- that mirrors two facts into public.users: password_changed_at when the
-- password changes, and last_login_at when someone signs in.
--
-- si_guard_protected_user is a BEFORE UPDATE trigger on public.users that
-- raises on *any* write to a row with is_protected — it does not care who is
-- writing or which columns are moving.
--
-- So the mirror write hits the guard, the guard raises, and because both run
-- inside the auth.users transaction, the whole thing rolls back:
--
--   ERROR: This account is protected. It can only be changed from the database.
--   CONTEXT: SQL statement "update public.users set password_changed_at = ..."
--
-- Setting a protected account's password fails. Worse, so does signing in as
-- one — the last_login_at branch raises identically, so the account was
-- unusable rather than merely uneditable. It went unnoticed because the only
-- protected account had never signed in.
--
-- THE FIX
--
-- si_protected_override() exists precisely for this: it reads the
-- si.allow_protected_write GUC, and the guard returns early when it is on. This
-- is a deliberate, system-maintained write of two audit columns, so it takes
-- that door.
--
-- Scoped as tightly as the mechanism allows. set_config(..., true) is
-- transaction-local, and it is switched back off immediately after each write
-- rather than left on for the remainder of the transaction — otherwise a single
-- sign-in would leave protection disabled for anything else GoTrue did in the
-- same transaction. Note the `SET search_path` clause on this function does not
-- restore other GUCs on exit; only the ones it names. The reset has to be
-- explicit.
--
-- The guard itself is untouched. Widening it — "skip when auth.uid() is null",
-- say — would also hand the service-role key and every script in app/scripts a
-- free pass to write protected rows, which is the opposite of the point.
-- ============================================================================

create or replace function si_sync_auth_user_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    perform set_config('si.allow_protected_write', 'on', true);
    update public.users set password_changed_at = now() where id = new.id;
    perform set_config('si.allow_protected_write', 'off', true);
  end if;

  if new.last_sign_in_at is distinct from old.last_sign_in_at
     and new.last_sign_in_at is not null then
    perform set_config('si.allow_protected_write', 'on', true);
    update public.users set last_login_at = new.last_sign_in_at where id = new.id;
    perform set_config('si.allow_protected_write', 'off', true);
  end if;

  return new;
end;
$$;

revoke all on function si_sync_auth_user_activity() from public, anon, authenticated;
