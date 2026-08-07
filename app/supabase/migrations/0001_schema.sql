-- ============================================================================
-- SI — Service Inside · 0001 Schema
-- ============================================================================
-- Ported 1:1 from schema/schema.js COLLECTIONS, which remains the source of
-- truth for field names and enum literals. Every Firestore collection becomes
-- one table; snake_case field names carry over unchanged, so the client-side
-- data layer reads the same keys it always did.
--
-- Three shape changes are deliberate and are the only places this diverges
-- from the Firestore document model:
--
--   1. Document IDs that were Firebase Auth UIDs (users, technicians) become
--      uuid FKs onto auth.users(id). Business-key IDs (DEPT-*, AST-*, PLT*,
--      P1..P4) stay text, because they are printed on asset tags and referenced
--      by humans. Auto-generated IDs become uuid.
--
--   2. /stats held two hand-shaped documents. It becomes stats(id, data jsonb)
--      so the two payloads keep their exact JSON shape and the dashboard
--      client code is unchanged.
--
--   3. Firestore maps (safety_risk, environmental_risk, plants.address) become
--      jsonb. Arrays (plant_ids, skills) become text[].
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- ENUMS — the load-bearing string literals from schema.js. Postgres enums are
-- used rather than CHECK constraints so a typo fails at write time with a
-- clear message, and so generated TypeScript types carry the union.
-- ---------------------------------------------------------------------------

create type si_role            as enum ('requester','technician','supervisor','manager','admin');
create type si_wo_status       as enum ('open','assigned','accepted','on_the_way','on_site',
                                        'repairing','waiting_spare_part','testing',
                                        'completed','verified','closed');
create type si_priority        as enum ('P1','P2','P3','P4');
create type si_wo_type         as enum ('breakdown','inspection','project');
create type si_impact          as enum ('full_stoppage','reduced_capacity','auxiliary','none');
create type si_downtime_unit   as enum ('hours','days');
create type si_criticality     as enum ('high','medium','low');
create type si_asset_status    as enum ('active','under_maintenance','decommissioned','disposed');
create type si_user_status     as enum ('active','inactive');
create type si_availability    as enum ('available','busy','on_leave');
create type si_notif_status    as enum ('sent','read');
create type si_file_type       as enum ('photo','video','document');
create type si_entity_type     as enum ('work_order','asset','comment');
create type si_build_type      as enum ('debug','release');

-- ---------------------------------------------------------------------------
-- REFERENCE / CONFIGURATION TABLES
-- ---------------------------------------------------------------------------

create table plants (
  id          text primary key,                    -- PLT{NNN}
  name        text not null,
  code        text,
  address     jsonb,                               -- { line1, city, state, country }
  timezone    text,                                -- IANA, e.g. Asia/Kolkata
  status      si_user_status default 'active',
  created_at  timestamptz not null default now()
);

