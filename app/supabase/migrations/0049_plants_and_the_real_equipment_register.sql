-- ============================================================================
-- SI — Service Inside · 0049 Plants become real, and equipment belongs to one
-- ============================================================================
-- Until now `plants` held one row — 'PLT001', "Main Plant", with a Bengaluru
-- address inherited from the architecture doc — and nothing ever chose a plant:
-- createWorkOrder() hardcoded 'PLT001' and no screen showed the field.
-- CLAUDE.md's "Known gaps" has recorded that as "single plant" since 0001.
--
-- PMW is four sites, not one: F1 (PMW Industries), F2 (PMW Concrete
-- Industries), F3 (PMW Industries F3) and Facility. This migration makes the
-- plant the thing that decides which equipment a work order can be raised
-- against, and loads the three 2026 master machinery lists.
--
-- ---------------------------------------------------------------------------
-- 1. Why the plant, and not the department
-- ---------------------------------------------------------------------------
-- The department stays exactly what 0019 left it: who triages the job, chosen
-- by whoever raises it, deciding nothing about access. The plant answers a
-- different question — *where the machine is* — and it is the only one the
-- master lists can answer, because those sheets carry a LOCATION column
-- (PMW-F1/F2/F3) and no department at all.
--
-- So `assets.department_id` loses its `not null`. That constraint is what made
-- the raise form ask for equipment first and fill the department in from the
-- machine (0032's createAsset() refuses to start without one), and it would
-- otherwise force this migration to invent a department for 134 machines —
-- guessing whether a 5-tonne overhead crane belongs to Production or to
-- Maintenance, 134 times, and writing the guesses into a column the app then
-- displays as fact. Equipment already registered keeps whatever department it
-- has; the imported machines carry none and are found by plant.
--
-- `work_orders.department_id` is untouched and still `not null`. That one is
-- answered by a person.
--
-- ---------------------------------------------------------------------------
-- 2. Every machine already registered is retired
-- ---------------------------------------------------------------------------
-- Retired, not deleted, for the reason 0031 exists: `work_orders.asset_id` is a
-- foreign key with no cascade and `asset_name` is denormalised onto the row, so
-- a work order raised against "Batching Plant" has to go on reading "Batching
-- Plant" forever. Measured on SI-CMMS-test before this migration:
-- 'AST-BATCHING-PLANT' carries 21 work orders and 'AST-FLOODLIGHT' 20. Deleting
-- either would have been refused by the constraint; retiring them keeps every
-- one of those records intact and only stops the machine being offered again.
--
-- The retirement is written as "everything that is not one of the rows below"
-- rather than as a list of ids, because the two projects hold different
-- equipment — test had drifted to eight rows registered from the raise form,
-- production has its own set — and a hardcoded list would leave whatever it
-- failed to name still on the picker. Same reasoning 0046 used for keying on a
-- flag instead of on email addresses.
--
-- ---------------------------------------------------------------------------
-- 3. Registering equipment from the raise form stops here
-- ---------------------------------------------------------------------------
-- 0032 opened `assets_insert` to any signed-in user, arguing that the person on
-- the floor with a fault to report is the one who notices the machine is
-- missing. That was right when the register was empty. It is also what produced
-- "Aircond", "Lampu", "Floodlight" and "Main office 1st floor" as plant
-- equipment, and with 134 machines loaded from controlled lists the same
-- affordance now only adds noise to a picker that is already complete.
--
-- What replaces it is "Other (specify)" — one row per plant, below — where what
-- the user types is recorded on that work order and nowhere else. The register
-- stops growing without anybody losing the ability to report a fault on
-- something unlisted.
--
-- `assets_insert` narrows to si_is_admin(), which is where the equipment admin
-- screen already sits (`assets_update` is supervisor-and-above, `assets_delete`
-- admin). Departments keep their open insert: 0019's argument still holds
-- there, and adding a department is not what drifted.
--
-- ---------------------------------------------------------------------------
-- 4. A retired plant cannot be chosen either
-- ---------------------------------------------------------------------------
-- 0031's central point is that a flag which only filters a dropdown decides
-- nothing — anything speaking to PostgREST carries on using the value. Adding
-- plants to the raise form without adding them to si_guard_retired_reference()
-- would repeat that exactly, so `plants` joins the tables that guard already
-- covers. It keys on `plants.status`, the column 0001 created, the same way
-- equipment keys on `assets.status` rather than carrying a second flag.
--
-- 'PLT001' is retired rather than deleted: `departments.plant_id`,
-- `users.plant_ids` and every work order raised before today point at it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Plants
-- ---------------------------------------------------------------------------
insert into plants (id, name, code, address, timezone, status) values
  ('F1',       'F1 — PMW Industries',          'F1',       null, 'Asia/Kuala_Lumpur', 'active'),
  ('F2',       'F2 — PMW Concrete Industries', 'F2',       null, 'Asia/Kuala_Lumpur', 'active'),
  ('F3',       'F3 — PMW Industries',          'F3',       null, 'Asia/Kuala_Lumpur', 'active'),
  ('FACILITY', 'Facility',                     'FACILITY', null, 'Asia/Kuala_Lumpur', 'active')
on conflict (id) do update
  set name     = excluded.name,
      code     = excluded.code,
      timezone = excluded.timezone,
      status   = excluded.status;

update plants set status = 'inactive' where id = 'PLT001';

-- Every work order raised before today was stamped 'PLT001' by createWorkOrder,
-- so this backfill only reaches rows written by something else. Constraining
-- the column afterwards is what lets the export and the filters treat "which
-- plant" as a question that is always answered.
update work_orders set plant_id = 'PLT001' where plant_id is null;
alter table work_orders alter column plant_id set not null;

-- ---------------------------------------------------------------------------
-- Equipment — the 2026 master lists
--
-- Ids are 'AST-{plant}-{nnn}' and NOT derived from the sheet's machine code,
-- because those codes are not unique even within one sheet: F1 uses L1 for both
-- "Lathe Machine No 1" and "Laser No 1", and C1/C2/C3 for both the cutting
-- machines and Cranes 1-3. The code is kept verbatim in `asset_code`, which has
-- no unique index and never has had one, so the shop-floor label survives
-- exactly as written.
--
-- `department_id` is null on every row — see note 1. `category` is null rather
-- than a guessed family; `model` is carried across where the sheet has one.
-- YEAR OF PURCHASED is deliberately dropped: the only column for it is
-- `install_date timestamptz`, and turning "2013" into a timestamp invents a day
-- and a month that nobody recorded.
-- ---------------------------------------------------------------------------
alter table assets alter column department_id drop not null;

insert into assets (id, asset_code, name, plant_id, model, department_id, category, criticality, status)
select v.id, v.asset_code, v.name, v.plant_id, v.model,
       null::text, null::text, 'medium'::si_criticality, 'active'::si_asset_status
  from (values
  -- F1 — 63 machines
  ('AST-F1-001', 'SP1', 'Steelpole Cutting Machine No 1', 'F1', 'Asaki'),
  ('AST-F1-002', 'SP2', 'Steelpole Swaging No 1', 'F1', null),
  ('AST-F1-003', 'SP3', 'Steelpole Swaging No 2', 'F1', null),
  ('AST-F1-004', 'SP4', 'Steelpole Drilling Drill No 1', 'F1', 'ZS-40 PS'),
  ('AST-F1-005', 'SP5', 'Steelpole Welding Machine', 'F1', 'MIG 550 id'),
  ('AST-F1-006', 'BS1', 'Brass Socket (Stamping) No 1', 'F1', 'J23-16B (09477)'),
  ('AST-F1-007', 'BS2', 'Brass Socket (Stamping) No 2', 'F1', null),
  ('AST-F1-008', 'BS3', 'Brass Socket No 3', 'F1', null),
  ('AST-F1-009', 'BS4', 'Brass Socket No 4', 'F1', 'J23-16B (92379)'),
  ('AST-F1-010', 'BS5', 'Brass Socket No 5', 'F1', 'J23-16B (92379)'),
  ('AST-F1-011', 'BS6', 'Brass Socket No 6', 'F1', 'J23-16B (92379)'),
  ('AST-F1-012', 'BS7', 'Brass Socket No 7', 'F1', null),
  ('AST-F1-013', 'B1', 'Hydraulic Press No 1', 'F1', 'P.H.S.-T300/50'),
  ('AST-F1-014', 'B2', 'Hydraulic Press No 2', 'F1', 'P.H.S.-T300/50'),
  ('AST-F1-015', 'B3', 'Hydraulic Press No 3', 'F1', 'W.C.S.7V-600/4000'),
  ('AST-F1-016', 'B4', 'Hydraulic Press No 4', 'F1', null),
  ('AST-F1-017', 'B5', 'Hydraulic Press No 5', 'F1', null),
  ('AST-F1-018', 'B6', 'Hydraulic Press No 6', 'F1', null),
  ('AST-F1-019', 'B7', 'Hydraulic Press No 7', 'F1', null),
  ('AST-F1-020', 'L1', 'Lathe Machine No 1', 'F1', null),
  ('AST-F1-021', 'L2', 'Lathe Machine No 2', 'F1', null),
  ('AST-F1-022', 'L3', 'Lathe Machine No 3', 'F1', null),
  ('AST-F1-023', 'L4', 'Lathe Machine No 4', 'F1', 'CW61160B'),
  ('AST-F1-024', 'L5', 'Lathe Machine (Vertical) No 5', 'F1', 'CX5112'),
  ('AST-F1-025', 'L6', 'Lathe Machine No 6', 'F1', 'CY-LI640G'),
  ('AST-F1-026', 'L7', 'Lathe Machine No 7', 'F1', 'C3040/1'),
  ('AST-F1-027', 'L8', 'Lathe Machine No 8', 'F1', 'L-5 (92997)'),
  ('AST-F1-028', 'L9', 'Lathe Machine No 9', 'F1', null),
  ('AST-F1-029', 'L10', 'Lathe Machine (CNC) No 10', 'F1', 'V TURN-20'),
  ('AST-F1-030', 'M1', 'Milling No 1', 'F1', 'X2012 Gantry'),
  ('AST-F1-031', 'M2', 'Milling No 2', 'F1', null),
  ('AST-F1-032', 'M3', 'Milling No 3', 'F1', 'XU6325'),
  ('AST-F1-033', 'M4', 'Milling (CNC) No 4', 'F1', null),
  ('AST-F1-034', 'M5', 'Milling (CNC) No 7', 'F1', 'PHC3016A'),
  ('AST-F1-035', 'P2', 'Plasma No 2', 'F1', null),
  ('AST-F1-036', 'P3', 'Plasma No 3', 'F1', null),
  ('AST-F1-037', 'L1', 'Laser No 1', 'F1', 'Welomart'),
  ('AST-F1-038', 'L2', 'Laser No 2', 'F1', null),
  ('AST-F1-039', 'C1', 'Shearcut No 1', 'F1', null),
  ('AST-F1-040', 'C2', 'Hydraulic Ironworker', 'F1', 'SHEM Q35YY-16'),
  ('AST-F1-041', 'C3', 'Bandsaw No 3', 'F1', 'AH-300H'),
  ('AST-F1-042', 'SD1', 'Screw Drill 1', 'F1', null),
  ('AST-F1-043', 'D1', 'Drill No 1', 'F1', 'Z3050X 16/1'),
  ('AST-F1-044', 'D2', 'Drill No 2', 'F1', 'H5-3C'),
  ('AST-F1-045', 'D3', 'Drill No 3', 'F1', 'H5 Z3025x10B'),
  ('AST-F1-046', 'D4', 'Drill No 4', 'F1', 'H5-32'),
  ('AST-F1-047', 'D5', 'Drill No 5', 'F1', 'Z5150A'),
  ('AST-F1-048', 'HD1', 'Hardening No 1', 'F1', null),
  ('AST-F1-049', 'AC1', 'Air Compressor 1130.7 K/P', 'F1', 'PK-PMT 7546'),
  ('AST-F1-050', 'AC2', 'Air Compressor 1000 K/P', 'F1', 'PK 75-250'),
  ('AST-F1-051', 'AC3', 'Air Receiver Tank 1034 K/P', 'F1', null),
  ('AST-F1-052', 'C1', 'Crane No 1 - 3 Tons PK-PMA 6880', 'F1', 'PK-PMA-56672'),
  ('AST-F1-053', 'C2', 'Crane No 2 - 3 Tons PK-PMA 5779', 'F1', 'PK-PMA-420'),
  ('AST-F1-054', 'C3', 'Crane No 3 - 3 Tons PK-PMA 5780', 'F1', 'PK-PMA-35017'),
  ('AST-F1-055', 'C4', 'Crane No 4 - 2 Tons PK-PMA 35019', 'F1', 'PK-PMA-35018'),
  ('AST-F1-056', 'C5', 'Crane No 5- 3 Tons PK-PMA 35017', 'F1', 'PK-PMA-5626'),
  ('AST-F1-057', 'C6', 'Crane No 6 - 5 Tons PK-PMA 35018', 'F1', 'PK-PMA-6880'),
  ('AST-F1-058', 'C7', 'Crane No 7 - 5 Tons PK-PMA 5626', 'F1', 'PK-PMA-35019'),
  ('AST-F1-059', 'C8', 'Crane No 8 - 5 Tons PK-PMA 113893', 'F1', null),
  ('AST-F1-060', 'C9', 'Crane No 9 - 5 Tons PK-PMA 56672', 'F1', 'PK-PMA-5779'),
  ('AST-F1-061', 'C10', 'Crane No 10 - 5 Tons PK-PMA 113894', 'F1', 'PK-PMA-5780'),
  ('AST-F1-062', 'C11', 'Crane No 11 - 5 Tons PK-PMA 420', 'F1', null),
  ('AST-F1-063', 'C12', 'Crane No 12 - 5 Tons PK-PMA 81100', 'F1', null),
  -- F2 — 38 machines
  ('AST-F2-001', 'AC1', 'Air Compressor No. 1', 'F2', null),
  ('AST-F2-002', 'AC2', 'Air Compressor No. 2', 'F2', null),
  ('AST-F2-003', 'BP', 'Batching Plant', 'F2', null),
  ('AST-F2-004', 'BL1', 'Boiler No.1', 'F2', null),
  ('AST-F2-005', 'BL2', 'Boiler No.2', 'F2', null),
  ('AST-F2-006', 'BHM1', 'Button Head Machine No.1', 'F2', null),
  ('AST-F2-007', 'BHM2', 'Button Head Machine No.2', 'F2', null),
  ('AST-F2-008', 'BHM3', 'Button Head Machine No.3', 'F2', null),
  ('AST-F2-009', 'CUR1', 'Curing Pit No.1', 'F2', null),
  ('AST-F2-010', 'CUR2', 'Curing Pit No.2', 'F2', null),
  ('AST-F2-011', 'CUR3', 'Curing Pit No.3', 'F2', null),
  ('AST-F2-012', 'CUR4', 'Curing Pit No.4', 'F2', null),
  ('AST-F2-013', 'CUR5', 'Curing Pit No.5', 'F2', null),
  ('AST-F2-014', 'CUR6', 'Curing Pit No.6', 'F2', null),
  ('AST-F2-015', 'CP1', 'Concrete Pump No.1', 'F2', null),
  ('AST-F2-016', 'CP2', 'Concrete Pump No.2', 'F2', null),
  ('AST-F2-017', 'IT1', 'Injection Trolley No.1', 'F2', null),
  ('AST-F2-018', 'IT2', 'Injection Trolley No.2', 'F2', null),
  ('AST-F2-019', 'MROS', 'Mold Release Oil Spraying Device', 'F2', null),
  ('AST-F2-020', 'OC1', 'Overhead Crane No.1 (Single Girder)', 'F2', null),
  ('AST-F2-021', 'OC2', 'Overhead Crane No.2 (Double Girder)', 'F2', null),
  ('AST-F2-022', 'OC3', 'Overhead Crane No.3 (Double Girder)', 'F2', null),
  ('AST-F2-023', 'OC4', 'Overhead Crane No.4 (Double Girder)', 'F2', null),
  ('AST-F2-024', 'OC5', 'Overhead Crane No.5 (Single Girder)', 'F2', null),
  ('AST-F2-025', 'OC6', 'Overhead Crane No.6 (Single Girder)', 'F2', null),
  ('AST-F2-026', 'PLD', 'Pulling Device', 'F2', null),
  ('AST-F2-027', 'PD', 'Pushing Device', 'F2', null),
  ('AST-F2-028', 'SP1', 'Spinning Machine No.1', 'F2', null),
  ('AST-F2-029', 'SP2', 'Spinning Machine No.2', 'F2', null),
  ('AST-F2-030', 'SP3', 'Spinning Machine No.3', 'F2', null),
  ('AST-F2-031', 'STR1', 'Strectching Equipment No.1', 'F2', null),
  ('AST-F2-032', 'STR2', 'Strectching Equipment No.2', 'F2', null),
  ('AST-F2-033', 'STR3', 'Strectching Equipment No.3', 'F2', null),
  ('AST-F2-034', 'STR4', 'Strectching Equipment No.4', 'F2', null),
  ('AST-F2-035', 'WC1', 'Wire Caging Machine No.1', 'F2', null),
  ('AST-F2-036', 'WC2', 'Wire Caging Machine No.2', 'F2', null),
  ('AST-F2-037', 'WC3', 'Wire Caging Machine No.3', 'F2', null),
  ('AST-F2-038', 'WCM', 'Wire Cutting Machine', 'F2', null),
  -- F3 — 33 machines
  ('AST-F3-001', 'AC1', 'Air Compressor No. 1', 'F3', null),
  ('AST-F3-002', 'AC2', 'Air Compressor No. 2', 'F3', null),
  ('AST-F3-003', 'BP', 'Batching Plant', 'F3', null),
  ('AST-F3-004', 'BL', 'Boiler', 'F3', null),
  ('AST-F3-005', 'BHM1', 'Button Head Machine No.1', 'F3', null),
  ('AST-F3-006', 'BHM2', 'Button Head Machine No.2', 'F3', null),
  ('AST-F3-007', 'BHM3', 'Button Head Machine No.3', 'F3', null),
  ('AST-F3-008', 'CUR1', 'Curing Pit No.1', 'F3', null),
  ('AST-F3-009', 'CUR2', 'Curing Pit No.2', 'F3', null),
  ('AST-F3-010', 'CUR3', 'Curing Pit No.3', 'F3', null),
  ('AST-F3-011', 'CUR4', 'Curing Pit No.4', 'F3', null),
  ('AST-F3-012', 'CUR5', 'Curing Pit No.5', 'F3', null),
  ('AST-F3-013', 'CUR6', 'Curing Pit No.6', 'F3', null),
  ('AST-F3-014', 'CP', 'Concrete Pump', 'F3', null),
  ('AST-F3-015', 'MROS', 'Mold Release Oil Spraying Device', 'F3', null),
  ('AST-F3-016', 'OC1', 'Overhead Crane No.1 (Single Girder)', 'F3', null),
  ('AST-F3-017', 'OC2', 'Overhead Crane No.2 (Double Girder)', 'F3', null),
  ('AST-F3-018', 'OC3', 'Overhead Crane No.3 (Double Girder)', 'F3', null),
  ('AST-F3-019', 'OC4', 'Overhead Crane No.4 (Double Girder)', 'F3', null),
  ('AST-F3-020', 'OC5', 'Overhead Crane No.5 (Single Girder)', 'F3', null),
  ('AST-F3-021', 'OC6', 'Overhead Crane No.6 (Single Girder)', 'F3', null),
  ('AST-F3-022', 'PLD', 'Pulling Device', 'F3', null),
  ('AST-F3-023', 'PD', 'Pushing Device', 'F3', null),
  ('AST-F3-024', 'SP1', 'Spinning Machine No.1', 'F3', null),
  ('AST-F3-025', 'SP2', 'Spinning Machine No.2', 'F3', null),
  ('AST-F3-026', 'STR1', 'Strectching Equipment No.1', 'F3', null),
  ('AST-F3-027', 'STR2', 'Strectching Equipment No.2', 'F3', null),
  ('AST-F3-028', 'STR3', 'Strectching Equipment No.3', 'F3', null),
  ('AST-F3-029', 'STR4', 'Strectching Equipment No.4', 'F3', null),
  ('AST-F3-030', 'WC1', 'Wire Caging Machine No.1', 'F3', null),
  ('AST-F3-031', 'WC2', 'Wire Caging Machine No.2', 'F3', null),
  ('AST-F3-032', 'WC3', 'Wire Caging Machine No.3', 'F3', null),
  ('AST-F3-033', 'WCM', 'Auto Wire Cutting Machine', 'F3', null),
  -- The 'Other' escape hatch, one per plant. Facility has no list of its own yet,
  -- so for now this is the only thing it offers.
  ('AST-F1-OTHER', 'OTHER', 'Other (specify)', 'F1', null),
  ('AST-F2-OTHER', 'OTHER', 'Other (specify)', 'F2', null),
  ('AST-F3-OTHER', 'OTHER', 'Other (specify)', 'F3', null),
  ('AST-FACILITY-OTHER', 'OTHER', 'Other (specify)', 'FACILITY', null)
  ) as v(id, asset_code, name, plant_id, model)
on conflict (id) do update
  set asset_code = excluded.asset_code,
      name       = excluded.name,
      plant_id   = excluded.plant_id,
      model      = excluded.model,
      status     = excluded.status;

-- Everything else is out of use. Written as a negation for the reason in note
-- 2: the two projects hold different equipment and a list of ids would leave
-- whatever it did not name still on the picker.
update assets
   set status = 'decommissioned'
 where status = 'active'
   and id not like 'AST-F1-%'
   and id not like 'AST-F2-%'
   and id not like 'AST-F3-%'
   and id not like 'AST-FACILITY-%';

-- ---------------------------------------------------------------------------
-- Registering equipment from the raise form stops here — see note 3
-- ---------------------------------------------------------------------------
drop policy if exists assets_insert on assets;
create policy assets_insert on assets
  for insert to authenticated
  with check (si_is_admin());

-- ---------------------------------------------------------------------------
-- A retired plant cannot be chosen either — see note 4
--
-- Both functions are `create or replace`, so both re-issue their grants
-- immediately afterwards: a later create-or-replace resets options an earlier
-- `alter function`/`grant` set, which is the trap 0034's header records and
-- CLAUDE.md repeats. `search_path` is restated in the header for the same
-- reason.
-- ---------------------------------------------------------------------------
create or replace function si_reference_is_retired(p_table text, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_retired boolean;
begin
  if p_key is null then return false; end if;

  case p_table
    when 'priorities'        then select not is_active into v_retired from priorities        where id   = p_key::si_priority;
    when 'impact_levels'     then select not is_active into v_retired from impact_levels     where code = p_key::si_impact;
    when 'wo_types'          then select not is_active into v_retired from wo_types          where code = p_key::si_wo_type;
    when 'safety_severities' then select not is_active into v_retired from safety_severities where code = p_key;
    when 'departments'       then select not is_active into v_retired from departments       where id   = p_key;
    when 'assets'            then select status <> 'active' into v_retired from assets       where id   = p_key;
    -- New in 0049. `plants.status` is si_user_status, so 'inactive' is the
    -- retired state; equipment above reads its own `status` column the same way
    -- rather than carrying a second flag beside it.
    when 'plants'            then select status <> 'active' into v_retired from plants       where id   = p_key;
    else raise exception '% is not a retirable reference table', p_table;
  end case;

  -- No row: not retired. A value with no reference row is a labelling problem,
  -- not a retirement, and refusing it here would turn one into the other.
  return coalesce(v_retired, false);
exception
  -- An unknown enum label cannot be retired because it cannot exist. The cast
  -- raises rather than returning no row, and that must not become a refusal.
  when invalid_text_representation then return false;
end;
$$;

revoke all on function si_reference_is_retired(text, text) from public, anon;
grant execute on function si_reference_is_retired(text, text) to authenticated;

create or replace function si_guard_retired_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_severity text;
  v_severity_changed boolean;
  v_priority_changed boolean;
  v_type_changed     boolean;
  v_impact_changed   boolean;
  v_dept_changed     boolean;
  v_asset_changed    boolean;
  v_plant_changed    boolean;
begin
  if auth.uid() is null then return new; end if;

  -- The account that retired it can still use it. Nothing in this schema locks
  -- the top account out of undoing its own decision, and the alternative is a
  -- Superuser having to restore a row to fix one record.
  if si_is_superuser() then return new; end if;

  v_new_severity := case when coalesce((new.safety_risk ->> 'flag')::boolean, false)
                         then new.safety_risk ->> 'severity' end;

  /* OLD is unassigned in a BEFORE INSERT trigger — referencing old.priority
     there raises "record old is not assigned yet", so the two operations get
     separate branches rather than one expression relying on `or` to short
     circuit. On INSERT every value is being set; on UPDATE only the changed
     ones are, which is what keeps an existing work order carrying a retired
     priority workable right through to closed. */
  if tg_op = 'INSERT' then
    v_priority_changed := true;
    v_type_changed     := true;
    v_impact_changed   := true;
    v_dept_changed     := true;
    v_asset_changed    := true;
    v_severity_changed := true;
    v_plant_changed    := true;
  else
    v_priority_changed := new.priority      is distinct from old.priority;
    v_type_changed     := new.type          is distinct from old.type;
    v_impact_changed   := new.impact        is distinct from old.impact;
    v_dept_changed     := new.department_id is distinct from old.department_id;
    v_asset_changed    := new.asset_id      is distinct from old.asset_id;
    v_plant_changed    := new.plant_id      is distinct from old.plant_id;
    v_severity_changed := v_new_severity is distinct from
      (case when coalesce((old.safety_risk ->> 'flag')::boolean, false)
            then old.safety_risk ->> 'severity' end);
  end if;

  if v_priority_changed and si_reference_is_retired('priorities', new.priority::text) then
    raise exception 'That priority has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_type_changed and si_reference_is_retired('wo_types', new.type::text) then
    raise exception 'That work order type has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_impact_changed and si_reference_is_retired('impact_levels', new.impact::text) then
    raise exception 'That impact level has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_dept_changed and si_reference_is_retired('departments', new.department_id) then
    raise exception 'That department has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_asset_changed and si_reference_is_retired('assets', new.asset_id) then
    raise exception 'That equipment has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_plant_changed and si_reference_is_retired('plants', new.plant_id) then
    raise exception 'That plant is no longer in use and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_severity_changed and si_reference_is_retired('safety_severities', v_new_severity) then
    raise exception 'That safety severity has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_retired_reference() from public, anon, authenticated;
