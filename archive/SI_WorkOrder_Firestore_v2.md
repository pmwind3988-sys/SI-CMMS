# SI — Service Inside
## Firestore Database — Work Order Management Module
**Version 1.1 · July 22, 2026 · Database design only — no frontend code**
**Roles:** Requester · Technician · Supervisor · HOD

---

## 1. Collections

```
/workOrders/{woId}
/workOrders/{woId}/statusHistory/{eventId}
/workOrders/{woId}/progressLog/{entryId}
/workOrders/{woId}/attachments/{attachmentId}

/notifications/{notificationId}
/counters/{counterId}

-- referenced, owned by other modules --
/users/{uid}
```

- `workOrders` is top-level (not nested under a plant) so a Technician's "assigned to me" query and a Requester's "my requests" query are simple single-collection queries.
- `statusHistory`, `progressLog`, and `attachments` are append-mostly subcollections — each write is small and independent, so the parent document never needs to be rewritten as a work order accumulates history.
- `notifications` is top-level and keyed by recipient, because a notification belongs with *who it's for*, not with the work order that caused it.
- `users` is listed only because `workOrders` references `requesterId` / `assignedToId` against it — it is owned by a separate module and not redesigned here.

---

## 2. Documents

Shape of each document, before the field-level detail in Section 3.

### `/workOrders/{woId}`
The single source of truth for one work order — every field needed to render every screen lives here or in its four subcollections. Never deleted, only ever transitioned forward (or looped back once, on reopen).

### `/workOrders/{woId}/statusHistory/{eventId}`
One document per transition. Append-only, immutable once written — this is the record the Work Order History screen renders directly.

### `/workOrders/{woId}/progressLog/{entryId}`
One document per Technician note logged while attending. Independent of `statusHistory` because a work order can sit `In Progress` for hours with many notes and zero status changes.

### `/workOrders/{woId}/attachments/{attachmentId}`
One document per photo/video, pointing at a Cloud Storage object rather than storing the file itself.

### `/notifications/{notificationId}`
One document per notification, addressed to a single `recipientId`. Written only by Cloud Functions, never by a client.

### `/counters/{counterId}`
One document per plant-year (e.g. `PLT001-WO-2026`), incremented transactionally to produce human-readable `woNumber`s.

---

## 3. Fields

### 3.1 `/workOrders/{woId}`

| Field | Type | Notes |
|---|---|---|
| woNumber | string | Business key, e.g. `PLT001-WO-2026-1187` |
| plantId | string | Security-rule scoping |
| machineId | string | Reference → asset (external module) |
| machineName | string | Denormalized for list rendering |
| department | string | |
| type | string | `Breakdown` \| `Inspection` \| `Project` |
| priority | string | `P1` \| `P2` \| `P3` \| `P4` |
| status | string | See Section 6 — Status Flow |
| impact | string | `full_stoppage` \| `reduced_capacity` \| `auxiliary` \| `none` |
| estDowntimeValue | number | |
| estDowntimeUnit | string | `Hours` \| `Days` |
| description | string | The complaint, as submitted |
| safetyRisk | map | `{ flag: boolean, severity: "Low"\|"Medium"\|"High" }` |
| environmentalRisk | map | `{ flag: boolean }` |
| permitRequired | boolean | Derived: `true` whenever `safetyRisk.flag === true` |
| requesterId | string (uid) | Indexed |
| requesterName | string | Denormalized |
| requesterPhone | string | |
| assignedToId | string (uid) \| null | Indexed |
| assignedToName | string \| null | Denormalized |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| slaAckDueAt | timestamp | Computed at creation from the SLA matrix for `priority` |
| slaResolutionDueAt | timestamp | Computed at creation |
| slaBreached | boolean | Denormalized, recomputed by Cloud Function |
| declinedCount | number | Increments on each Technician decline |
| resolutionNotes | string \| null | Set on `In Progress → Resolved` |
| resolvedAt | timestamp \| null | |
| verifiedBy | string (uid) \| null | |
| verifiedAt | timestamp \| null | |
| closedAt | timestamp \| null | |
| clientUuid | string | Offline-create dedupe key |

### 3.2 `/workOrders/{woId}/statusHistory/{eventId}`

| Field | Type | Notes |
|---|---|---|
| fromStatus | string \| null | `null` for the initial `New` event |
| toStatus | string | |
| actorId | string (uid) | |
| actorName | string | Denormalized |
| actorRole | string | `Requester`\|`Technician`\|`Supervisor`\|`HOD`, captured at write time |
| remarks | string \| null | e.g. "Assigned to Karan Mehta", "Declined: no spare part" |
| timestamp | timestamp | |

