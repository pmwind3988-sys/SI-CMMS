-- SI — Service Inside · migration 0009
--
-- Moves the last of the hardcoded domain data out of src/lib/constants.js and
-- into tables an Administrator can edit.
--
-- What was in constants.js and where it goes:
--   STATUS_FLOW + STATUS_LABELS + STATUS_COLORS  -> wo_statuses
--   IMPACT_OPTIONS (value/label/suggests)        -> impact_levels
--   the Breakdown/Inspection/Project buttons     -> wo_types
--   the safety severity escalation               -> safety_severities
--   SLA_MATRIX (ack/response/resolution)         -> sla (columns added below)
--   PRIORITY_COLORS                              -> priorities.color_hex (already existed)
--   DEPARTMENTS / EQUIPMENT                      -> departments / assets (already existed)
--
-- Every table below is keyed on the matching enum rather than free text. That is
-- deliberate: the enums are what work_orders columns are actually typed as, so a
-- row here can only ever describe a status the database already accepts, and a
-- status can never be renamed out from under existing rows. It means an admin can
-- relabel and recolour freely, but adding a genuinely new status stays a
-- migration — which is correct, because new statuses need transition rows and
-- trigger logic, not just a label.
--
-- Authorization: readable by any signed-in user (the UI needs labels to render),
-- writable by Administrators only. These are system configuration, not
-- operational data.

/* ------------------------------------------------------------------
   Work order statuses — labels, colours and display order
-------------------------------------------------------------------*/
create table if not exists wo_statuses (
  code         si_wo_status primary key,
  label        text        not null,
  color_hex    text        not null default '#64748B',
  sort_order   integer     not null,
  is_terminal  boolean     not null default false,
  description  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint wo_statuses_color_hex_format check (color_hex ~* '^#[0-9a-f]{6}$'),
  constraint wo_statuses_label_not_blank  check (length(btrim(label)) > 0)
);

comment on table wo_statuses is
  'Display metadata for si_wo_status. Admin-editable labels/colours; the set of codes is fixed by the enum.';

insert into wo_statuses (code, label, color_hex, sort_order, is_terminal, description) values
  ('open',               'Open',                '#0F3D91',  1, false, 'Raised and waiting for a Supervisor to assign a technician.'),
  ('assigned',           'Assigned',            '#0F3D91',  2, false, 'A technician has been nominated but has not accepted yet.'),
  ('accepted',           'Accepted',            '#F59E0B',  3, false, 'The technician has accepted the job.'),
  ('on_the_way',         'On The Way',          '#F59E0B',  4, false, 'The technician is travelling to the equipment.'),
  ('on_site',            'On Site',             '#F59E0B',  5, false, 'The technician has arrived and is assessing.'),
  ('repairing',          'Repairing',           '#F59E0B',  6, false, 'Repair work is underway.'),
  ('waiting_spare_part', 'Waiting Spare Part',  '#64748B',  7, false, 'Paused pending a part.'),
  ('testing',            'Testing',             '#F59E0B',  8, false, 'Repair complete, verifying under load.'),
  ('completed',          'Completed',           '#F59E0B',  9, false, 'Technician is finished; awaiting requester verification.'),
  ('verified',           'Verified',            '#22C55E', 10, false, 'Requester has confirmed the fix.'),
  ('closed',             'Closed',              '#22C55E', 11, true,  'Finalised and archived.')
on conflict (code) do update
  set label = excluded.label,
      color_hex = excluded.color_hex,
      sort_order = excluded.sort_order,
      is_terminal = excluded.is_terminal,
      description = excluded.description;

/* ------------------------------------------------------------------
   Production impact levels — and the priority each one suggests
-------------------------------------------------------------------*/
create table if not exists impact_levels (
  code               si_impact   primary key,
  label              text        not null,
  suggests_priority  si_priority not null references priorities(id),
  sort_order         integer     not null,
  description        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint impact_levels_label_not_blank check (length(btrim(label)) > 0)
);

comment on table impact_levels is
  'Production impact options for the raise form, and the priority each suggests. Drives computeSuggestion() in the client.';

insert into impact_levels (code, label, suggests_priority, sort_order, description) values
  ('full_stoppage',    'Full production stoppage',                'P1', 1, 'The line is down.'),
  ('reduced_capacity', 'Running at reduced capacity',             'P2', 2, 'Still producing, below target.'),
  ('auxiliary',        'Auxiliary equipment, no line impact',     'P3', 3, 'Support equipment only.'),
  ('none',             'No production impact (cosmetic/routine)', 'P4', 4, 'Housekeeping or cosmetic.')
on conflict (code) do update
  set label = excluded.label,
      suggests_priority = excluded.suggests_priority,
      sort_order = excluded.sort_order,
      description = excluded.description;

/* ------------------------------------------------------------------
   Work order types
-------------------------------------------------------------------*/
create table if not exists wo_types (
  code        si_wo_type  primary key,
  label       text        not null,
  sort_order  integer     not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint wo_types_label_not_blank check (length(btrim(label)) > 0)
);

insert into wo_types (code, label, sort_order, description) values
  ('breakdown',  'Breakdown',  1, 'Unplanned failure needing corrective work.'),
  ('inspection', 'Inspection', 2, 'Planned or routine check.'),
  ('project',    'Project',    3, 'Improvement or installation work.')
