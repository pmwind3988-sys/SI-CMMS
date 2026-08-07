/**
 * SI — Service Inside · Canonical Firestore Schema
 * ============================================================================
 * This file is the SINGLE SOURCE OF TRUTH for the database the APK reads.
 *
 * It was derived from the codebase itself, not hand-authored:
 *   - collection list + write permissions ......... firestore.rules
 *   - composite indexes ........................... firestore.indexes.json
 *   - work_order fields + SLA + status flow ....... src/lib/constants.js,
 *                                                   functions/index.js
 *   - reference-data rows ......................... src/lib/constants.js
 *                                                   (DEPARTMENTS, EQUIPMENT,
 *                                                    TECHNICIANS, SLA_MATRIX)
 *   - stats document shapes ....................... functions/index.js
 *                                                   (computeDashboardStats)
 *   - apk build identity .......................... capacitor.config.json,
 *                                                   android/app/build.gradle
 *
 * CommonJS on purpose: it is required by the Admin-SDK scripts and by the
 * MCP server, neither of which runs through the Next.js bundler.
 *
 * WHERE THE DOCS AND THE CODE DISAGREE, THIS FILE FOLLOWS THE CODE, because
 * the code is what the APK actually reads. Every such divergence is recorded
 * in DIVERGENCES at the bottom rather than silently resolved.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
   ENUMS — the literal values that appear in security rules and Auth claims.
   Lowercase snake_case throughout; these strings are load-bearing.
---------------------------------------------------------------------------- */

const ROLES = ["requester", "technician", "supervisor", "manager", "admin"];

const STATUS_FLOW = [
  "open",
  "assigned",
  "accepted",
  "on_the_way",
  "on_site",
  "repairing",
  "waiting_spare_part",
  "testing",
  "completed",
  "verified",
  "closed",
];

/** Statuses counted as "still in flight" by computeDashboardStats. */
const OPEN_STATUSES = [
  "open",
  "assigned",
  "accepted",
  "on_the_way",
  "on_site",
  "repairing",
  "waiting_spare_part",
  "testing",
];

/** Statuses counted as done by computeDashboardStats. */
const TERMINAL_STATUSES = ["completed", "verified", "closed"];

/**
 * The legal transition matrix, transcribed from firestore.rules. Each entry is
 * { from, to, roles, requires } where `requires` names fields the rules demand
 * be non-empty strings on the update. A transition absent from this table is
 * rejected by the rules for every role EXCEPT admin, who bypasses the matrix.
 */
const STATUS_TRANSITIONS = [
  { from: "open", to: "assigned", roles: ["supervisor", "manager", "admin"], requires: ["assigned_to_id"] },
  { from: "assigned", to: "assigned", roles: ["supervisor", "manager", "admin"], requires: ["assigned_to_id"] },
  { from: "assigned", to: "accepted", roles: ["technician", "manager", "admin"], requires: [] },
  { from: "assigned", to: "open", roles: ["technician", "manager", "admin"], requires: ["decline_reason"] },
  { from: "accepted", to: "on_the_way", roles: ["technician", "manager", "admin"], requires: [] },
  { from: "on_the_way", to: "on_site", roles: ["technician", "manager", "admin"], requires: [] },
  { from: "on_site", to: "repairing", roles: ["technician", "manager", "admin"], requires: [] },
  { from: "repairing", to: "waiting_spare_part", roles: ["technician", "manager", "admin"], requires: ["spare_part_reason"] },
  { from: "waiting_spare_part", to: "repairing", roles: ["technician", "manager", "admin"], requires: [] },
  { from: "repairing", to: "testing", roles: ["technician", "manager", "admin"], requires: [] },
  { from: "testing", to: "repairing", roles: ["technician", "manager", "admin"], requires: ["test_fail_reason"] },
  { from: "testing", to: "completed", roles: ["technician", "manager", "admin"], requires: ["resolution_notes"] },
  { from: "completed", to: "closed", roles: ["requester", "manager", "admin"], requires: ["verified_by"] },
  { from: "completed", to: "repairing", roles: ["requester", "manager", "admin"], requires: ["reopen_reason"] },
];

