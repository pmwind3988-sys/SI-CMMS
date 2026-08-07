# SI — Service Inside
## Firestore Database Design — Work Order Management Module
**Version 1.2 · July 23, 2026 · Collections, Fields, Indexes, Relationships only — no code**
**Reflects the current 11-state workflow** (Open → Assigned → Accepted → On The Way → On Site → Repairing → Waiting Spare Part → Testing → Completed → Verified → Closed)

---

## 1. Collections

```
/workOrders/{woId}
    /statusHistory/{eventId}
    /progressLog/{entryId}
    /attachments/{attachmentId}

/notifications/{notificationId}
/counters/{counterId}

-- referenced only, owned by other modules --
/users/{uid}
```

| Collection | Kind | Why it's shaped this way |
|---|---|---|
| `workOrders` | Top-level | Not nested under a plant — a Technician's "assigned to me" query and a Requester's "my requests" query are then simple single-collection queries rather than collection-group queries across every plant. |
| `statusHistory` | Subcollection of `workOrders` | One small document per transition. Append-only, so the parent work order document never has to be rewritten as history accumulates. This is the record Work Order History renders directly. |
| `progressLog` | Subcollection of `workOrders` | Independent of `statusHistory` — a work order can sit in an active-work status for hours with many notes and zero status changes. |
| `attachments` | Subcollection of `workOrders` | One document per photo/video, each pointing at a Cloud Storage object rather than storing the file itself. |
| `notifications` | Top-level, keyed by recipient | A notification belongs with *who it's for*, not with the work order that caused it — a Supervisor's "needs assignment" notice has nothing to do with the work order document's own subcollections. |
| `counters` | Top-level | One document per calendar year, incremented transactionally to produce the human-readable `woNumber` as a single global sequence (not per-plant). |
| `users` | Top-level, external | Owned by a separate User Management module. Listed here only because `workOrders` references it by uid; this design does not redefine it. |

---

## 2. Fields

### 2.1 `/workOrders/{woId}`

| Field | Type | Notes |
|---|---|---|
| woNumber | string | `WO-{year}-{6-digit sequence}`, e.g. `WO-2026-000004` |
| plantId | string | Scoping |
| machineId | string | Reference → asset (external module) |
| machineName | string | Denormalized |
| department | string | |
| type | string | `Breakdown` \| `Inspection` \| `Project` |
| priority | string | `P1` \| `P2` \| `P3` \| `P4` |
| status | string | One of the 11 states — see companion FSD Section 9 for the full transition table |
| impact | string | `full_stoppage` \| `reduced_capacity` \| `auxiliary` \| `none` |
| estDowntimeValue | number | |
| estDowntimeUnit | string | `Hours` \| `Days` |
| description | string | The complaint, as submitted |
| safetyRisk | map | `{ flag: boolean, severity: "Low"\|"Medium"\|"High"\|null }` |
| environmentalRisk | map | `{ flag: boolean }` |
| permitRequired | boolean | Derived: true whenever `safetyRisk.flag` is true |
| requesterId | string (uid) | Indexed |
| requesterName | string | Denormalized |
| requesterPhone | string | |
| assignedToId | string (uid) \| null | Indexed |
| assignedToName | string \| null | Denormalized |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| slaAckDueAt | timestamp | Computed at creation from the SLA matrix for `priority` |
| slaResolutionDueAt | timestamp | Computed at creation |
| slaBreached | boolean | Set by a scheduled sweep; once true, stays true |
| declinedCount | number | Increments each time a Technician declines |
| resolutionNotes | string \| null | Set on `Testing → Completed` |
| resolvedAt | timestamp \| null | |
| verifiedBy | string (uid) \| null | |
| verifiedAt | timestamp \| null | |
| closedAt | timestamp \| null | |
| clientUuid | string | Offline-create dedupe key |

### 2.2 `/workOrders/{woId}/statusHistory/{eventId}`

| Field | Type | Notes |
|---|---|---|
| fromStatus | string \| null | `null` on the initial `Open` event |
| toStatus | string | |
| actorId | string (uid) | |
| actorName | string | Denormalized |
| actorRole | string | Captured at write time, not derived later |
| remarks | string \| null | e.g. "Assigned to Karan Mehta", "Test failed: still leaking" |
| timestamp | timestamp | |

