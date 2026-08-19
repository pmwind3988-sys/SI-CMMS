-- SI — Service Inside · Migration 0029
--
-- Closes the one residue 0028 left behind.
--
-- 0028 sealed the `users` row of a test account: an ordinary Administrator holding
-- the exact uuid gets [] from a select and [] from a PATCH. But it touched only
-- `users`, and `technicians_select` is `using (si_signed_in())` — so
-- `technicians?select=name` still handed every fixture's name and user_id to any
-- signed-in account. Measured, not theorised: as admin@example.com the users table
-- returned two rows while the technicians table returned all three fixtures.
--
-- No screen changes. listenTechnicians() joins users with !inner, so RLS hiding the
-- user already dropped the technician row and the assign panel was already empty for
-- non-Superusers. This stops the raw table answering a question the UI refuses to.
--
-- Deliberately NOT extended to work_orders.requester_name / assigned_to_name,
-- work_order_history.actor_name or comments.author_name. Those record something that
-- happened, and an audit trail that hides who acted is not an audit trail.

-- ---------------------------------------------------------------------------
-- The helper has to exist, and it has to be SECURITY DEFINER.
--
-- The obvious version of this policy inlines the test:
--
--   not exists (select 1 from users u where u.id = technicians.user_id
--                 and coalesce(u.is_test_account, false))
--
-- and it does NOTHING. A policy expression is evaluated with the querying user's
-- privileges, so that subquery is itself filtered by users_select — which already
-- hides test accounts from this exact caller. The subquery finds no row, `not
-- exists` is therefore true, and the technician row stays visible to precisely the
-- people it was meant to be hidden from. It fails open, silently, and reads as
-- correct.
--
-- SECURITY DEFINER makes the lookup run as the owner, so it sees the row RLS was
-- hiding and can answer the question honestly.
-- ---------------------------------------------------------------------------
create or replace function si_is_test_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(u.is_test_account, false)
    from users u
   where u.id = p_user_id;
$$;

comment on function si_is_test_account(uuid) is
  'Is this account a test fixture? SECURITY DEFINER because it is called from a '
  'policy on technicians, where an inline read of users would be filtered by '
  'users_select and fail open.';

-- Any new function in public is an anon-callable RPC by default (Postgres grants
-- EXECUTE to PUBLIC, PostgREST publishes it) — migrations 0007, 0008 and 0011 exist
-- because of this. Revoke, then grant back only what the policy needs.
--
-- What this exposes to an authenticated caller is one boolean about one uuid they
-- must already possess. That is strictly less than the name and uuid the policy
-- below stops leaking, which is the trade being made.
revoke all on function si_is_test_account(uuid) from public, anon;
grant execute on function si_is_test_account(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The policy. Same three-branch shape as users_select: your own row, the
-- Superuser, or anything not marked.
-- ---------------------------------------------------------------------------
drop policy if exists technicians_select on technicians;

create policy technicians_select on technicians
  for select to authenticated
  using (
    si_signed_in()
    and (
      user_id = auth.uid()
      or si_is_superuser()
      or not si_is_test_account(user_id)
    )
  );