/**
 * Reassignment is legal mid-flight while a job is in any of these statuses:
 * status stays the same, only assigned_to_id changes. From firestore.rules
 * assignmentTransition(), second clause.
 */
const REASSIGNABLE_STATUSES = [
  "accepted",
  "on_the_way",
  "on_site",
  "repairing",
  "waiting_spare_part",
  "testing",
];

const PRIORITY_CODES = ["P1", "P2", "P3", "P4"];
const WORK_ORDER_TYPES = ["breakdown", "inspection", "project"];
const IMPACT_VALUES = ["full_stoppage", "reduced_capacity", "auxiliary", "none"];
const DOWNTIME_UNITS = ["hours", "days"];
const CRITICALITY = ["high", "medium", "low"];
const ASSET_STATUS = ["active", "under_maintenance", "decommissioned", "disposed"];
const USER_STATUS = ["active", "inactive"];
const AVAILABILITY_STATUS = ["available", "busy", "on_leave"];
const NOTIFICATION_STATUS = ["sent", "read"];
const FILE_TYPES = ["photo", "video", "document"];
const ENTITY_TYPES = ["work_order", "asset", "comment"];
const BUILD_TYPES = ["debug", "release"];

/* ---------------------------------------------------------------------------
   SLA — from src/lib/constants.js SLA_MATRIX and functions/index.js
   SLA_ACK_MS / SLA_RESOLUTION_MS. Both were already duplicated by hand across
   client and server; storing them in minutes here makes /sla the one place
   they live once seeded.
---------------------------------------------------------------------------- */

const SLA_TARGETS = {
  P1: { ack_target_minutes: 5, resolution_target_minutes: 240, resolution_target_label: "4 hrs", response_label: "15 min" },
  P2: { ack_target_minutes: 15, resolution_target_minutes: 480, resolution_target_label: "8 hrs", response_label: "1 hr" },
  P3: { ack_target_minutes: 30, resolution_target_minutes: 1440, resolution_target_label: "24 hrs", response_label: "4 hrs" },
  P4: { ack_target_minutes: 120, resolution_target_minutes: 7200, resolution_target_label: "5 business days", response_label: "24 hrs" },
};

const PRIORITY_META = {
  P1: { label: "Critical", color_hex: "#EF4444", rank: 1, description: "Full production stoppage or an active safety risk." },
  P2: { label: "High", color_hex: "#F59E0B", rank: 2, description: "Running at reduced capacity, or an environmental risk." },
  P3: { label: "Medium", color_hex: "#FBBF24", rank: 3, description: "Auxiliary equipment; no production line impact." },
  P4: { label: "Low", color_hex: "#0F3D91", rank: 4, description: "Cosmetic or routine; no production impact." },
};

/** Impact → suggested priority, from constants.js IMPACT_OPTIONS. */
const IMPACT_SUGGESTS = {
  full_stoppage: "P1",
  reduced_capacity: "P2",
  auxiliary: "P3",
  none: "P4",
};

/* ---------------------------------------------------------------------------
   APK IDENTITY — from capacitor.config.json and android/app/build.gradle.
   Read at seed/record time rather than duplicated, but the expected values
   are recorded here so drift is detectable.
---------------------------------------------------------------------------- */

const APP = {
  application_id: "com.serviceinside.cmms",
  app_name: "SI CMMS",
  web_dir: "out",
};

/* ---------------------------------------------------------------------------
   REFERENCE DATA — the rows currently hardcoded in src/lib/constants.js.
   Seeding these is what closes README open items #3 and #4: the app can then
   read /departments, /assets, /technicians, /priorities and /sla as real
   collections instead of importing frozen arrays.
---------------------------------------------------------------------------- */

const PLANT_ID = "PLT001";

const PLANTS = [
  {
    id: PLANT_ID,
    code: PLANT_ID,
    name: "Main Plant",
    address: { line1: "Plot 14, Industrial Estate", city: "Bengaluru", state: "Karnataka", country: "India" },
    timezone: "Asia/Kolkata",
    status: "active",
  },
];