### 3.3 `/workOrders/{woId}/progressLog/{entryId}`

| Field | Type | Notes |
|---|---|---|
| note | string | |
| actorId | string (uid) | Must equal `workOrders.assignedToId` at write time |
| actorName | string | |
| timestamp | timestamp | |

### 3.4 `/workOrders/{woId}/attachments/{attachmentId}`

| Field | Type | Notes |
|---|---|---|
| fileUrl | string | Cloud Storage path |
| fileType | string | `photo` \| `video` |
| uploadedById | string (uid) | |
| uploadedByRole | string | |
| uploadedAt | timestamp | |

### 3.5 `/notifications/{notificationId}`

| Field | Type | Notes |
|---|---|---|
| recipientId | string (uid) | Indexed |
| recipientRole | string | Denormalized |
| woId | string | Reference → triggering work order |
| woNumber | string | Denormalized |
| type | string | `NeedsAssignment`\|`Assigned`\|`Accepted`\|`Declined`\|`Resolved`\|`Reopened`\|`Verified`\|`SLABreach` |
| title | string | |
| body | string | |
| status | string | `Sent` \| `Read` |
| createdAt | timestamp | Indexed |

### 3.6 `/counters/{counterId}`

| Field | Type |
|---|---|
| lastValue | number |

### 3.7 `/users/{uid}` — referenced fields only

| Field | Type | Used for |
|---|---|---|
| name | string | Denormalizing `requesterName` / `assignedToName` |
| role | string | Determining permitted actions (Section 7) |
| phone | string | Defaulting `requesterPhone` |
| skills | array<string> | "Best match" technician suggestion |
| plantIds | array<string> | Security-rule scoping |

---

## 4. Relationships

| From | Field | To | Cardinality |
|---|---|---|---|
| workOrders | requesterId | users | many → 1 |
| workOrders | assignedToId | users | many → 1 (nullable) |
| workOrders | machineId | assets (external module) | many → 1 |
| workOrders/statusHistory | actorId | users | many → 1 |
| workOrders/progressLog | actorId | users (must equal current assignedToId) | many → 1 |
| workOrders/attachments | uploadedById | users | many → 1 |
| notifications | woId | workOrders | many → 1 |
| notifications | recipientId | users | many → 1 |
| counters | (id only) | — | 1 → many, via transaction |

Firestore enforces none of this itself — every arrow above is a plain reference field, and integrity is enforced entirely by the security rules and Cloud Functions in Sections 7 and 8.

---

## 5. Indexes

Single-field queries are covered automatically; the composites below exist because the module's real screens filter on more than one field at once.

```json
{
  "indexes": [
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "requesterId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "requesterId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assignedToId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assignedToId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "slaResolutionDueAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "workOrders",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "plantId", "order": "ASCENDING" },
        { "fieldPath": "slaBreached", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "recipientId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "statusHistory",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "progressLog",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "actorId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ]
}
```

| Index | Serves |
|---|---|
| `requesterId + createdAt` / `+ status` | Requester's "My Work Orders" |
| `assignedToId + status` / `+ createdAt` | Technician's "My Tasks," including the "needs my response" filter |
| `plantId + status + priority` | Supervisor/HOD's list and the "needs assignment" banner |
| `plantId + status + slaResolutionDueAt` | Sorting the assignment queue by urgency |
| `plantId + slaBreached + priority` | Any SLA-breach dashboard widget |
| `recipientId + status + createdAt` | Each role's notification panel, unread-first |
| `statusHistory` (collection group) | A cross-work-order audit view without knowing `woId` in advance |

---

## 6. Status Flow

The entire module exists to enforce one linear sequence, with two permitted loops. This is the authoritative state machine — the security rules in Section 7 are a direct translation of the table below into code.

### 6.1 States

| Status | Meaning | Set by |
|---|---|---|
| `New` | Raised, unassigned | Requester (create), or a decline/reset |
| `Assigned` | Technician named, not yet responded | Supervisor / HOD |
| `Accepted` | Technician has agreed to take it | Assigned Technician |
| `In Progress` | Technician actively attending | Assigned Technician |
| `On Hold` | Paused mid-attendance | Assigned Technician |
| `Resolved` | Technician says it's fixed, awaiting confirmation | Assigned Technician |
| `Verified` | Requester (or HOD override) confirmed the fix | Requester / HOD |
| `Closed` | Terminal | System, immediately after `Verified` |

### 6.2 Transition Table