on conflict (code) do update
  set label = excluded.label, sort_order = excluded.sort_order, description = excluded.description;

/* ------------------------------------------------------------------
   Safety severities — and the priority ceiling each one forces
-------------------------------------------------------------------*/
create table if not exists safety_severities (
  code                 text        primary key,
  label                text        not null,
  escalates_to_priority si_priority not null references priorities(id),
  sort_order           integer     not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint safety_severities_label_not_blank check (length(btrim(label)) > 0)
);

comment on table safety_severities is
  'A flagged safety risk caps the suggested priority at escalates_to_priority. Previously hardcoded in computeSuggestion().';

-- "Low" was offered by the raise form but computeSuggestion() treated every
-- severity other than "High" as a P2 ceiling, so Low behaved exactly like
-- Medium. Seeded with that same ceiling to preserve the existing behaviour
-- rather than silently change it; the rule is now visible and editable.
insert into safety_severities (code, label, escalates_to_priority, sort_order) values
  ('High',   'High — immediate danger to people',   'P1', 1),
  ('Medium', 'Medium — hazardous if unaddressed',   'P2', 2),
  ('Low',    'Low — minor hazard, controlled',      'P2', 3)
on conflict (code) do update
  set label = excluded.label,
      escalates_to_priority = excluded.escalates_to_priority,
      sort_order = excluded.sort_order;

/* ------------------------------------------------------------------
   SLA — add the response target and the human labels the UI shows.
   0006 seeded ack + resolution only; the detail page also displays a
   response target, which was being read from the hardcoded SLA_MATRIX.
-------------------------------------------------------------------*/
alter table sla add column if not exists ack_target_label       text;
alter table sla add column if not exists response_target_minutes integer;
alter table sla add column if not exists response_target_label   text;

update sla set ack_target_label = '5 min',  response_target_minutes = 15,   response_target_label = '15 min' where priority_id = 'P1';
update sla set ack_target_label = '15 min', response_target_minutes = 60,   response_target_label = '1 hr'   where priority_id = 'P2';
update sla set ack_target_label = '30 min', response_target_minutes = 240,  response_target_label = '4 hrs'  where priority_id = 'P3';
update sla set ack_target_label = '2 hrs',  response_target_minutes = 1440, response_target_label = '24 hrs' where priority_id = 'P4';

/* ------------------------------------------------------------------
   updated_at triggers
-------------------------------------------------------------------*/
drop trigger if exists touch_wo_statuses on wo_statuses;
create trigger touch_wo_statuses before update on wo_statuses
  for each row execute function si_touch_updated_at();

drop trigger if exists touch_impact_levels on impact_levels;
create trigger touch_impact_levels before update on impact_levels
  for each row execute function si_touch_updated_at();

drop trigger if exists touch_wo_types on wo_types;
create trigger touch_wo_types before update on wo_types
  for each row execute function si_touch_updated_at();

drop trigger if exists touch_safety_severities on safety_severities;
create trigger touch_safety_severities before update on safety_severities
  for each row execute function si_touch_updated_at();

/* ------------------------------------------------------------------
   RLS — everyone signed in reads, Administrators write.
-------------------------------------------------------------------*/
alter table wo_statuses       enable row level security;
alter table impact_levels     enable row level security;
alter table wo_types          enable row level security;
alter table safety_severities enable row level security;

drop policy if exists wo_statuses_select on wo_statuses;
create policy wo_statuses_select on wo_statuses
  for select to authenticated using (si_signed_in());
drop policy if exists wo_statuses_write on wo_statuses;
create policy wo_statuses_write on wo_statuses
  for update to authenticated using (si_is_admin()) with check (si_is_admin());

drop policy if exists impact_levels_select on impact_levels;
create policy impact_levels_select on impact_levels
  for select to authenticated using (si_signed_in());
drop policy if exists impact_levels_write on impact_levels;
create policy impact_levels_write on impact_levels
  for update to authenticated using (si_is_admin()) with check (si_is_admin());

drop policy if exists wo_types_select on wo_types;
create policy wo_types_select on wo_types
  for select to authenticated using (si_signed_in());
drop policy if exists wo_types_write on wo_types;
create policy wo_types_write on wo_types
  for update to authenticated using (si_is_admin()) with check (si_is_admin());

drop policy if exists safety_severities_select on safety_severities;
create policy safety_severities_select on safety_severities
  for select to authenticated using (si_signed_in());
drop policy if exists safety_severities_write on safety_severities;
create policy safety_severities_write on safety_severities
  for update to authenticated using (si_is_admin()) with check (si_is_admin());

-- No INSERT or DELETE policies anywhere above. The primary keys are enums, so
-- the valid set of rows is already fixed by the schema; allowing inserts would
-- only ever fail on the enum cast, and allowing deletes would leave work orders
-- referencing a status with no label. Relabelling is the supported operation.

/* ------------------------------------------------------------------
   Realtime — so an admin's edit reaches every open session immediately.
-------------------------------------------------------------------*/
do $$
begin
  execute 'alter publication supabase_realtime add table wo_statuses';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table impact_levels';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table wo_types';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table safety_severities';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table departments';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table assets';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table priorities';
exception when duplicate_object then null;
end $$;
do $$
begin
  execute 'alter publication supabase_realtime add table sla';
exception when duplicate_object then null;
end $$;
