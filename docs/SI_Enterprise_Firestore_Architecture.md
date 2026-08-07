# SI — Service Inside
## Enterprise Firestore Database Architecture
**Version 1.0 · July 23, 2026 · Database design only — no frontend, no backend code**
**Scope:** the whole system, not one module. Designed for scale across multiple plants, thousands of assets, and continuous work order volume.

---

## 1. Collections

### 1.1 Main Collections (as specified)

```
/users/{userId}
/departments/{departmentId}
/assets/{assetId}
/work_orders/{workOrderId}
/work_order_history/{historyId}
/technicians/{technicianId}
/notifications/{notificationId}
/attachments/{attachmentId}
/priorities/{priorityId}
/sla/{slaId}
/comments/{commentId}
```

All eleven are **top-level**, not nested. This is a deliberate departure from a subcollection-heavy design, and it's the single biggest architectural decision in this document — see 1.3 for why.

### 1.2 Supporting Collections (implied by the main eleven, not separately requested but required for referential completeness)

```
/plants/{plantId}
/counters/{counterId}
```

`plants` exists because `department_id`, `asset`, and `work_order` documents all need something to scope to; `counters` exists because human-readable sequence numbers (work order numbers, asset tags) need an atomic, race-safe source. Neither is optional in practice — they're kept out of the "main" count only because you didn't list them.

### 1.3 Why Flat, Not Nested

An earlier, module-scoped version of this system nested `statusHistory`, `progressLog`, and `attachments` under `/work_orders/{id}/...`. At enterprise scale, across multiple modules (not just work orders — assets, PM schedules, and inventory will all eventually want history and attachments too), that pattern breaks down for three reasons:

1. **Reusability.** A flat `attachments` collection with an `entity_type` + `entity_id` pair can serve work orders, assets, and any future module without redefining the collection each time. A subcollection can't be reused across parents.
2. **Cross-entity querying.** "Show every attachment uploaded by this technician across every work order this month" is a single flat query with the right composite index. The equivalent against nested subcollections requires a collection-group query that still can't filter by parent type at all — every subcollection named `attachments` anywhere in the database would be in scope, asset attachments included, with no way to exclude them at the index level.
3. **Consistent security rules.** One rule block per flat collection, instead of one per nesting path per parent collection, multiplied across every module that wants the same "history" or "comments" behavior.

The trade-off: a flat design needs `entity_type`/`entity_id` on every document and loses the automatic scoping a subcollection path gives for free (you must always filter, never just "list this work order's attachments" implicitly). Section 6 and Section 10 both address how the index and security-rule design absorb that cost.

---

## 2. Documents

| Collection | Document represents | Typical volume driver |
|---|---|---|
| `users` | One person with system access, any role | Grows with headcount |
| `departments` | One organizational unit within a plant | Small, stable |
| `assets` | One piece of equipment | Grows with plant expansion; largest stable-ish collection |
| `work_orders` | One maintenance request, start to finish | Highest-velocity collection in the system |
| `work_order_history` | One status transition on one work order | Several per work order; highest absolute volume over time |
| `technicians` | One technician's operational profile (skills, load, availability) | 1:1 with the subset of `users` who hold the Technician role |
| `notifications` | One notification sent to one recipient | High volume, short-lived relevance |
| `attachments` | One uploaded file's metadata (photo, video, document) | Grows with usage across every module |
| `priorities` | One priority level definition (P1–P4) | Fixed, tiny — effectively configuration |
| `sla` | One SLA target definition, per priority (and optionally per plant) | Fixed, tiny — configuration |
| `comments` | One threaded comment on any entity | Moderate volume, grows with collaboration |

---

## 3. Fields

### 3.1 `users/{userId}`
Document ID = the Firebase Auth UID (see Section 9).

| Field | Type |
|---|---|
| name | string |
| email | string |
| phone | string |
| role | string (enum: `requester`, `technician`, `supervisor`, `hod`, `admin`) |
| department_id | string (ref → departments) |
| plant_ids | array\<string\> (ref → plants) |
| photo_url | string, nullable |
| status | string (enum: `active`, `inactive`) |
| created_at | timestamp |
| updated_at | timestamp |
| last_login_at | timestamp, nullable |