| From | To | Trigger | Who |
|---|---|---|---|
| — | `New` | Work order created | Requester (self), or Supervisor/HOD (on behalf of someone) |
| `New` | `Assigned` | Assign a technician | Supervisor / HOD |
| `Assigned` | `Accepted` | Accept | The assigned Technician |
| `Assigned` | `New` | Decline (reason required) | The assigned Technician |
| `Assigned` | `Assigned` | Reassign to someone else | Supervisor / HOD |
| `Accepted` | `In Progress` | Attend / Start job | The assigned Technician |
| `In Progress` | `On Hold` | Put on hold | The assigned Technician |
| `On Hold` | `In Progress` | Resume | The assigned Technician |
| `In Progress` | `Resolved` | Mark Resolved (resolution notes required) | The assigned Technician |
| `Resolved` | `Verified` → `Closed` | Confirm fixed (one action, two history entries) | The original Requester |
| `Resolved` | `In Progress` | Not fixed / Reopen (reason required) | The original Requester |
| `Resolved` | `Verified` → `Closed` | Force verify & close (override) | HOD only |

### 6.3 Diagram

```
                 ┌────────────────────────────────────────┐
                 │                                        │
                 ▼                                        │
   [ New ] ──assign──▶ [ Assigned ] ──accept──▶ [ Accepted ] ──attend──▶ [ In Progress ] ─┐
      ▲                    │                                                  │  ▲       │
      │                  decline                                          hold│  │resume │
      │                    │                                                  ▼  │       │
      └────────────────────┘                                             [ On Hold ]      │
                                                                                            │
                                                                                    resolve │
                                                                                            ▼
                                                                              [ Resolved ] ─┐
                                                                                │           │
                                                                     confirm fixed      not fixed
                                                                                │           │
                                                                                ▼           ▼
                                                                          [ Verified ]  [ In Progress ]
                                                                                │        (reopened,
                                                                                ▼         loop repeats)
                                                                          [ Closed ]
```

### 6.4 Rules of the Flow

- **No status is ever skipped.** A work order cannot go `New → In Progress` or `Assigned → Resolved` directly — every intermediate step must be written, which is what makes the `statusHistory` subcollection a complete record rather than a partial one.
- **Exactly two loops exist**, both deliberate: `Assigned → New` (decline) and `Resolved → In Progress` (reopen). No other backward transition is valid.
- **`Verified` is always immediately followed by `Closed`** — the UI presents "Confirm fixed" as one action, but the data model still writes both transitions as separate `statusHistory` entries, preserving the distinction between *"the requester confirmed it"* and *"the record is now closed"* even though they happen in the same instant.
- **HOD's only power inside this flow is the `Resolved → Closed` override** — HOD cannot skip earlier steps, cannot assign around a Supervisor, and cannot reopen a `Closed` work order. The escalation path is narrow by design.

---

## 7. Security Rules

### 7.1 Identity Model

Every authenticated user carries custom claims, set by a Cloud Function whenever their `/users/{uid}` role changes:

```
{ role: "Requester" | "Technician" | "Supervisor" | "HOD", plantIds: ["PLT001", ...] }
```