/** From constants.js DEPARTMENTS. `code` is derived from the id suffix. */
const DEPARTMENTS = [
  { id: "DEPT-MACHINING", name: "Machining", code: "MACH" },
  { id: "DEPT-ASSEMBLY", name: "Assembly", code: "ASSY" },
  { id: "DEPT-PRESS", name: "Press Shop", code: "PRESS" },
  { id: "DEPT-UTILITIES", name: "Utilities", code: "UTIL" },
  { id: "DEPT-PACKAGING", name: "Packaging", code: "PACK" },
  { id: "DEPT-WAREHOUSE", name: "Warehouse", code: "WHSE" },
  { id: "DEPT-QUALITY", name: "Quality", code: "QUAL" },
];

/**
 * From constants.js EQUIPMENT. criticality is lowercased here to match the
 * architecture doc's enum (`high|medium|low`); constants.js uses Title Case.
 * See DIVERGENCES.criticality_case.
 */
const ASSETS = [
  { id: "AST-0412", name: "CNC Lathe #04", department_id: "DEPT-MACHINING", criticality: "high", category: "Machining" },
  { id: "AST-0288", name: "Conveyor B-2", department_id: "DEPT-ASSEMBLY", criticality: "medium", category: "Material Handling" },
  { id: "AST-0157", name: "Hydraulic Press 3", department_id: "DEPT-PRESS", criticality: "high", category: "Forming" },
  { id: "AST-0330", name: "Air Compressor 1", department_id: "DEPT-UTILITIES", criticality: "medium", category: "Utilities" },
  { id: "AST-0501", name: "Packaging Line C", department_id: "DEPT-PACKAGING", criticality: "medium", category: "Packaging" },
  { id: "AST-0099", name: "Overhead Crane 2", department_id: "DEPT-WAREHOUSE", criticality: "low", category: "Material Handling" },
  { id: "AST-0212", name: "Boiler Unit A", department_id: "DEPT-UTILITIES", criticality: "high", category: "Utilities" },
];

/**
 * From constants.js TECHNICIANS. `load` there becomes `current_load` here to
 * match the architecture doc; it is a system-maintained cache, so the seeded
 * value is a starting point only. See DIVERGENCES.technician_load_field.
 *
 * NOTE ON IDs: the architecture doc requires technicians/{id} to equal the
 * Firebase Auth UID of the matching user. The constants.js ids (`tech-arun`)
 * are placeholders that predate real Auth users. seedDatabase.js resolves
 * real UIDs by email where it can and falls back to these — see `auth_email`.
 */
const TECHNICIANS = [
  { id: "tech-arun", name: "Arun Kumar", auth_email: "tech.arun@example.com", skills: ["Mechanical", "Hydraulics"], current_load: 2 },
  { id: "tech-meera", name: "Meera Iyer", auth_email: "tech.meera@example.com", skills: ["Electrical", "PLC"], current_load: 4 },
  { id: "tech-sanjay", name: "Sanjay Rao", auth_email: "tech.sanjay@example.com", skills: ["Mechanical", "CNC"], current_load: 1 },
  { id: "tech-divya", name: "Divya Shah", auth_email: "tech.divya@example.com", skills: ["Utilities", "Boilers"], current_load: 3 },
  { id: "tech-karan", name: "Karan Mehta", auth_email: "tech.karan@example.com", skills: ["Electrical", "Conveyors"], current_load: 2 },
];

/* ---------------------------------------------------------------------------
   COLLECTIONS — field-level schema.

   Each field: { type, required?, nullable?, enum?, ref?, note? }
   type ∈ string | number | boolean | timestamp | map | array<string> | array<map>

   `writable` records who may write, transcribed from firestore.rules, so the
   MCP server and the skill can both refuse an impossible write before it is
   attempted rather than after Firestore rejects it.
---------------------------------------------------------------------------- */