### 3.2 `departments/{departmentId}`

| Field | Type |
|---|---|
| name | string |
| code | string (unique business key, e.g. `MACH`) |
| plant_id | string (ref → plants) |
| manager_id | string, nullable (ref → users) |
| created_at | timestamp |
| updated_at | timestamp |

### 3.3 `assets/{assetId}`

| Field | Type |
|---|---|
| asset_code | string (unique business key, e.g. `AST-0412`) |
| name | string |
| category | string |
| department_id | string (ref → departments) |
| plant_id | string (ref → plants) |
| criticality | string (enum: `high`, `medium`, `low`) |
| status | string (enum: `active`, `under_maintenance`, `decommissioned`, `disposed`) |
| manufacturer | string, nullable |
| model | string, nullable |
| serial_number | string, nullable |
| install_date | timestamp, nullable |
| warranty_expiry | timestamp, nullable |
| meter_reading | number, nullable |
| meter_unit | string, nullable |
| qr_code | string, nullable |
| photo_url | string, nullable |
| created_at | timestamp |
| updated_at | timestamp |

### 3.4 `work_orders/{workOrderId}`

| Field | Type |
|---|---|
| wo_number | string (business key, e.g. `WO-2026-000004`) |
| plant_id | string (ref → plants) |
| asset_id | string (ref → assets) |
| asset_name | string (denormalized) |
| department_id | string (ref → departments) |
| type | string (enum: `breakdown`, `inspection`, `project`) |
| priority_id | string (ref → priorities) |
| priority_touched | boolean — true if manually overridden from the system suggestion |
| status | string (enum — full list in Section 5's relationship note; 11 values) |
| impact | string (enum: `full_stoppage`, `reduced_capacity`, `auxiliary`, `none`) |
| est_downtime_value | number |
| est_downtime_unit | string (enum: `hours`, `days`) |
| description | string |
| safety_risk | map `{ flag: boolean, severity: string|null }` |
| environmental_risk | map `{ flag: boolean }` |
| permit_required | boolean |
| requester_id | string (ref → users) |
| requester_name | string (denormalized) |
| requester_phone | string |
| assigned_to_id | string, nullable (ref → technicians) |
| assigned_to_name | string, nullable (denormalized) |
| sla_id | string, nullable (ref → sla) |
| sla_ack_due_at | timestamp, nullable |
| sla_resolution_due_at | timestamp, nullable |
| sla_breached | boolean |
| decline_count | number |
| decline_reason | string, nullable |
| spare_part_reason | string, nullable |
| test_fail_reason | string, nullable |
| resolution_notes | string, nullable |
| resolved_at | timestamp, nullable |
| reopen_reason | string, nullable |
| verified_by | string, nullable (ref → users) |
| verified_at | timestamp, nullable |
| closed_at | timestamp, nullable |
| client_uuid | string — offline-create dedupe key |
| created_at | timestamp |
| updated_at | timestamp |

### 3.5 `work_order_history/{historyId}`

| Field | Type |
|---|---|
| work_order_id | string (ref → work_orders) |
| from_status | string, nullable |
| to_status | string |
| actor_id | string (ref → users) |
| actor_name | string (denormalized) |
| actor_role | string — captured at write time, not derived later |
| remarks | string, nullable |
| created_at | timestamp |

### 3.6 `technicians/{technicianId}`
Document ID = the same value as the corresponding `users` document's ID — a deliberate 1:1 profile extension, not an independent entity (see Section 9).

| Field | Type |
|---|---|
| user_id | string (ref → users; redundant with the doc ID, kept for query clarity) |
| skills | array\<string\> |
| certifications | array\<string\> |
| current_load | number — cached count of active work orders, maintained by the system, not hand-edited |
| availability_status | string (enum: `available`, `busy`, `on_leave`) |
| plant_ids | array\<string\> (ref → plants) |
| created_at | timestamp |
| updated_at | timestamp |

### 3.7 `notifications/{notificationId}`

| Field | Type |
|---|---|
| recipient_id | string (ref → users) |
| recipient_role | string (denormalized) |
| entity_type | string (e.g. `work_order`) |
| entity_id | string |
| entity_label | string (denormalized, e.g. the wo_number, for display without a second read) |
| type | string (enum, e.g. `needs_assignment`, `assigned`, `declined`, `completed`, `reopened`, `sla_breach`) |
| title | string |
| body | string |
| status | string (enum: `sent`, `read`) |
| created_at | timestamp |

### 3.8 `attachments/{attachmentId}`

| Field | Type |
|---|---|
| entity_type | string (e.g. `work_order`, `asset`, `comment`) |
| entity_id | string |
| file_url | string |
| file_type | string (enum: `photo`, `video`, `document`) |
| file_size_bytes | number |
| uploaded_by_id | string (ref → users) |
| uploaded_by_role | string (denormalized) |
| uploaded_at | timestamp |

### 3.9 `priorities/{priorityId}`
Document ID = the priority code itself (`P1`, `P2`, `P3`, `P4`) — see Section 9.

| Field | Type |
|---|---|
| code | string — redundant with doc ID, kept for query clarity |
| label | string, e.g. "Critical" |
| color_hex | string |
| rank | number — 1 is most severe |
| description | string |
| created_at | timestamp |
| updated_at | timestamp |

### 3.10 `sla/{slaId}`
Document ID pattern: `{priority_code}` for a global default, or `{plant_id}_{priority_code}` for a plant-specific override — see Section 9.

| Field | Type |
|---|---|
| priority_id | string (ref → priorities) |
| plant_id | string, nullable — null means "global default" |
| ack_target_minutes | number |
| resolution_target_minutes | number |
| resolution_target_label | string, e.g. "5 business days" (for targets too irregular to express cleanly in minutes) |
| created_at | timestamp |
| updated_at | timestamp |

### 3.11 `comments/{commentId}`

| Field | Type |
|---|---|
| entity_type | string |
| entity_id | string |
| author_id | string (ref → users) |
| author_name | string (denormalized) |
| author_role | string (denormalized) |
| text | string |
| created_at | timestamp |
| edited_at | timestamp, nullable |

### 3.12 Supporting: `plants/{plantId}`

| Field | Type |
|---|---|
| name | string |
| code | string — redundant with doc ID, kept for query clarity |
| address | map `{ line1, city, state, country }` |
| timezone | string (IANA) |
| status | string (enum: `active`, `inactive`) |
| created_at | timestamp |

### 3.13 Supporting: `counters/{counterId}`

| Field | Type |
|---|---|
| last_value | number |

---

## 4. Data Types

Firestore's native type system is deliberately kept small in this schema — six types cover everything:

| Type | Used for | Why |
|---|---|---|
| `string` | Names, codes, enum values, IDs | Enum fields (`role`, `status`, `type`, `criticality`, etc.) are stored as lowercase snake_case strings, not numbers — a status value should be legible in the Firestore console without a lookup table. |
| `number` | Counts, durations, monetary-adjacent values, rank | No distinction is made between integer and float at the schema level — Firestore stores both as a single numeric type; document comments call out where a value is conceptually integer-only (e.g., `current_load`, `rank`). |
| `boolean` | Binary flags | Always named to read naturally in an `if` — `permit_required`, `sla_breached`, never a double-negative like `not_verified`. |
| `timestamp` | Every date/time value, without exception | Never stored as a string. This is non-negotiable — a string date cannot be range-queried or correctly sorted across timezones. |
| `map` | Small, always-together nested structures | Used only where the nested fields have no independent query need of their own — `safety_risk`, `environmental_risk`, `address`. If a nested value ever needs its own composite index, it should be promoted to a top-level field, not left buried in a map. |
| `array<string>` | Multi-value memberships | `plant_ids`, `skills`, `certifications`. Kept short by design — see Section 10 on unbounded array growth. |

**Deliberately not used:** Firestore's native `reference` type. Every relationship in this schema (Section 5) is a plain `string` holding another document's ID, not a Firestore `DocumentReference`. Reasons:
- Plain ID strings survive serialization to JSON, logs, and analytics exports without special handling; a `DocumentReference` does not.
- Security rules and indexes work identically either way, so there's no capability lost.
- A stored `DocumentReference` implicitly points at one specific database and collection path; a string ID doesn't carry that coupling, which matters if a collection is ever restructured or exported.

**Also not used:** `geopoint`. No requirement in this system currently needs geographic coordinates; if plant or asset location-mapping is added later, it should be introduced deliberately with its own indexing consideration, not added preemptively.

---

## 5. Relationships

| From | Field | To | Cardinality |
|---|---|---|---|
| users | department_id | departments | many → 1 |
| users | plant_ids | plants | many → many |
| departments | plant_id | plants | many → 1 |
| departments | manager_id | users | many → 1 |
| assets | department_id | departments | many → 1 |
| assets | plant_id | plants | many → 1 |
| work_orders | plant_id | plants | many → 1 |
| work_orders | asset_id | assets | many → 1 |
| work_orders | department_id | departments | many → 1 |
| work_orders | priority_id | priorities | many → 1 |
| work_orders | sla_id | sla | many → 1 |
| work_orders | requester_id | users | many → 1 |
| work_orders | assigned_to_id | technicians | many → 1 (nullable) |
| work_orders | verified_by | users | many → 1 (nullable) |
| work_order_history | work_order_id | work_orders | many → 1 |
| work_order_history | actor_id | users | many → 1 |
| technicians | user_id | users | 1 → 1 |
| technicians | plant_ids | plants | many → many |
| notifications | recipient_id | users | many → 1 |
| notifications | entity_id + entity_type | (polymorphic — work_orders today, others later) | many → 1 |
| attachments | entity_id + entity_type | (polymorphic) | many → 1 |
| attachments | uploaded_by_id | users | many → 1 |
| comments | entity_id + entity_type | (polymorphic) | many → 1 |
| comments | author_id | users | many → 1 |
| sla | priority_id | priorities | many → 1 |
| sla | plant_id | plants | many → 1 (nullable = global) |

No relationship above is enforced by Firestore itself — there is no foreign key constraint mechanism in this database. Every one of these is enforced entirely by security rules (Section 7) and, where a write spans multiple documents, by Cloud Functions maintaining consistency (e.g., recomputing `technicians.current_load` when a work order is assigned or closed) — that enforcement layer is out of scope for this document since it is backend code.

**Polymorphic relationships** (`entity_type` + `entity_id` pairs on `notifications`, `attachments`, `comments`) are the one relationship shape that looks different from the rest: the "to" side isn't fixed to one collection. `entity_type` values in use today: `work_order`, `asset`. This is what makes those three collections reusable across modules per Section 1.3 — the cost is that a query against them must always include both fields together, never `entity_id` alone (two work orders and an asset could theoretically share a numeric-looking ID coincidentally in different collections, so `entity_type` is not optional context, it's a required part of the filter).