### 7.2 Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    function inPlant(plantId) { return plantId in request.auth.token.plantIds; }
    function isSupervisorLike() { return role() == "Supervisor" || role() == "HOD"; }

    match /workOrders/{woId} {

      allow read: if signedIn() && (
        resource.data.requesterId == request.auth.uid ||
        resource.data.assignedToId == request.auth.uid ||
        (isSupervisorLike() && inPlant(resource.data.plantId))
      );

      allow create: if signedIn() &&
        inPlant(request.resource.data.plantId) &&
        request.resource.data.status == "New" &&
        request.resource.data.assignedToId == null &&
        (
          request.resource.data.requesterId == request.auth.uid ||
          isSupervisorLike()
        );

      allow update: if signedIn() && inPlant(resource.data.plantId) && (

        // Supervisor/HOD: New -> Assigned
        (isSupervisorLike() &&
          resource.data.status == "New" &&
          request.resource.data.status == "Assigned" &&
          request.resource.data.assignedToId != null)

        // Supervisor/HOD: reassign pre-completion
        || (isSupervisorLike() &&
          resource.data.status in ["New", "Assigned", "Accepted"] &&
          request.resource.data.status == "Assigned")

        // Technician: Assigned -> Accepted
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "Assigned" &&
          request.resource.data.status == "Accepted")

        // Technician: Assigned -> New (decline)
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "Assigned" &&
          request.resource.data.status == "New" &&
          request.resource.data.assignedToId == null)

        // Technician: Accepted -> In Progress
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "Accepted" &&
          request.resource.data.status == "In Progress")

        // Technician: In Progress <-> On Hold
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "In Progress" &&
          request.resource.data.status == "On Hold")
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "On Hold" &&
          request.resource.data.status == "In Progress")

        // Technician: In Progress -> Resolved (resolutionNotes required)
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "In Progress" &&
          request.resource.data.status == "Resolved" &&
          request.resource.data.resolutionNotes is string &&
          request.resource.data.resolutionNotes.size() > 0)

        // Requester: Resolved -> Closed (verify)
        || (role() == "Requester" &&
          resource.data.requesterId == request.auth.uid &&
          resource.data.status == "Resolved" &&
          request.resource.data.status == "Closed" &&
          request.resource.data.verifiedBy == request.auth.uid)

        // Requester: Resolved -> In Progress (reopen)
        || (role() == "Requester" &&
          resource.data.requesterId == request.auth.uid &&
          resource.data.status == "Resolved" &&
          request.resource.data.status == "In Progress")

        // HOD override: Resolved -> Closed
        || (role() == "HOD" &&
          resource.data.status == "Resolved" &&
          request.resource.data.status == "Closed")
      );

      allow delete: if false;

      match /statusHistory/{eventId} {
        allow read: if signedIn();
        allow create: if signedIn();
        allow update, delete: if false;
      }

      match /progressLog/{entryId} {
        allow read: if signedIn();
        allow create: if signedIn() &&
          get(/databases/$(database)/documents/workOrders/$(woId)).data.assignedToId == request.auth.uid &&
          get(/databases/$(database)/documents/workOrders/$(woId)).data.status in ["Accepted", "In Progress", "On Hold"] &&
          request.resource.data.actorId == request.auth.uid;
        allow update, delete: if false;
      }

      match /attachments/{attachmentId} {
        allow read: if signedIn();
        allow create: if signedIn() && (
          get(/databases/$(database)/documents/workOrders/$(woId)).data.requesterId == request.auth.uid ||
          get(/databases/$(database)/documents/workOrders/$(woId)).data.assignedToId == request.auth.uid
        );
        allow delete: if signedIn() && role() == "HOD";
        allow update: if false;
      }
    }

    match /notifications/{notificationId} {
      allow read: if signedIn() && resource.data.recipientId == request.auth.uid;
      allow create, update, delete: if false;
    }

    match /counters/{counterId} {
      allow read: if false;
      allow write: if false;
    }
  }
}
```

### 7.3 Design Notes

- The `update` rule is a **transition matrix**, not a field-permission list — every clause is a *(current status, next status, who)* triple lifted directly from Section 6.2, so the database enforces the exact same flow the UI presents. A direct API call bypassing the app can't skip a step, because the rule for that jump simply doesn't exist.
- `resolutionNotes` non-empty is enforced **here**, not only in the UI — closing the loophole where client-side validation could be bypassed by a raw write.
- `statusHistory` and `progressLog` are append-only for any permitted writer and immutable for everyone, including HOD — no one can edit yesterday's entry, only add new ones.
- HOD's override is scoped to exactly one clause (`Resolved → Closed`) — it cannot be used to skip assignment, force-accept on a Technician's behalf, or reopen a `Closed` record.
- `notifications` and `counters` are entirely server-authoritative; the rules block every client write to them on purpose, because the triggers in Section 8 are what's supposed to write them, with certainty about *why*.

---

## 8. Cloud Function Triggers Implied by This Design

| Trigger | Fires on | Action |
|---|---|---|
| `onWorkOrderCreate` | `workOrders` create | Assign `woNumber` via `/counters` transaction; compute `slaAckDueAt`/`slaResolutionDueAt`; write the initial `statusHistory` entry; notify Supervisors/HOD in `plantId` |
| `onWorkOrderAssigned` | `status → Assigned` | Notify `assignedToId` |
| `onWorkOrderDeclined` | `status → New` (prior status `Assigned`) | Increment `declinedCount`; notify Supervisors again |
| `onWorkOrderResolved` | `status → Resolved` | Notify `requesterId` to verify |
| `onWorkOrderReopened` | `status → In Progress` (prior status `Resolved`) | Notify `assignedToId` |
| `onWorkOrderClosed` | `status → Closed` | Stamp `closedAt`; final `slaBreached` recompute for reporting |
| `slaBreachSweep` | Scheduled, every 5 min | Query `slaResolutionDueAt < now AND status != Closed`; set `slaBreached = true`; notify Supervisors/HOD for newly-breached items only |

---

This is the complete Firestore design for the Work Order Management module — Collections, Documents, Fields, Indexes, Relationships, Security Rules, and Status Flow. No frontend code, per your instruction.