### 2.3 `/workOrders/{woId}/progressLog/{entryId}`

| Field | Type | Notes |
|---|---|---|
| note | string | |
| actorId | string (uid) | Must equal the work order's current `assignedToId` |
| actorName | string | |
| timestamp | timestamp | |

### 2.4 `/workOrders/{woId}/attachments/{attachmentId}`

| Field | Type | Notes |
|---|---|---|
| fileUrl | string | Cloud Storage path |
| fileType | string | `photo` \| `video` |
| uploadedById | string (uid) | |
| uploadedByRole | string | |
| uploadedAt | timestamp | |

### 2.5 `/notifications/{notificationId}`

| Field | Type | Notes |
|---|---|---|
| recipientId | string (uid) | Indexed |
| recipientRole | string | Denormalized |
| woId | string | Reference → triggering work order |
| woNumber | string | Denormalized |
| type | string | `NeedsAssignment` \| `Assigned` \| `Declined` \| `Completed` \| `Reopened` \| `SLABreach` |
| title | string | |
| body | string | |
| status | string | `Sent` \| `Read` |
| createdAt | timestamp | Indexed |

### 2.6 `/counters/{counterId}`

| Field | Type | Notes |
|---|---|---|
| lastValue | number | `counterId` format: `WO-{year}` |

### 2.7 `/users/{uid}` — fields this module reads

| Field | Type | Used for |
|---|---|---|
| name | string | Denormalizing `requesterName` / `assignedToName` |
| role | string | Authorization context |
| phone | string | Defaulting `requesterPhone` |
| skills | array<string> | "Best match" technician suggestion |
| plantIds | array<string> | Scoping |

---

## 3. Indexes

Single-field equality/range queries are covered automatically by Firestore. The composite indexes below exist because a real screen filters on more than one field at once.

| # | Collection | Fields (in order) | Serves |
|---|---|---|---|
| 1 | `workOrders` | `requesterId` ↑, `createdAt` ↓ | Requester's "My Work Orders," default sort |
| 2 | `workOrders` | `requesterId` ↑, `status` ↑ | Requester's list filtered by status |
| 3 | `workOrders` | `assignedToId` ↑, `status` ↑ | Technician's "My Tasks," incl. "needs my response" filter |
| 4 | `workOrders` | `assignedToId` ↑, `createdAt` ↓ | Technician's list, default sort |
| 5 | `workOrders` | `plantId` ↑, `createdAt` ↓ | Supervisor/HOD's default plant-scoped list |
| 6 | `workOrders` | `plantId` ↑, `status` ↑, `priority` ↑ | Supervisor/HOD's list filtered by status+priority; the "needs assignment" banner |
| 7 | `workOrders` | `plantId` ↑, `status` ↑, `slaResolutionDueAt` ↑ | Sorting the assignment/response queue by urgency |
| 8 | `workOrders` | `slaBreached` ↑, `slaResolutionDueAt` ↑ | The scheduled SLA breach sweep |
| 9 | `notifications` | `recipientId` ↑, `status` ↑, `createdAt` ↓ | Each role's notification panel, unread-first |
| 10 | `statusHistory` (collection group) | `timestamp` ↓ | A cross-work-order audit view without knowing `woId` in advance |
| 11 | `progressLog` (collection group) | `actorId` ↑, `timestamp` ↓ | Cross-work-order technician activity, if ever needed |

---

## 4. Relationships

| From | Field | To | Cardinality |
|---|---|---|---|
| workOrders | requesterId | users | many → 1 |
| workOrders | assignedToId | users | many → 1 (nullable) |
| workOrders | machineId | assets (external module) | many → 1 |
| workOrders/statusHistory | actorId | users | many → 1 |
| workOrders/progressLog | actorId | users (must equal current `assignedToId`) | many → 1 |
| workOrders/attachments | uploadedById | users | many → 1 |
| notifications | woId | workOrders | many → 1 |
| notifications | recipientId | users | many → 1 |
| counters | (id only) | — | 1 → many, via transaction |

Every relationship above is a plain reference field — Firestore has no concept of a foreign key, so none of these are enforced by the database itself. (Enforcement is a separate concern from this design; it lives in security rules and Cloud Functions, out of scope for this document per your instruction.)

---

This is the complete Collections / Fields / Indexes / Relationships design for the Work Order Management module. No code included, per your instruction.