---

## 6. Composite Indexes

| # | Collection | Fields (in order) | Serves |
|---|---|---|---|
| 1 | work_orders | requester_id ↑, created_at ↓ | A requester's own work order list |
| 2 | work_orders | assigned_to_id ↑, status ↑ | A technician's task list, incl. "needs response" filtering |
| 3 | work_orders | plant_id ↑, status ↑, priority_id ↑ | Plant-wide oversight lists, "needs assignment" banners |
| 4 | work_orders | plant_id ↑, sla_breached ↑, sla_resolution_due_at ↑ | SLA-risk sorted queues, breach dashboards |
| 5 | work_orders | asset_id ↑, created_at ↓ | An asset's maintenance history |
| 6 | work_order_history | work_order_id ↑, created_at ↑ | Rendering one work order's full timeline in order |
| 7 | work_order_history | actor_id ↑, created_at ↓ | A technician's or supervisor's activity feed, across every work order |
| 8 | notifications | recipient_id ↑, status ↑, created_at ↓ | A user's notification panel, unread-first |
| 9 | attachments | entity_type ↑, entity_id ↑, uploaded_at ↓ | Every attachment on one entity, newest first — required because this collection is polymorphic |
| 10 | comments | entity_type ↑, entity_id ↑, created_at ↑ | Every comment thread on one entity, in order |
| 11 | assets | plant_id ↑, department_id ↑, status ↑ | Asset register filtering within a plant |
| 12 | assets | plant_id ↑, criticality ↑ | Criticality-based asset views (e.g., "all High-criticality assets") |
| 13 | technicians | plant_ids (array-contains) ↑, availability_status ↑ | "Who's available in this plant right now" for assignment suggestions |
| 14 | sla | plant_id ↑, priority_id ↑ | Resolving the effective SLA for a given plant + priority (plant-specific override, falling back to global) |