const COLLECTIONS = {
  users: {
    docId: "Firebase Auth UID",
    description: "One profile document per Auth user. Role also lives in the Auth custom claim; the claim is authoritative for security rules, this doc is for display and queries.",
    readable: "self, supervisor, manager, admin",
    writable: { create: ["admin"], update: ["admin", "self (name/phone/photo_url/updated_at only)"], delete: ["admin"] },
    fields: {
      name: { type: "string", required: true },
      email: { type: "string", required: true },
      phone: { type: "string" },
      role: { type: "string", required: true, enum: ROLES },
      department_id: { type: "string", ref: "departments" },
      plant_ids: { type: "array<string>", ref: "plants" },
      photo_url: { type: "string", nullable: true },
      status: { type: "string", enum: USER_STATUS },
      created_at: { type: "timestamp" },
      updated_at: { type: "timestamp" },
      last_login_at: { type: "timestamp", nullable: true },
    },
  },

  departments: {
    docId: "DEPT-{NAME} — stable business key, not auto-generated",
    description: "Maintenance departments. Supervisor access is scoped to exactly one of these via the department_id Auth claim.",
    readable: "any signed-in user",
    writable: { create: ["manager", "admin"], update: ["manager", "admin"], delete: ["admin"] },
    fields: {
      name: { type: "string", required: true },
      code: { type: "string", required: true, note: "unique business key, e.g. MACH" },
      plant_id: { type: "string", ref: "plants" },
      manager_id: { type: "string", nullable: true, ref: "users" },
      created_at: { type: "timestamp" },
      updated_at: { type: "timestamp" },
    },
  },

  assets: {
    docId: "AST-{NNNN} — stable business key, printed on the physical asset tag",
    description: "Equipment a work order can be raised against.",
    readable: "any signed-in user",
    writable: { create: ["supervisor", "manager", "admin"], update: ["supervisor", "manager", "admin"], delete: ["admin"] },
    fields: {
      asset_code: { type: "string", required: true, note: "redundant with doc ID, kept for query clarity" },
      name: { type: "string", required: true },
      category: { type: "string" },
      department_id: { type: "string", required: true, ref: "departments" },
      plant_id: { type: "string", ref: "plants" },
      criticality: { type: "string", enum: CRITICALITY },
      status: { type: "string", enum: ASSET_STATUS },
      manufacturer: { type: "string", nullable: true },
      model: { type: "string", nullable: true },
      serial_number: { type: "string", nullable: true },
      install_date: { type: "timestamp", nullable: true },
      warranty_expiry: { type: "timestamp", nullable: true },
      meter_reading: { type: "number", nullable: true },
      meter_unit: { type: "string", nullable: true },
      qr_code: { type: "string", nullable: true },
      photo_url: { type: "string", nullable: true },
      created_at: { type: "timestamp" },
      updated_at: { type: "timestamp" },
    },
  },

  work_orders: {
    docId: "auto-generated; wo_number is the human-facing key",
    description: "The core entity. Created client-side with status 'open' and assigned_to_id null; onWorkOrderCreate then stamps wo_number and the SLA due timestamps.",
    readable: "own (requester) / assigned (technician) / same department (supervisor) / all (manager, admin)",
    writable: { create: ["any signed-in role, under their own identity"], update: ["per STATUS_TRANSITIONS; admin bypasses"], delete: ["admin"] },
    fields: {
      wo_number: { type: "string", note: "server-assigned by onWorkOrderCreate, WO-{year}-{6 digits}" },
      plant_id: { type: "string", ref: "plants" },
      asset_id: { type: "string", required: true, ref: "assets" },
      asset_name: { type: "string", note: "denormalized from assets.name" },
      department_id: { type: "string", required: true, ref: "departments" },
      type: { type: "string", enum: WORK_ORDER_TYPES },
      priority: { type: "string", required: true, enum: PRIORITY_CODES, note: "literal code, NOT a ref — see DIVERGENCES.priority_field" },
      priority_touched: { type: "boolean", note: "true if manually overridden from the system suggestion" },
      status: { type: "string", required: true, enum: STATUS_FLOW },
      impact: { type: "string", enum: IMPACT_VALUES },
      est_downtime_value: { type: "number" },
      est_downtime_unit: { type: "string", enum: DOWNTIME_UNITS },
      description: { type: "string", required: true },
      safety_risk: { type: "map", note: "{ flag: boolean, severity: string|null }" },
      environmental_risk: { type: "map", note: "{ flag: boolean }" },
      permit_required: { type: "boolean" },
      requester_id: { type: "string", required: true, ref: "users" },
      requester_name: { type: "string", note: "denormalized" },
      requester_phone: { type: "string" },
      assigned_to_id: { type: "string", nullable: true, ref: "technicians", note: "MUST be null on create — the rules enforce it" },
      assigned_to_name: { type: "string", nullable: true, note: "denormalized" },
      sla_ack_due_at: { type: "timestamp", nullable: true, note: "server-assigned" },
      sla_resolution_due_at: { type: "timestamp", nullable: true, note: "server-assigned" },
      sla_breached: { type: "boolean", note: "set by the scheduled SLA sweep" },
      sla_warning_sent: { type: "boolean", note: "set by the scheduled SLA warning sweep" },
      decline_count: { type: "number" },
      decline_reason: { type: "string", nullable: true },
      spare_part_reason: { type: "string", nullable: true },
      test_fail_reason: { type: "string", nullable: true },
      resolution_notes: { type: "string", nullable: true },
      resolved_at: { type: "timestamp", nullable: true },
      reopen_reason: { type: "string", nullable: true },
      verified_by: { type: "string", nullable: true, ref: "users" },
      verified_at: { type: "timestamp", nullable: true },
      closed_at: { type: "timestamp", nullable: true },
      client_uuid: { type: "string", note: "offline-create dedupe key" },
      created_at: { type: "timestamp" },
      updated_at: { type: "timestamp" },
    },
  },

  work_order_history: {
    docId: "auto-generated",
    description: "Immutable audit trail. One document per status transition. Top-level collection, not a subcollection.",
    readable: "mirrors the parent work order's read scope",
    writable: { create: ["any signed-in user, alongside the parent transition"], update: ["nobody, including admin"], delete: ["nobody, including admin"] },
    fields: {
      work_order_id: { type: "string", required: true, ref: "work_orders" },
      from_status: { type: "string", nullable: true, enum: STATUS_FLOW },
      to_status: { type: "string", required: true, enum: STATUS_FLOW },
      actor_id: { type: "string", required: true, ref: "users" },
      actor_name: { type: "string", note: "denormalized" },
      actor_role: { type: "string", enum: ROLES, note: "captured at write time, never derived later" },
      remarks: { type: "string", nullable: true },
      created_at: { type: "timestamp", required: true },
    },
  },

  technicians: {
    docId: "same value as the matching users doc ID (the Auth UID) — a 1:1 profile extension",
    description: "Technician-specific profile fields. Readable system-wide because the assignment UI needs the full roster.",
    readable: "any signed-in user",
    writable: { create: ["admin"], update: ["admin", "manager", "supervisor", "self (availability_status/updated_at only)"], delete: ["admin"] },
    fields: {
      user_id: { type: "string", required: true, ref: "users", note: "redundant with doc ID, kept for query clarity" },
      name: { type: "string", note: "denormalized from users.name for the assignment picker" },
      skills: { type: "array<string>" },
      certifications: { type: "array<string>" },
      current_load: { type: "number", note: "cached count of active work orders; system-maintained, not hand-edited" },
      availability_status: { type: "string", enum: AVAILABILITY_STATUS },
      plant_ids: { type: "array<string>", ref: "plants" },
      created_at: { type: "timestamp" },
      updated_at: { type: "timestamp" },
    },
  },

  notifications: {
    docId: "auto-generated",
    description: "Recipient-scoped. Written by Cloud Functions only; the client may flip status to 'read' on its own notifications and nothing else.",
    readable: "recipient only (plus admin)",
    writable: { create: ["cloud functions", "admin"], update: ["recipient, status→read only"], delete: ["admin"] },
    fields: {
      recipient_id: { type: "string", required: true, ref: "users" },
      recipient_role: { type: "string", nullable: true, enum: ROLES },
      entity_type: { type: "string", enum: ENTITY_TYPES },
      entity_id: { type: "string", required: true },
      entity_label: { type: "string", note: "denormalized, e.g. the wo_number, so the bell renders without a second read" },
      type: { type: "string", note: "e.g. submitted, needs_assignment, assigned, declined, completed, reopened, sla_warning, sla_breach" },
      title: { type: "string", required: true },
      body: { type: "string" },
      status: { type: "string", enum: NOTIFICATION_STATUS },
      created_at: { type: "timestamp", required: true },
    },
  },

  attachments: {
    docId: "auto-generated",
    description: "Polymorphic via entity_type + entity_id. Immutable once written.",
    readable: "any signed-in user",
    writable: { create: ["any signed-in user"], update: ["nobody"], delete: ["manager", "admin"] },
    fields: {
      entity_type: { type: "string", required: true, enum: ENTITY_TYPES },
      entity_id: { type: "string", required: true },
      file_url: { type: "string", required: true },
      file_type: { type: "string", enum: FILE_TYPES },
      file_size_bytes: { type: "number" },
      uploaded_by_id: { type: "string", required: true, ref: "users" },
      uploaded_by_role: { type: "string", enum: ROLES },
      uploaded_at: { type: "timestamp", required: true },
    },
  },

  comments: {
    docId: "auto-generated",
    description: "Polymorphic via entity_type + entity_id.",
    readable: "any signed-in user",
    writable: { create: ["any signed-in user"], update: ["author (text/edited_at only)", "admin"], delete: ["author", "manager", "admin"] },
    fields: {
      entity_type: { type: "string", required: true, enum: ENTITY_TYPES },
      entity_id: { type: "string", required: true },
      author_id: { type: "string", required: true, ref: "users" },
      author_name: { type: "string", note: "denormalized" },
      author_role: { type: "string", enum: ROLES },
      text: { type: "string", required: true },
      created_at: { type: "timestamp", required: true },
      edited_at: { type: "timestamp", nullable: true },
    },
  },

  priorities: {
    docId: "the priority code itself: P1 | P2 | P3 | P4",
    description: "Admin-configurable priority definitions. Never deleted — historical work orders reference them.",
    readable: "any signed-in user",
    writable: { create: ["admin"], update: ["admin"], delete: ["nobody"] },
    fields: {
      code: { type: "string", required: true, enum: PRIORITY_CODES, note: "redundant with doc ID" },
      label: { type: "string", required: true },
      color_hex: { type: "string" },
      rank: { type: "number", note: "1 is most severe" },
      description: { type: "string" },
      created_at: { type: "timestamp" },
      updated_at: { type: "timestamp" },
    },
  },

  sla: {
    docId: "{priority_code} for the global default, or {plant_id}_{priority_code} for a plant override",
    description: "SLA targets per priority. Currently duplicated in src/lib/constants.js SLA_MATRIX and functions/index.js; seeding this collection is what makes them genuinely configurable.",
    readable: "any signed-in user",
    writable: { create: ["admin"], update: ["admin"], delete: ["nobody"] },
    fields: {
      priority_id: { type: "string", required: true, ref: "priorities" },
      plant_id: { type: "string", nullable: true, ref: "plants", note: "null means global default" },
      ack_target_minutes: { type: "number", required: true },
      resolution_target_minutes: { type: "number", required: true },
      resolution_target_label: { type: "string", note: "for targets too irregular to express cleanly in minutes, e.g. '5 business days'" },
      created_at: { type: "timestamp" },
      updated_at: { type: "timestamp" },
    },
  },

  plants: {
    docId: "PLT{NNN} — stable business key",
    description: "Physical sites. plant_ids on the Auth claim scopes a user to one or more.",
    readable: "any signed-in user",
    writable: { create: ["admin"], update: ["admin"], delete: ["admin"] },
    fields: {
      name: { type: "string", required: true },
      code: { type: "string", note: "redundant with doc ID" },
      address: { type: "map", note: "{ line1, city, state, country }" },
      timezone: { type: "string", note: "IANA, e.g. Asia/Kolkata" },
      status: { type: "string", enum: USER_STATUS },
      created_at: { type: "timestamp" },
    },
  },

  stats: {
    docId: "dashboard_cards | dashboard_charts",
    description: "Precomputed dashboard aggregates. The client NEVER scans work_orders directly; it reads these two documents. Written only by computeDashboardStats in Cloud Functions.",
    readable: "any signed-in user",
    writable: { create: ["cloud functions only"], update: ["cloud functions only"], delete: ["nobody"] },
    documents: {
      dashboard_cards: {
        total_open: "number", p1_critical: "number", p2_high: "number", p3_medium: "number", p4_low: "number",
        completed_today: "number", overdue: "number", avg_response_minutes: "number", avg_repair_minutes: "number",
        active_technicians: "number", updated_at: "timestamp",
      },
      dashboard_charts: {
        monthly_work_orders: "array<{ month: string, count: number }> — last 12 months",
        department_breakdown: "array<{ department: string, count: number }> — sorted desc",
        machine_breakdown: "array<{ asset: string, count: number }> — top 10",
        technician_performance: "array<{ technician: string, completed: number, avg_repair_minutes: number }> — top 10",
        updated_at: "timestamp",
      },
    },
    fields: {},
  },

  counters: {
    docId: "WO-{year}, e.g. WO-2026",
    description: "Transactional sequence source for wo_number. NO CLIENT ACCESS in either direction, at any role, including admin — sequence integrity depends on this being server-only.",
    readable: "nobody",
    writable: { create: ["cloud functions only"], update: ["cloud functions only"], delete: ["nobody"] },
    fields: {
      last_value: { type: "number", required: true },
    },
  },

  /* -------------------------------------------------------------------------
     APK BUILD REGISTRY — new. Not part of the original 14; added so the
     installed APK can ask "is there a newer build, and am I too old to keep
     running?" without a separate backend.
  ------------------------------------------------------------------------- */
  apk_builds: {
    docId: "{build_type}-{version_name}-{version_code}, e.g. release-1.0-3",
    description: "One document per built APK. Written by scripts/recordApkBuild.js at build time (Admin SDK) or by an admin; read by every signed-in client to drive the update prompt.",
    readable: "any signed-in user",
    writable: { create: ["admin"], update: ["admin"], delete: ["admin"] },
    fields: {
      application_id: { type: "string", required: true, note: `must equal ${APP.application_id}` },
      version_name: { type: "string", required: true, note: "android/app/build.gradle versionName, e.g. '1.0'" },
      version_code: { type: "number", required: true, note: "android/app/build.gradle versionCode; monotonically increasing, the real ordering key" },
      build_type: { type: "string", required: true, enum: BUILD_TYPES },
      web_build_id: { type: "string", nullable: true, note: "contents of app/.next/BUILD_ID — ties the APK to the exact web bundle it embeds" },
      git_sha: { type: "string", nullable: true },
      git_branch: { type: "string", nullable: true },
      apk_path: { type: "string", nullable: true, note: "path relative to app/, e.g. android/app/build/outputs/apk/debug/app-debug.apk" },
      apk_size_bytes: { type: "number", nullable: true },
      apk_sha256: { type: "string", nullable: true, note: "integrity check for a sideloaded APK" },
      download_url: { type: "string", nullable: true, note: "null until the APK is actually hosted somewhere" },
      release_notes: { type: "string", nullable: true },
      released: { type: "boolean", required: true, note: "false = recorded but not offered to clients" },
      min_supported_version_code: { type: "number", nullable: true, note: "clients below this must force-update; null means no floor" },
      built_at: { type: "timestamp", required: true },
      built_by: { type: "string", nullable: true },
      created_at: { type: "timestamp" },
      updated_at: { type: "timestamp" },
    },
  },
};

