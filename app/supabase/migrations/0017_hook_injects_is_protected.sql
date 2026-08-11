-- ============================================================================
-- SI — Service Inside · 0017 Put is_protected in the access token
-- ============================================================================
-- 0015 built the superuser tier on a claim nothing was proven to emit.
--
-- si_is_superuser() reads `auth.jwt() ->> 'is_protected'`, and the hook recorded
-- in 0002 selects only role, department_id and plant_ids. 0015's own comment
-- says the flag is "the flag the hosted project already carries and already
-- injects into the JWT" — carries, yes, that is the users column; injects, that
-- was assumed from the column's existence and never checked against the live
-- function. If the live hook matches 0002 then si_is_superuser() is false for
-- everyone, the protected account signs in as an ordinary rank-5 admin, and the
-- sixth tier is inert: it cannot create an Administrator and cannot see
-- protected rows. Nothing errors — it just quietly is not a superuser.
--
-- This restates the whole hook with the claim included, so it converges to the
-- correct definition whether or not the live one already had it. Idempotent.
--
-- Consequence worth remembering: claims are minted at token issue, so an
-- existing session does not gain the claim until the token is next refreshed
-- (~hourly) or the user signs out and in. The protected account has never
-- signed in, so its first token carries it.
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
begin
  select role, department_id, plant_ids, is_protected
    into u
    from public.users
   where id = (event ->> 'user_id')::uuid;

  if found then
    claims := jsonb_set(claims, '{user_role}',     to_jsonb(u.role::text));
    claims := jsonb_set(claims, '{department_id}', coalesce(to_jsonb(u.department_id), 'null'::jsonb));
    claims := jsonb_set(claims, '{plant_ids}',     coalesce(to_jsonb(u.plant_ids), '[]'::jsonb));

    -- The superuser tier. Emitted as a real jsonb boolean, which is what
    -- si_is_superuser()'s `(... ->> 'is_protected')::boolean` and
    -- AuthContext's `claims.is_protected === true` both expect. Defaulted to
    -- false rather than left absent so the claim is always present and a
    -- missing hook is distinguishable from a non-protected user.
    claims := jsonb_set(claims, '{is_protected}', to_jsonb(coalesce(u.is_protected, false)));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Restated rather than relied upon: `create or replace` keeps the existing ACL,
-- but these are the grants the hook must have, and a hook the auth server
-- cannot execute fails closed on every sign-in.
grant  usage   on schema   public to supabase_auth_admin;
grant  execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant  select  on public.users to supabase_auth_admin;
