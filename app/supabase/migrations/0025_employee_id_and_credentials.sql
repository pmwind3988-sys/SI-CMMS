-- ============================================================================
-- 0025 — Employee ID, and an account that owes a password change
--
-- Applied with `supabase db push` (CLI 2.111.0), which needs no Docker: it
-- connects straight to the linked remote database. CLAUDE.md's claim that
-- db:push requires Docker is stale — `db diff` is the command that needs it,
-- because it spins up a shadow database to compare against.
--
-- Two columns and the rules that police them. NO authorization change: that is
-- migration 0026, deliberately on its own, because the hook decides access for
-- every account at once and its wrong versions deny silently rather than
-- erroring. See docs/superpowers/specs/2026-08-19-id-login-and-credentials-design.md
-- §2 and §7.
--
-- Applying this changes nothing observable. employee_id is null on every
-- existing row, must_change_password is false on every existing row, and until
-- 0026 nothing reads either one.
--
-- No `users` policy changes, and that is not an omission. users_update's
-- non-self branch is gated on si_is_admin(), so a non-admin reaches no row but
-- their own, and the deny list in si_guard_user_self_update below stops them
-- touching either new column on it. Restating a policy here would only add a
-- second place for the rule to drift from.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

-- Nullable, because it is an existing HR number typed in by an administrator:
-- every current row has none, and several accounts never will.
alter table users add column if not exists employee_id text;

alter table users add column if not exists must_change_password boolean not null default false;

/* Unique on the normalised form, partial so null does not collide with null.

   upper(btrim(...)) rather than the raw column: the number is copied off a
   badge or a payroll export, so " e1042 " and "E1042" are the same person, and
   allowing both to exist would make the lookup in auth-signin ambiguous at
   exactly the moment it must not be. */
create unique index if not exists users_employee_id_key
  on users (upper(btrim(employee_id))) where employee_id is not null;

comment on column users.employee_id is
  'The existing HR/payroll number. Nullable; unique case- and whitespace-insensitively. A second sign-in identifier, resolved to the auth email inside the auth-signin Edge Function.';
comment on column users.must_change_password is
  'This account was given its password by somebody else and owes a change. While true, custom_access_token_hook withholds its role claims (0026), so the database grants it nothing. Cleared by si_sync_auth_user_activity when the password actually changes.';

-- ---------------------------------------------------------------------------
-- 2. The self-update guard
-- ---------------------------------------------------------------------------
/* 0020's function, with the two new columns and one new door.

   THE NON-ADMIN BRANCH IS A DENY LIST, NOT AN ALLOW LIST. It names every column
   a non-admin may not move, so a column absent from it is permitted. Both new
   columns have to be named there or a Requester clears their own
   must_change_password with a PATCH on their own row and the feature is
   decorative.

   The two columns are NOT treated alike, and the difference is the point:

   - must_change_password is in the SELF branch as well, so nobody clears their
     own — Administrator and Superuser included. Same placement, same reason, as
     0015's self-role-change lock: a rule whose purpose is to stop you acting on
     yourself is worthless if the most privileged account is exempt.
   - employee_id is in the non-admin branch ONLY. An administrator may set their
     own. It is a directory attribute, not a privilege, and its one real abuse —
     claiming somebody else's number — is what the unique index already refuses.

   THE NEW DOOR. si_sync_auth_user_activity clears must_change_password on YOUR
   OWN row when YOU change YOUR OWN password, which is exactly what the self
   branch now forbids. si_protected_override() is the existing mechanism for a
   system-maintained write of these audit columns: migration 0016 opened it on
   si_guard_protected_user for the same trigger and the same reason. It reads a
   transaction-local GUC no client can set — set_config lives in pg_catalog, so
   PostgREST does not publish it — and the trigger switches it off again
   immediately after the write.

   Belt and braces, deliberately. auth.uid() is very probably already null
   inside that trigger, because GoTrue's own connection sets no JWT claims and
   this guard's first line returns early on a null uid. "Very probably" is not a
   basis for a rule that silently disables a security feature when it is wrong. */
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

-- ---------------------------------------------------------------------------
-- 3. Clearing the flag when the password actually changes
-- ---------------------------------------------------------------------------
/* 0016's function, with must_change_password folded into the write it already
   makes. Same override window, same immediate reset — see 0016's header for why
   the reset has to be explicit.

   THE ORDERING THIS CREATES IS LOAD-BEARING ELSEWHERE. Issuing a temporary
   password is itself a password change, so this trigger fires and clears the
   flag. Whatever sets the flag must therefore set it AFTER writing the password
   — see supabase/functions/admin-users, action set_password. Reversed, the
   account gets a temporary password and no obligation to change it, and nothing
   anywhere reports a problem.

   create_user is the exception, and it is safe for a structural reason rather
   than an ordering one: this is an UPDATE trigger on auth.users, and creating an
   account INSERTs there. Nothing fires, so nothing clears the flag. */
create or replace function si_sync_auth_user_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    perform set_config('si.allow_protected_write', 'on', true);
    update public.users
       set password_changed_at  = now(),
           must_change_password = false
     where id = new.id;
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