/* ---------------------------------------------------------------------------
   COMPOSITE INDEXES required by apk_builds. The existing 14 live in
   firestore.indexes.json; these are the ones this registry adds.
---------------------------------------------------------------------------- */

const APK_BUILD_INDEXES = [
  {
    collectionGroup: "apk_builds",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "released", order: "ASCENDING" },
      { fieldPath: "build_type", order: "ASCENDING" },
      { fieldPath: "version_code", order: "DESCENDING" },
    ],
  },
  {
    collectionGroup: "apk_builds",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "application_id", order: "ASCENDING" },
      { fieldPath: "version_code", order: "DESCENDING" },
    ],
  },
];

/* ---------------------------------------------------------------------------
   DIVERGENCES — places the code and the docs disagree. Recorded, not silently
   resolved, because picking a side is a product decision and not mine to make.
   Each entry says which one this schema follows and what it would cost to
   switch. Read this before "fixing" any of them.
---------------------------------------------------------------------------- */

const DIVERGENCES = {
  priority_field: {
    code: "work_orders.priority — a literal code string, e.g. 'P2'. Written by seedDemoWorkOrder.js, read by functions/index.js (wo.priority) and by every dashboard aggregate.",
    doc: "SI_Enterprise_Firestore_Architecture.md §3.4 specifies priority_id (ref → priorities) plus sla_id (ref → sla).",
    followed: "code",
    why: "The running app and all four dashboard charts read wo.priority. Renaming it is a data migration plus a Cloud Functions change, not a schema annotation.",
  },
  role_hod_vs_manager: {
    code: "'manager' — in ROLES, in firestore.rules isManager(), in bootstrapUsers.js, and in the Auth custom claims.",
    doc: "SI_Enterprise_Firestore_Architecture.md §3.1 still lists 'hod' in the users.role enum.",
    followed: "code",
    why: "The doc is simply stale here; README and the rules both say manager. No migration needed — the doc's enum line is wrong.",
  },
  criticality_case: {
    code: "src/lib/constants.js EQUIPMENT uses Title Case: 'High' | 'Medium' | 'Low'.",
    doc: "§3.3 specifies lowercase: 'high' | 'medium' | 'low'.",
    followed: "doc",
    why: "Nothing in the app branches on this value today — it is display-only — so lowercase is free now and matches every other enum in the system. If any UI later compares it, compare case-insensitively.",
  },
  technician_load_field: {
    code: "src/lib/constants.js TECHNICIANS uses `load`.",
    doc: "§3.6 specifies `current_load`.",
    followed: "doc",
    why: "The constants array is a placeholder the README already flags for replacement (open item #3); the collection is the thing that survives.",
  },
  technician_doc_id: {
    code: "constants.js uses slugs: tech-arun, tech-meera, ... and seedDemoWorkOrder.js assigns assigned_to_id: 'tech-arun'.",
    doc: "§3.6 requires technicians/{id} == the matching Auth UID.",
    followed: "doc, with a fallback",
    why: "seedDatabase.js looks up each technician's Auth UID by auth_email and uses it when the user exists; otherwise it falls back to the slug so seeding still works on a bare emulator. Mixed IDs across those two paths are the one thing to watch when moving from emulator to a real project.",
  },
  supervisor_dashboard: {
    code: "stats/dashboard_cards and stats/dashboard_charts are single global documents.",
    doc: "README open item #1 wants department-scoped stats/dashboard_cards_{department_id} so Supervisor can have a dashboard without seeing system-wide numbers.",
    followed: "code",
    why: "Unbuilt work, explicitly flagged in the README. Seeding does not create the per-department documents because nothing writes or reads them yet.",
  },
};

module.exports = {
  ROLES,
  STATUS_FLOW,
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  STATUS_TRANSITIONS,
  REASSIGNABLE_STATUSES,
  PRIORITY_CODES,
  WORK_ORDER_TYPES,
  IMPACT_VALUES,
  IMPACT_SUGGESTS,
  DOWNTIME_UNITS,
  CRITICALITY,
  ASSET_STATUS,
  USER_STATUS,
  AVAILABILITY_STATUS,
  NOTIFICATION_STATUS,
  FILE_TYPES,
  ENTITY_TYPES,
  BUILD_TYPES,
  SLA_TARGETS,
  PRIORITY_META,
  APP,
  PLANT_ID,
  PLANTS,
  DEPARTMENTS,
  ASSETS,
  TECHNICIANS,
  COLLECTIONS,
  APK_BUILD_INDEXES,
  DIVERGENCES,
  COLLECTION_NAMES: Object.keys(COLLECTIONS),
};