create table departments (
  id          text primary key,                    -- DEPT-{NAME}
  name        text not null,
  code        text not null unique,                -- e.g. MACH
  plant_id    text references plants(id),
  manager_id  uuid,                                -- FK added after users exists
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table priorities (
  id          si_priority primary key,             -- the code itself
  code        si_priority not null,
  label       text not null,
  color_hex   text,
  rank        int,                                 -- 1 is most severe
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table sla (
  id                        text primary key,      -- {priority} or {plant}_{priority}
  priority_id               si_priority not null references priorities(id),
  plant_id                  text references plants(id),  -- null = global default
  ack_target_minutes        int not null,
  resolution_target_minutes int not null,
  resolution_target_label   text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- IDENTITY
-- ---------------------------------------------------------------------------

-- One row per auth.users row. `role` here is what the JWT claims hook reads
-- (see 0002), so this table is the authorization source of truth even though
-- the claim itself is what RLS evaluates on each request.
create table users (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  email         text not null,
  phone         text default '',
  role          si_role not null,
  department_id text references departments(id),
  plant_ids     text[] not null default '{}',
  photo_url     text,
  status        si_user_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);

alter table departments
  add constraint departments_manager_id_fkey
  foreign key (manager_id) references users(id) on delete set null;

-- 1:1 profile extension for technicians. PK is the users id, matching the
-- architecture doc's requirement that technicians/{id} == the Auth UID and
-- closing DIVERGENCES.technician_doc_id — Postgres FKs make the slug fallback
-- that seedDatabase.js needed impossible, which is the point.
create table technicians (
  user_id             uuid primary key references users(id) on delete cascade,
  name                text,
  skills              text[] not null default '{}',
  certifications      text[] not null default '{}',
  current_load        int not null default 0,
  availability_status si_availability not null default 'available',
  plant_ids           text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table assets (
  id             text primary key,                 -- AST-{NNNN}
  asset_code     text not null,
  name           text not null,
  category       text,
  department_id  text not null references departments(id),
  plant_id       text references plants(id),
  criticality    si_criticality default 'medium',
  status         si_asset_status not null default 'active',
  manufacturer   text,
  model          text,
  serial_number  text,
  install_date   timestamptz,
  warranty_expiry timestamptz,
  meter_reading  numeric,
  meter_unit     text,
  qr_code        text,
  photo_url      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- WORK ORDERS — the core entity
-- ---------------------------------------------------------------------------

create table work_orders (
  id                    uuid primary key default gen_random_uuid(),
  wo_number             text unique,               -- server-assigned, WO-{year}-{6 digits}
  plant_id              text references plants(id),
  asset_id              text not null references assets(id),
  asset_name            text,                      -- denormalized from assets.name
  department_id         text not null references departments(id),
  type                  si_wo_type,
  priority              si_priority not null,
  priority_touched      boolean not null default false,
  status                si_wo_status not null default 'open',
  impact                si_impact,
  est_downtime_value    numeric,
  est_downtime_unit     si_downtime_unit,
  description           text not null,
  safety_risk           jsonb not null default '{"flag": false, "severity": null}'::jsonb,
  environmental_risk    jsonb not null default '{"flag": false}'::jsonb,
  permit_required       boolean not null default false,
  requester_id          uuid not null references users(id),
  requester_name        text,                      -- denormalized
  requester_phone       text,
  assigned_to_id        uuid references users(id),
  assigned_to_name      text,                      -- denormalized
  sla_ack_due_at        timestamptz,               -- server-assigned
  sla_resolution_due_at timestamptz,               -- server-assigned
  sla_breached          boolean not null default false,
  sla_warning_sent      boolean not null default false,
  decline_count         int not null default 0,
  decline_reason        text,
  spare_part_reason     text,
  test_fail_reason      text,
  resolution_notes      text,
  resolved_at           timestamptz,
  reopen_reason         text,
  verified_by           uuid references users(id),
  verified_at           timestamptz,
  closed_at             timestamptz,
  client_uuid           text unique,               -- offline-create dedupe key
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Immutable audit trail. One row per status transition. Immutability is
-- enforced by RLS (0002) rather than by a rule comment, and by the absence of
-- any UPDATE/DELETE grant for every role including admin.
create table work_order_history (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  from_status   si_wo_status,
  to_status     si_wo_status not null,
  actor_id      uuid not null references users(id),
  actor_name    text,
  actor_role    si_role,                           -- captured at write time
  remarks       text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- POLYMORPHIC ATTACHMENTS + COMMENTS (entity_type + entity_id)
-- ---------------------------------------------------------------------------

create table attachments (
  id               uuid primary key default gen_random_uuid(),
  entity_type      si_entity_type not null,
  entity_id        uuid not null,
  file_url         text not null,
  storage_path     text,                           -- object key inside the bucket
  file_type        si_file_type not null default 'photo',
  file_size_bytes  bigint,
  uploaded_by_id   uuid not null references users(id),
  uploaded_by_role si_role,
  uploaded_at      timestamptz not null default now()
);

create table comments (
  id          uuid primary key default gen_random_uuid(),
  entity_type si_entity_type not null,
  entity_id   uuid not null,
  author_id   uuid not null references users(id),
  author_name text,
  author_role si_role,
  text        text not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS — written only by triggers (0003); clients may flip status
-- to 'read' on their own rows and nothing else.
-- ---------------------------------------------------------------------------

create table notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid not null references users(id) on delete cascade,
  recipient_role si_role,
  entity_type    si_entity_type not null default 'work_order',
  entity_id      uuid not null,
  entity_label   text,                             -- denormalized, e.g. wo_number
  type           text not null,                    -- submitted, needs_assignment, ...
  title          text not null,
  body           text,
  status         si_notif_status not null default 'sent',
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- SYSTEM TABLES
-- ---------------------------------------------------------------------------

-- Two rows: dashboard_cards and dashboard_charts. jsonb keeps each payload's
-- exact shape so src/lib/dashboard.js needs no reshaping.
create table stats (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Sequence source for wo_number. No client access in either direction at any
-- role, including admin — enforced by RLS with no policies at all (0002).
create table counters (
  id         text primary key,                     -- WO-{year}
  last_value bigint not null default 0
);

create table apk_builds (
  id                        text primary key,      -- {build_type}-{version_name}-{version_code}
  application_id            text not null,
  version_name              text not null,
  version_code              int not null,
  build_type                si_build_type not null,
  web_build_id              text,
  git_sha                   text,
  git_branch                text,
  apk_path                  text,
  apk_size_bytes            bigint,
  apk_sha256                text,
  download_url              text,
  release_notes             text,
  released                  boolean not null default false,
  min_supported_version_code int,
  built_at                  timestamptz not null default now(),
  built_by                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- INDEXES — ported from firestore.indexes.json. Postgres does not need a
-- composite index for every filter+sort combination the way Firestore does
-- (it can combine single-column indexes and sort in memory), so the 16
-- Firestore indexes collapse to the smaller set that actually earns its keep
-- against the queries in src/lib/.
-- ---------------------------------------------------------------------------

create index work_orders_requester_created_idx   on work_orders (requester_id, created_at desc);
create index work_orders_assignee_created_idx    on work_orders (assigned_to_id, created_at desc);
create index work_orders_department_created_idx  on work_orders (department_id, created_at desc);
create index work_orders_created_idx             on work_orders (created_at desc);
create index work_orders_status_idx              on work_orders (status);
create index work_orders_sla_sweep_idx           on work_orders (sla_breached, sla_resolution_due_at)
                                                    where status <> 'closed';
create index work_orders_sla_warning_idx         on work_orders (sla_warning_sent)
                                                    where status <> 'closed' and sla_warning_sent = false;

create index wo_history_wo_created_idx           on work_order_history (work_order_id, created_at asc);
create index wo_history_actor_created_idx        on work_order_history (actor_id, created_at desc);
create index wo_history_to_status_idx            on work_order_history (to_status);

create index notifications_recipient_created_idx on notifications (recipient_id, created_at desc);
create index comments_entity_idx                 on comments (entity_type, entity_id, created_at asc);
create index attachments_entity_idx              on attachments (entity_type, entity_id, uploaded_at desc);
create index users_role_department_idx           on users (role, department_id);
create index apk_builds_lookup_idx               on apk_builds (released, build_type, version_code desc);
create index apk_builds_app_version_idx          on apk_builds (application_id, version_code desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance — Firestore had every writer pass serverTimestamp()
-- by hand, which meant any missed call silently left a stale value. A trigger
-- makes it structural instead.
-- ---------------------------------------------------------------------------

create or replace function si_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_departments  before update on departments  for each row execute function si_touch_updated_at();
create trigger touch_priorities   before update on priorities   for each row execute function si_touch_updated_at();
create trigger touch_sla          before update on sla          for each row execute function si_touch_updated_at();
create trigger touch_users        before update on users        for each row execute function si_touch_updated_at();
create trigger touch_technicians  before update on technicians  for each row execute function si_touch_updated_at();
create trigger touch_assets       before update on assets       for each row execute function si_touch_updated_at();
create trigger touch_work_orders  before update on work_orders  for each row execute function si_touch_updated_at();
create trigger touch_apk_builds   before update on apk_builds   for each row execute function si_touch_updated_at();
