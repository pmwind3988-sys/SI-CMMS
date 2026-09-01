-- SI — Service Inside · migration 0046
--
-- The five fixture accounts leave production.
--
-- 0028 kept them deliberately: an account to sign into while a change is being
-- tried. That argument expired when SI-CMMS-test was stood up — there is now a
-- whole project to try changes against, and a fixture on production is just an
-- employee nobody can account for. 0047 removes the machinery that hid them;
-- this removes the accounts themselves, and it has to come first. Drop the flag
-- while the rows are still there and they stop being hidden — they reappear in
-- Admin → Users and in the technician roster, which is precisely the thing 0028
-- was written to prevent.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE TO DO IN A MIGRATION
-- ---------------------------------------------------------------------------
-- si_guard_user_delete (0030) refuses to delete an account that has raised a
-- work order, written a history row, commented or uploaded an attachment, and
-- it has NO null-uid early return — so it refuses a migration exactly as it
-- refuses an Administrator. That is deliberate: the audit trail is the boundary.
--
-- Measured on production before writing this, all five fixtures returned 0 for
-- work orders raised, work orders worked or verified, history rows, comments and
-- attachments:
--
--   Arun Kumar      tech.arun@example.com
--   Meera Iyer      tech.meera@example.com
--   Priya Nair      supervisor@example.com
--   Ravi Kumar      requester@example.com
--   Vikram Shah     manager@example.com
--
-- So the guard does not fire and nothing is being destroyed but the accounts.
-- There is no demo work order on production either — `raised` was 0 for every
-- one of them — so unlike the case 0033 describes, nothing has to be cleared out
-- of work_orders first. If that ever stops being true this migration will fail
-- loudly on the guard rather than quietly damaging a record, which is the right
-- way round.
--
-- ---------------------------------------------------------------------------
-- WHY THE PREDICATE IS is_test_account AND NOT A LIST OF EMAILS
-- ---------------------------------------------------------------------------
-- The mark IS the definition, and it is the Superuser's alone to set (0028), so
-- it cannot have been applied to a real account by anybody else.
--
-- It also makes this migration correct on BOTH projects, which a hardcoded email
-- list would not be. The fixtures on SI-CMMS-test are NOT marked — 0028's
-- backfill reads seed_source in a one-time UPDATE that, on a project built from
-- scratch, runs before bootstrap:users has created anybody. So this deletes five
-- rows on production and zero on test, and the test project keeps the accounts
-- you actually sign into. That asymmetry is the point, not an accident.
--
-- Deliberately no count assertion for the same reason: "exactly five" is true of
-- production and false everywhere else.
--
-- ---------------------------------------------------------------------------
-- WHAT GOES WITH THEM
-- ---------------------------------------------------------------------------
-- Cascades, from the foreign keys in 0001: `technicians` (user_id, cascade) and
-- `notifications` (recipient_id, cascade). Set to null: departments.manager_id,
-- role_permissions.updated_by. The six NO ACTION keys that would have blocked
-- this — work_orders x3, work_order_history, comments, attachments — reference
-- nothing, as measured above.
--
-- z_archive_deleted_user_trg still fires and files a user_deletions row for each,
-- including the is_test_account snapshot. `deleted_by` will be NULL: it is
-- stamped from auth.uid(), and a migration has no JWT. That is honest — no
-- administrator did this, a deployment did — and it is why the names are written
-- into this file, which is the durable record.
-- ---------------------------------------------------------------------------

do $$
declare
  v_ids   uuid[];
  v_names text[];
begin
  select coalesce(array_agg(id), '{}'::uuid[]),
         coalesce(array_agg(name order by name), '{}'::text[])
    into v_ids, v_names
    from users
   where coalesce(is_test_account, false);

  if array_length(v_ids, 1) is null then
    raise notice '0046: no test accounts on this project — nothing to remove.';
    return;
  end if;

  raise notice '0046: removing % test account(s): %',
    array_length(v_ids, 1), array_to_string(v_names, ', ');

  -- public.users first, so si_guard_user_delete gets its say and
  -- z_archive_deleted_user can snapshot the row into user_deletions.
  --
  -- NOT the other way round. public.users.id references auth.users(id) on delete
  -- cascade, so deleting the auth row first would also work and would even be
  -- atomic — but the cascade arrives without a JWT and, per 0030, that skips the
  -- guard's judgement and files an archive row recording nobody. Same reason
  -- admin-users deletes the public row as the caller.
  delete from users where id = any(v_ids);

  -- Then the auth row, which only a superuser connection can reach. Left behind,
  -- these accounts could still authenticate — they would land in an app with no
  -- roles, because custom_access_token_hook has no users row to read, but a
  -- credential that still works is not a deleted account.
  delete from auth.users where id = any(v_ids);

  raise notice '0046: done.';
end;
$$;
