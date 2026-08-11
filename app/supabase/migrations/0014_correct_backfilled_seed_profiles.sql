-- ============================================================================
-- SI — Service Inside · 0013 Correct the seed profile snapshot from 0012
-- ============================================================================
-- 0012 backfilled seed_name/seed_phone with `coalesce(u.seed_name, u.name)` —
-- that is, whatever the account was called at migration time. For an account
-- that had already been renamed away from its seeded identity, that snapshot is
-- wrong in the worst direction: seed_name comes out equal to the current name,
-- so 'unchanged_profile' reads true forever on an account somebody has clearly
-- claimed. It showed up immediately — admin@example.com had been renamed to a
-- real person and was still labelled "Seed profile".
--
-- The values bootstrapUsers.js writes are known exactly, so use those instead
-- of guessing from the live row. After this the flag means what it says: name
-- and phone still character-for-character what the seeding script set.
--
-- Only touches accounts still marked as seeded, so clearing a demo mark
-- (seed_source = null) is not undone by re-running this.
-- ============================================================================

update public.users u
   set seed_name  = v.seed_name,
       seed_phone = v.seed_phone
  from (values
    ('requester@example.com',  'Ravi Kumar',  '98450 11223'),
    ('tech.arun@example.com',  'Arun Kumar',  '98450 77003'),
    ('tech.meera@example.com', 'Meera Iyer',  '98450 77004'),
    ('supervisor@example.com', 'Priya Nair',  '98450 99001'),
    ('manager@example.com',    'Vikram Shah', '98450 88002'),
    ('admin@example.com',      'Anita Desai', '98450 66009')
  ) as v(email, seed_name, seed_phone)
 where lower(u.email) = v.email
   and u.seed_source = 'bootstrap';