Single-field equality/range filters are covered automatically by Firestore and are not listed. Every composite index above exists because a real screen or report filters on more than one field simultaneously — no index is speculative.

---

## 7. Security Rules

Described here as an access-control matrix, not as rules-language code, per instruction. Every row below is intended to be a direct, literal translation into whatever rules engine implements it — nothing here should require interpretation at implementation time.

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| users | Self, or any Supervisor/HOD/Admin in a shared plant | Admin only | Self (limited fields: name, phone, photo_url only), or Admin (any field) | Never — deactivate via `status`, don't delete |
| departments | Anyone signed in, within their plant | Admin only | Admin only | Never — deactivate, don't delete |
| assets | Anyone signed in, within their plant | Supervisor, HOD, Admin | Supervisor, HOD, Admin | Never — status → `decommissioned`/`disposed` instead |
| work_orders | Requester (own), Technician (assigned), Supervisor/HOD (plant-wide) | Any signed-in role, self as requester; Supervisor/HOD may create on behalf of another requester | Governed by the full status-transition matrix (see the companion Work Order FSD) — never a blanket "owner can edit anything" rule | Never |
| work_order_history | Same read scope as the parent work order | System-triggered only (written alongside the work order update, same request) | Never | Never |
| technicians | Anyone signed in, within a shared plant (needed for assignment UI) | Admin only, and only for a user whose role is `technician` | Self (availability_status only), Supervisor/HOD (skills, plant_ids), system-only (current_load) | Never |
| notifications | Recipient only | System-triggered only | Recipient only, and only the `status` field, and only to `read` | Never |
| attachments | Anyone who can read the parent entity | Anyone who can currently write to the parent entity | Never — an attachment's metadata is immutable once created | HOD/Admin only |
| comments | Anyone who can read the parent entity | Anyone who can read the parent entity | Author only, within a short edit window; must set `edited_at` | Author or HOD/Admin |
| priorities | Anyone signed in | Admin only | Admin only | Never — this is referenced by historical work orders; changing rank/color retroactively re-colors history, which is acceptable, but removing a priority is not |
| sla | Anyone signed in | Admin only | Admin only | Never, for the same historical-integrity reason as priorities |
| plants | Anyone signed in | Admin only | Admin only | Never |
| counters | No client access at all, either direction | System-triggered only | System-triggered only | Never |

