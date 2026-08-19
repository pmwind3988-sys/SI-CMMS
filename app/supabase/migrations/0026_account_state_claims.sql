-- ============================================================================
-- 0026 — Account state decides what a token carries
--
-- ONE FUNCTION. Nothing else belongs in this file.
--
-- This is the only change in this sub-project that can lock every account out
-- of the app at once, and its failure mode is silence rather than an error:
-- every policy in the schema denies an account whose si_roles() is empty, so a
-- wrong hook signs everybody in to a blank app with nothing raised anywhere.
-- That has already happened once on this schema — 0002's hook omitted
-- is_protected and 0015 was written believing it was there.
--
-- WHAT CHANGES: an account that is not active, or that owes a password change,
-- gets a token with no role claims. Everything else follows without touching a
-- single policy, because "no roles" is already denied everywhere.
--
-- Measured before this migration, on a freshly minted token (refresh grant, so
-- the hook really did run) for an account with users.status = 'inactive':
--
--     user_roles: ["requester"]   user_role: "requester"
--
-- users.status granted exactly nothing. "Deactivate" in Admin → Users wrote a
-- column no policy, trigger or client predicate read.
--
-- WHAT DOES NOT CHANGE: an account that is active and unflagged gets exactly
-- the claims 0020 gave it. si_is_superuser() is untouched, and needs to be:
-- with no roles si_has_role('admin') is false, so an inactive Superuser is not
-- one either.
--
-- ---------------------------------------------------------------------------
-- THE TRAP
-- ---------------------------------------------------------------------------
-- Emitting `user_roles: []` IS NOT ENOUGH, and the version that does it looks
-- right. si_roles() (0020) is:
--
--     coalesce(
--       (select array_agg(...) from jsonb_array_elements(... 'user_roles') ...),
--       case when auth.jwt() ->> 'user_role' ... end
--     )
--
-- array_agg over zero rows returns NULL, not '{}'. An empty user_roles array
-- therefore falls straight through the coalesce into the user_role branch and
-- the single highest role comes back. The account is denied nothing, and
-- nothing errors.
--
-- Both claims are REMOVED from the object rather than emptied. AuthContext.js
-- mirrors the same fallback chain on the client and needs the same treatment,
-- including dropping its profile.roles leg — users_select lets an account read
-- its own row, so the client would otherwise refill exactly what this function
-- withholds.
--
-- ---------------------------------------------------------------------------
-- BEFORE YOU APPLY THIS
-- ---------------------------------------------------------------------------
--     select id, name, email, status from public.users where status <> 'active';
--
-- Every row that returns loses access at its next token refresh. On the day
-- this was written that was one row — the demo Requester — and it was
-- reactivated first, deliberately, rather than discovered afterwards.
-- ============================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  u      record;
  v_high text;
begin
  select roles, department_id, plant_ids, is_protected, status, must_change_password
    into u
    from public.users
   where id = (event ->> 'user_id')::uuid;

  if found then
    /* Entitled to act at all? Two conditions, one answer.

       Note what is deliberately absent: no status claim. The client needs to
       know "you owe a password change" so it can route somewhere useful, and it
       does not need to be told the account is inactive — that would put a second
       copy of an authorization input somewhere that only expires hourly. */
    if u.status = 'active' and not coalesce(u.must_change_password, false) then
      select r::text into v_high
        from unnest(u.roles) r
       order by si_role_rank(r::text) desc
       limit 1;

      claims := jsonb_set(claims, '{user_roles}',
        coalesce(to_jsonb(array(select r::text from unnest(u.roles) r)), '[]'::jsonb));

      -- Retained: the highest role held. It is what the client lands on and
      -- displays, and it is what si_roles() falls back to for a token minted
      -- before migration 0020.
      claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(v_high), 'null'::jsonb));
    else
      /* REMOVED, not emptied. See THE TRAP above: '[]' here restores the very
         access this branch exists to withhold, silently. */
      claims := claims - 'user_roles' - 'user_role';
    end if;

    -- Unconditional. department_id and plant_ids route notifications and group
    -- the dashboard; is_protected only adds a rank tier to an account that must
    -- already hold 'admin' for it to mean anything, so withholding it would buy
    -- nothing.
    claims := jsonb_set(claims, '{department_id}', coalesce(to_jsonb(u.department_id), 'null'::jsonb));
    claims := jsonb_set(claims, '{plant_ids}',     coalesce(to_jsonb(u.plant_ids), '[]'::jsonb));
    claims := jsonb_set(claims, '{is_protected}',  to_jsonb(coalesce(u.is_protected, false)));

    -- The reason, so the client can route to /change-password instead of
    -- presenting an empty app with no explanation.
    claims := jsonb_set(claims, '{must_change_password}',
                        to_jsonb(coalesce(u.must_change_password, false)));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Restated rather than relied upon, as 0017 and 0020 do: `create or replace`
-- keeps the existing ACL, but a hook the auth server cannot execute fails
-- closed on every single sign-in.
grant  usage   on schema   public to supabase_auth_admin;
grant  execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant  select  on public.users to supabase_auth_admin;
