-- SI — Service Inside · migration 0032
--
-- Anybody signed in may register a piece of equipment.
--
-- This is 0019's department change, applied to the other half of the raise form.
-- 0019 opened `departments_insert` to si_signed_in() because the person on the
-- floor filing against a bay nobody registered should not have to wait for an
-- Administrator. The machine they are filing against is the same problem, and
-- was the more common one: a new lathe is registered by whoever notices it is
-- missing, which is whoever is standing in front of it with a fault to report.
--
-- Before this, `assets_insert` was `si_is_manager_or_admin() or si_is_supervisor()`,
-- so a Requester or a Technician who could not find their machine had nowhere to
-- go — the picker said "No equipment matches that" and stopped.
--
-- INSERT ONLY, and the three verbs stay deliberately different:
--
--   select  si_signed_in()                              (unchanged)
--   insert  si_signed_in()                              <- this migration
--   update  supervisor / manager / admin                (unchanged)
--   delete  admin                                       (unchanged)
--
-- Renaming is the dangerous half, exactly as 0019 said of departments: `id` is
-- what work_orders reference and `name` is denormalised onto
-- work_orders.asset_name, so a rename rewrites how existing records read. And
-- removing one is 0031's business — it is refused while any work order points at
-- it, and retiring is the answer.
--
-- The client half has to be an INSERT, not an upsert. PostgREST turns an upsert
-- into `insert ... on conflict do update`, which needs the UPDATE policy as
-- well — so RLS already refuses it — but createAsset() in lib/admin.js states it
-- as an insert anyway, for the same reason createDepartment() does: a collision
-- has to come back as a collision rather than silently rewriting somebody
-- else's machine.

drop policy if exists assets_insert on assets;
create policy assets_insert on assets
  for insert to authenticated
  with check (si_signed_in());

comment on policy assets_insert on assets is
  'Any signed-in user may register equipment, so the raise form can offer "+ Add new" (0032). Editing and deleting stay restricted.';