**Cross-cutting rules that apply everywhere, not repeated per row above:**
- Every "Supervisor/HOD" scope above means *within a plant the user's own `plant_ids` includes* — never plant-unscoped, even for HOD.
- Every role check reads from the authenticated user's token claims, not from a live `users` document lookup, so authorization doesn't cost an extra read on every single request.
- No collection in this schema permits a blanket "update any field" rule for any non-Admin role — every update path is field-scoped, status-scoped, or both.

---

## 8. Naming Convention

| Element | Convention | Example |
|---|---|---|
| Collection names | Plural, snake_case | `work_orders`, `departments` — with one accepted exception: `sla` stays singular/uncountable, matching how the term is used in speech (nobody says "the slas") |
| Field names | snake_case | `requester_id`, `sla_breached` |
| Timestamp fields | Always suffixed `_at` | `created_at`, `resolved_at`, `verified_at` — never `_date` or `_time`, so every timestamp field is recognizable by pattern alone |
| Boolean fields | Named so `if (field)` reads naturally, never negated | `sla_breached`, `permit_required` — never `is_not_breached` or `not_required` |
| Reference fields | Always suffixed `_id`, holding a plain string, never the target collection's full path | `asset_id`, `assigned_to_id` |
| Enum values | Lowercase snake_case strings | `under_maintenance`, `needs_assignment` — chosen to be legible in the Firestore console without a decoder |
| Business keys vs. document IDs | Always separate fields | A work order's Firestore document ID is an opaque auto-ID; its human-facing identity lives in `wo_number`. Renaming or re-numbering the business key never requires moving the document. |
| Denormalized fields | Named identically to their source field, just inlined | `asset_name` on a work order mirrors `assets.name` exactly — no renaming across the copy, so a reader can tell at a glance that it's a cached copy of a specific field elsewhere. |

