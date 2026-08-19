-- ============================================================================
-- SI — Service Inside · 0022 technicians joins the realtime publication
-- ============================================================================
-- One line, and the same omission 0012 recorded for users: 0005 added six
-- tables to supabase_realtime, one per listener that existed then; 0009 added
-- the eight reference tables; 0012 added users, noting that listenUsers() "has
-- really been a one-shot fetch" until then; 0018 added role_permissions.
-- technicians appears in none of them, and liveQuery() subscribes to it in two
-- places.
--
-- WHAT IT COSTS. A table outside the publication emits no postgres_changes
-- event, so liveQuery's initial fetch is the only refresh it ever gets. For
-- AssignPanel's roster (listenTechnicians, lib/workOrders.js) that means a
-- skills edit, an availability change, and a newly granted technician — the
-- profile row si_set_user_roles (0020) INSERTs when 'technician' enters a role
-- set — all reach the panel only when it remounts. listenTechnicianRecords
-- (lib/admin.js) carries the same subscription and has no consumer yet, so it
-- is fixed here before the screen that uses it exists.
--
-- Nothing errors in that state, which is why it survived four migrations: the
-- channel subscribes successfully and then stays silent forever.
--
-- Verify, before and after:
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' order by tablename;
--
-- RLS ON THE NEW STREAM. technicians_select is si_signed_in() (0002 — the
-- roster is system-wide on purpose, because the assignment picker needs the
-- full list regardless of who is looking), so every signed-in session is now
-- woken for every row change on this table. That discloses nothing: the same
-- session may already SELECT every one of those rows. liveQuery also throws
-- the payload away and re-runs its query, so what reaches a component is what
-- RLS returns on the refetch rather than what the WAL carried — which is why
-- the thin DELETE payload (without REPLICA IDENTITY FULL only the primary key
-- travels) does not matter here either. The app deletes no technicians row in
-- any case: 0020 leaves the profile in place when the role is removed, because
-- skills and certifications are facts about the person.
--
-- THE GUARD is 0009's and 0012's, not decoration: adding a table already in
-- the publication raises duplicate_object and would abort the whole migration.
-- Wrapped, this can be run by hand in the SQL editor now and pushed later, or
-- pushed twice, without either failing.
-- ============================================================================

do $$
begin
  execute 'alter publication supabase_realtime add table technicians';
exception when duplicate_object then null;
end $$;
