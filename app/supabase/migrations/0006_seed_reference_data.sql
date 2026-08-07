-- ============================================================================
-- SI — Service Inside · 0006 Reference data
-- ============================================================================
-- Seeds PLANTS, DEPARTMENTS, ASSETS, PRIORITY_META and SLA_TARGETS from
-- schema/schema.js. These are configuration, not user data, so they belong in
-- a migration rather than a seed script — every environment needs them and
-- needs them identical.
--
-- This is what closes README open items #3 and #4: the app can read
-- /departments, /assets, /priorities and /sla as real tables instead of
-- importing the frozen arrays in src/lib/constants.js. Seeding /sla in
-- particular is what makes si_sla_target_minutes() configurable rather than
-- falling back to its hardcoded defaults.
--
-- Idempotent — safe to re-run.
-- ============================================================================

insert into plants (id, name, code, address, timezone, status) values
  ('PLT001', 'Main Plant', 'PLT001',
   '{"line1": "Plot 14, Industrial Estate", "city": "Bengaluru", "state": "Karnataka", "country": "India"}'::jsonb,
   'Asia/Kolkata', 'active')
on conflict (id) do update
  set name = excluded.name, code = excluded.code, address = excluded.address,
      timezone = excluded.timezone, status = excluded.status;

insert into departments (id, name, code, plant_id) values
  ('DEPT-MACHINING',  'Machining',  'MACH',  'PLT001'),
  ('DEPT-ASSEMBLY',   'Assembly',   'ASSY',  'PLT001'),
  ('DEPT-PRESS',      'Press Shop', 'PRESS', 'PLT001'),
  ('DEPT-UTILITIES',  'Utilities',  'UTIL',  'PLT001'),
  ('DEPT-PACKAGING',  'Packaging',  'PACK',  'PLT001'),
  ('DEPT-WAREHOUSE',  'Warehouse',  'WHSE',  'PLT001'),
  ('DEPT-QUALITY',    'Quality',    'QUAL',  'PLT001')
on conflict (id) do update
  set name = excluded.name, code = excluded.code, plant_id = excluded.plant_id;

-- criticality is lowercase here, following the architecture doc rather than the
-- Title Case in constants.js — see DIVERGENCES.criticality_case in schema.js.
insert into assets (id, asset_code, name, category, department_id, plant_id, criticality, status) values
  ('AST-0412', 'AST-0412', 'CNC Lathe #04',     'Machining',         'DEPT-MACHINING', 'PLT001', 'high',   'active'),
  ('AST-0288', 'AST-0288', 'Conveyor B-2',      'Material Handling', 'DEPT-ASSEMBLY',  'PLT001', 'medium', 'active'),
  ('AST-0157', 'AST-0157', 'Hydraulic Press 3', 'Forming',           'DEPT-PRESS',     'PLT001', 'high',   'active'),
  ('AST-0330', 'AST-0330', 'Air Compressor 1',  'Utilities',         'DEPT-UTILITIES', 'PLT001', 'medium', 'active'),
  ('AST-0501', 'AST-0501', 'Packaging Line C',  'Packaging',         'DEPT-PACKAGING', 'PLT001', 'medium', 'active'),
  ('AST-0099', 'AST-0099', 'Overhead Crane 2',  'Material Handling', 'DEPT-WAREHOUSE', 'PLT001', 'low',    'active'),
  ('AST-0212', 'AST-0212', 'Boiler Unit A',     'Utilities',         'DEPT-UTILITIES', 'PLT001', 'high',   'active')
on conflict (id) do update
  set asset_code = excluded.asset_code, name = excluded.name, category = excluded.category,
      department_id = excluded.department_id, plant_id = excluded.plant_id,
      criticality = excluded.criticality, status = excluded.status;

insert into priorities (id, code, label, color_hex, rank, description) values
  ('P1', 'P1', 'Critical', '#EF4444', 1, 'Full production stoppage or an active safety risk.'),
  ('P2', 'P2', 'High',     '#F59E0B', 2, 'Running at reduced capacity, or an environmental risk.'),
  ('P3', 'P3', 'Medium',   '#FBBF24', 3, 'Auxiliary equipment; no production line impact.'),
  ('P4', 'P4', 'Low',      '#0F3D91', 4, 'Cosmetic or routine; no production impact.')
on conflict (id) do update
  set code = excluded.code, label = excluded.label, color_hex = excluded.color_hex,
      rank = excluded.rank, description = excluded.description;

-- plant_id null = the global default. A plant override would be seeded as
-- '{plant_id}_{priority_code}'.
insert into sla (id, priority_id, plant_id, ack_target_minutes, resolution_target_minutes, resolution_target_label) values
  ('P1', 'P1', null,   5,  240, '4 hrs'),
  ('P2', 'P2', null,  15,  480, '8 hrs'),
  ('P3', 'P3', null,  30, 1440, '24 hrs'),
  ('P4', 'P4', null, 120, 7200, '5 business days')
on conflict (id) do update
  set priority_id = excluded.priority_id, plant_id = excluded.plant_id,
      ack_target_minutes = excluded.ack_target_minutes,
      resolution_target_minutes = excluded.resolution_target_minutes,
      resolution_target_label = excluded.resolution_target_label;

-- Give the dashboard two rows to read immediately, so a fresh environment
-- renders zeroes rather than a permanent loading state.
select si_compute_dashboard_stats();