---

## 9. Auto-generated IDs

| Collection | ID strategy | Why |
|---|---|---|
| users | Firebase Auth UID (not a Firestore auto-ID) | The document must line up 1:1 with an authentication identity; using the UID directly makes that link structural, not just a stored field. |
| technicians | Same value as the corresponding `users` document's ID | This collection is a profile *extension* of a user, not an independent entity — giving it a different ID would let a technician profile silently drift from its user, or orphan, with nothing to catch it. |
| work_orders | Firestore auto-ID | High volume, no natural stable key at creation time before the counter transaction runs; the human-facing `wo_number` is assigned moments after creation by a separate process and stored as a field, not used as the document ID. |
| work_order_history | Firestore auto-ID | Extremely high volume, no natural key, never looked up by anything except `work_order_id` + time-ordering. |
| notifications | Firestore auto-ID | Same reasoning as history — high volume, always queried by recipient + time, never by a business key. |
| attachments | Firestore auto-ID | Same reasoning. |
| comments | Firestore auto-ID | Same reasoning. |
| departments | Firestore auto-ID, with a separate `code` field as the business key | Avoids coupling the document's identity to a code that might legitimately need to change (a department renaming its short code shouldn't require migrating every document that references it — though in practice `department_id` references the auto-ID, not the code, precisely so this never matters). |
| assets | Firestore auto-ID, with `asset_code` as the business key | Same reasoning as departments. |
| priorities | Custom ID = the priority code itself (`P1`, `P2`, `P3`, `P4`) | This is a small, fixed, rarely-changing set where the "ID" and the "business meaning" are the same thing by design — a direct `get()` by known ID is more efficient than a query, and there is no realistic scenario where a priority's code changes without it being effectively a new priority. |
| sla | Custom ID = `{priority_code}` (global) or `{plant_id}_{priority_code}` (plant override) | Same reasoning as priorities, plus this composite pattern lets a lookup resolve "the effective SLA for plant X, priority P2" as a direct two-attempt `get()` (try the plant-specific ID first, fall back to the global one) instead of a query, which matters because this lookup happens on every single work order creation. |
| plants | Custom ID, a short plant code (e.g. `PLT001`) | Referenced constantly across nearly every other collection; a short, stable, human-legible ID keeps every foreign-key-style field elsewhere in the schema readable without a join. |
| counters | Custom ID matching the sequence it counts (e.g. `WO-2026`) | The ID itself *is* the lookup key — there is nothing to query, only ever a direct transactional `get`/`set` by exact ID. |

**General principle:** auto-IDs are used for every high-volume, append-heavy collection where no field is naturally unique and stable at write time. Custom IDs are used only where the ID doubles as a genuinely meaningful, rarely-changing lookup key — never as a stylistic choice, and never for anything a user-facing rename could break.

---

## 10. Best Practices

### 10.1 Denormalization Is Deliberate, Not Accidental
Every denormalized field in this schema (`asset_name` on work orders, `requester_name`, `actor_name`, `entity_label` on notifications) exists to avoid a second read on a screen that's about to render a list. None of it is copied "just in case" — each one maps to a specific screen that would otherwise need an N+1 read pattern. A denormalized field is a commitment: if the source value changes, something must update every copy, which means every denormalized field needs an owner (a Cloud Function trigger) responsible for keeping it in sync. Denormalize only when you can also name that owner.

### 10.2 Avoid Hot Documents
`counters/{counterId}` is the one deliberate exception to "spread writes across many documents" — every work order creation in the same year contends for the same counter document. At the volume a single-plant deployment produces, this is fine (Firestore's transaction retry handles it transparently). At the scale of dozens of plants creating work orders simultaneously, this document becomes a throughput ceiling. The mitigation, if that scale is reached, is **sharded counters**: split `WO-2026` into `WO-2026-shard-0` through `WO-2026-shard-9`, write to a randomly chosen shard, and sum shards only when the total is actually needed (which, for a human-facing sequence number, it usually isn't — a slightly non-sequential but still-unique number is an acceptable trade for throughput). This schema does not implement sharding today because current volume doesn't need it, but the counter ID format was chosen to make adding a shard suffix later a non-breaking change.

### 10.3 Bound Every Array
`plant_ids`, `skills`, `certifications` are all arrays with a realistic, small, human-scale upper bound (a person belongs to a handful of plants, not hundreds). No array in this schema is allowed to grow with system usage over time — `assigned_to_id` is a single field, not an `assigned_to_ids` array, specifically so a work order's document size never grows across its lifecycle. If a future requirement needs a work order to have multiple simultaneous assignees, that should become its own top-level collection (`work_order_assignments`), not an array on the work order — the same reasoning that kept history and attachments flat applies here too.

### 10.4 Pagination
Every list-producing query in this schema should be paginated with a `startAfter`/`limit` cursor on the same field the composite index is sorted by — never an offset. Offset-based pagination in Firestore re-reads and discards every skipped document, which is a cost that grows with page number; cursor-based pagination costs the same regardless of how deep into a list you are.

### 10.5 Security Rules Should Never Cost a Read
Every role/permission check in Section 7 reads from the caller's authentication token claims, never from a live Firestore `get()` inside the rule itself. A rule that calls `get()` on another document to check a permission adds a real read to every single request evaluated against that rule, at scale, forever. Custom claims (role, plant_ids) are refreshed only when they actually change, not on every request.

### 10.6 Archival, Not Deletion
Nothing in this schema is ever deleted (Section 7's "Delete" column is `Never` almost everywhere on purpose). At scale, that means `work_order_history` and `notifications` grow without bound. The correct mitigation is not deletion — it's a scheduled export of anything older than a defined retention window (e.g., 24 months) to a cheaper, queryable-but-not-live store (BigQuery, via Firestore's built-in export), followed by removal from the hot collection only after the export is confirmed. This keeps the live database's working set small and fast without ever losing the historical record — it just moves where that record lives once it's no longer operationally relevant.

### 10.7 One Index Per Real Query, Not One Per Imagined Query
Every composite index in Section 6 is justified by a named screen or report. Composite indexes are not free — each one duplicates the data it covers and costs a write on every document that matches it. A schema this size should periodically audit its actual index list against Firestore's usage metrics and remove any index that isn't being hit, rather than accumulating indexes defensively.

### 10.8 Design for the Query, Not for the Object Model
Nowhere in this schema does a "clean" object-oriented instinct win over what a real screen needs to read efficiently — `technicians` exists as a separate collection from `users` specifically because technician-specific queries (availability, skills, load) are common and shouldn't require reading a bloated `users` document that also carries fields no query on technicians ever needs. The reverse is equally true: `work_order_history` and `attachments` are flat instead of nested specifically because the queries that need them cut across parents. Every structural choice in this document traces back to a query it makes cheap, not to what looks tidiest as a diagram.

---

This is the complete database architecture for SI — collections, documents, fields, data types, relationships, composite indexes, security-rule matrix, naming convention, ID strategy, and scalability practices. No frontend or backend code included, per your instruction.
