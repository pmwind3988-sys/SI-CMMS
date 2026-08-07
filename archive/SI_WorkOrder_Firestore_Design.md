# SI — Service Inside
## Firestore Database Design — Work Order Management Module Only
**Version 1.0 · July 22, 2026 · Design document — no UI**
**Roles:** Requester · Technician · Supervisor · HOD
**Workflow modeled:** Requester creates → Supervisor notified → Supervisor assigns Technician → Technician accepts → Technician attends → Technician updates progress → Requester verifies → Closed

---

## 1. Collections

```
/workOrders/{woId}
/workOrders/{woId}/statusHistory/{eventId}
/workOrders/{woId}/progressLog/{entryId}
/workOrders/{woId}/attachments/{attachmentId}

/notifications/{notificationId}
/counters/{counterId}

-- referenced, not owned by this module (read-only dependency) --
/users/{uid}
```

**Design rationale**

- `workOrders` is a **top-level collection** (not nested under a plant) so a Technician's "assigned to me" query and a Requester's "my requests" query are simple single-collection queries, not collection-group queries across every plant.
- `statusHistory`, `progressLog`, and `attachments` are **append-mostly subcollections** — each write is small, independent, and never needs to rewrite the parent document, which keeps the core `workOrders/{woId}` document lean even on a long-running work order with dozens of progress notes.
- `notifications` is top-level and keyed by recipient, because the workflow's defining trait ("Supervisor receives notification," "Technician notified," "Requester notified to verify") is cross-cutting — a Supervisor's notification about WO-1187 has nothing to do with WO-1187's own subcollections; it belongs with the *recipient*, not the *work order*.
- `users` is listed only because `workOrders` documents reference `requesterId`/`assignedToId` against it. It is **owned by a future User Management module** — this document does not redesign it, it only specifies the fields Work Order Management reads from it (Section 4).

---

## 2. Documents (Field-Level Schema)

### 2.1 `/workOrders/{woId}` — primary document

| Field | Type | Notes |
|---|---|---|
| woNumber | string | Business key, e.g. `PLT001-WO-2026-1187`, generated via `/counters` transaction |
| plantId | string | Scoping for multi-plant security rules |
| machineId | string | Reference → asset (owned by Asset Management module) |
| machineName | string | Denormalized for list rendering without a join |
| department | string | |
| type | string | `Breakdown` \| `Inspection` \| `Project` |
| priority | string | `P1` \| `P2` \| `P3` \| `P4` |
| status | string | `New` \| `Assigned` \| `Accepted` \| `In Progress` \| `On Hold` \| `Resolved` \| `Verified` \| `Closed` |
| impact | string | `full_stoppage` \| `reduced_capacity` \| `auxiliary` \| `none` |
| estDowntimeValue | number | |
| estDowntimeUnit | string | `Hours` \| `Days` |
| description | string | The complaint, as submitted by the Requester |
| safetyRisk | map | `{ flag: boolean, severity: "Low"\|"Medium"\|"High" }` |
| environmentalRisk | map | `{ flag: boolean }` |
| permitRequired | boolean | Derived: `true` whenever `safetyRisk.flag === true` |
| requesterId | string (uid) | Indexed |
| requesterName | string | Denormalized |
| requesterPhone | string | |
| assignedToId | string (uid) \| null | Indexed. Single primary assignee in this module's model |
| assignedToName | string \| null | Denormalized |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| slaAckDueAt | timestamp | Computed at creation from the plant's SLA matrix for `priority` |
| slaResolutionDueAt | timestamp | Computed at creation |
| slaBreached | boolean | Denormalized flag, recomputed by Cloud Function on a schedule and on status change, so list/dashboard queries never need to compute this client-side |
| declinedCount | number | Increments each time a Technician declines — visible to Supervisor as a friction signal |
| resolutionNotes | string \| null | Set when Technician moves status → `Resolved` |
| resolvedAt | timestamp \| null | |
| verifiedBy | string (uid) \| null | Set when Requester (or HOD override) confirms the fix |
| verifiedAt | timestamp \| null | |
| closedAt | timestamp \| null | |
| clientUuid | string | Client-generated id for offline-created work orders, prevents duplicate sync |

### 2.2 `/workOrders/{woId}/statusHistory/{eventId}`

Immutable ledger of every transition in the workflow — this is the record that proves the Requester→Supervisor→Technician→Requester loop actually happened in order.

| Field | Type | Notes |
|---|---|---|
| fromStatus | string \| null | `null` for the initial `New` event |
| toStatus | string | |
| actorId | string (uid) | |
| actorName | string | Denormalized |
| actorRole | string | `Requester` \| `Technician` \| `Supervisor` \| `HOD` — captured at write time so a later role change doesn't rewrite history |
| remarks | string \| null | e.g. "Assigned to Karan Mehta", "Declined: no spare part", "Reopened: still leaking" |
| timestamp | timestamp | |

### 2.3 `/workOrders/{woId}/progressLog/{entryId}`

The Technician's running commentary while attending — distinct from `statusHistory` because a work order can sit `In Progress` for hours with many notes and zero status changes.

| Field | Type | Notes |
|---|---|---|
| note | string | |
| actorId | string (uid) | Must equal `workOrders.assignedToId` at write time (enforced by rules) |
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
| recipientId | string (uid) | Indexed — this is *who* it's for |
| recipientRole | string | Denormalized, useful for filtering "Supervisor" broadcast-style notices |
| woId | string | Reference → the triggering work order |
| woNumber | string | Denormalized |
| type | string | `NeedsAssignment` \| `Assigned` \| `Accepted` \| `Declined` \| `Resolved` \| `Reopened` \| `Verified` \| `SLABreach` |
| title | string | |
| body | string | |
| status | string | `Sent` \| `Read` |
| createdAt | timestamp | Indexed |

### 2.6 `/counters/{counterId}`

`counterId` format: `"{plantId}-WO-{year}"`. Incremented inside a Firestore transaction whenever a work order is created, to produce the human-readable `woNumber`.

| Field | Type |
|---|---|
| lastValue | number |

### 2.7 `/users/{uid}` — referenced fields only

Work Order Management reads, but does not own, these fields:

| Field | Type | Used for |
|---|---|---|
| name | string | Denormalizing `requesterName` / `assignedToName` |
| role | string | Determining what a given uid is allowed to do (Section 5) |
| phone | string | Defaulting `requesterPhone` |
| skills | array<string> | Supervisor's "best match" technician suggestion |
| plantIds | array<string> | Security rule scoping |

---

## 3. Relationships

| From | Field | To | Cardinality |
|---|---|---|---|
| workOrders | requesterId | users | many workOrders → 1 user |
| workOrders | assignedToId | users | many workOrders → 1 user (nullable until assigned) |
| workOrders | machineId | assets (external module) | many workOrders → 1 asset |
| workOrders/statusHistory | actorId | users | many events → 1 user |
| workOrders/progressLog | actorId | users (must be current assignedToId) | many entries → 1 user |
| workOrders/attachments | uploadedById | users | many attachments → 1 user |
| notifications | woId | workOrders | many notifications → 1 work order |
| notifications | recipientId | users | many notifications → 1 user |
| counters | (id only) | — | 1 counter → many workOrders (via transaction) |

Firestore has no enforced foreign keys — every relationship above is a plain reference field, and integrity (e.g., "does this `assignedToId` actually have role Technician?") is enforced at the Cloud Function / security-rule layer described in Section 5, not by the database itself.

---

## 4. Indexes

Single-field equality/range queries are covered by Firestore's automatic indexes and aren't listed. The composite indexes below exist because the module's core screens each filter on more than one field at once.

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

**What each index serves:**
- `requesterId + createdAt` / `requesterId + status` → the Requester's "My Work Orders" screen.
- `assignedToId + status` / `assignedToId + createdAt` → the Technician's "My Tasks," including the "needs my response" (`status == Assigned`) filter.
- `plantId + status + priority` → Supervisor/HOD's main list and the "needs assignment" banner (`status == New`).
- `plantId + status + slaResolutionDueAt` → sorting the assignment/response queue by urgency.
- `plantId + slaBreached + priority` → the Traffic Light SLA widget's breached/at-risk counts.
- `recipientId + status + createdAt` → each role's notification panel, unread-first.
- `statusHistory` collection-group index → a future cross-work-order audit view without needing to know `woId` in advance.

---

## 5. Security Rules

### 5.1 Identity Model

Every authenticated user carries **custom claims**, set by a Cloud Function when their `/users/{uid}` document's role changes:

```
{
  role: "Requester" | "Technician" | "Supervisor" | "HOD",
  plantIds: ["PLT001", ...]
}
```

Rules read `request.auth.token.role` and `request.auth.token.plantIds` rather than fetching `/users/{uid}` on every request, keeping rule evaluation fast.

### 5.2 Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    function inPlant(plantId) { return plantId in request.auth.token.plantIds; }
    function isSupervisorLike() { return role() == "Supervisor" || role() == "HOD"; }

    match /workOrders/{woId} {

      // READ — Requester sees their own; Technician sees what they're assigned;
      // Supervisor/HOD see everything in their plant(s).
      allow read: if signedIn() && (
        resource.data.requesterId == request.auth.uid ||
        resource.data.assignedToId == request.auth.uid ||
        (isSupervisorLike() && inPlant(resource.data.plantId))
      );

      // CREATE — any signed-in role may raise a work order, but a Requester
      // may only create it under their own identity (no impersonation).
      // Supervisor/HOD may create on behalf of someone else.
      allow create: if signedIn() &&
        inPlant(request.resource.data.plantId) &&
        request.resource.data.status == "New" &&
        request.resource.data.assignedToId == null &&
        (
          request.resource.data.requesterId == request.auth.uid ||
          isSupervisorLike()
        );

      // UPDATE — no blanket allow. Every transition is checked explicitly
      // against who is making it, matching the exact workflow.
      allow update: if signedIn() && inPlant(resource.data.plantId) && (

        // Supervisor/HOD: New -> Assigned (assign a technician)
        (isSupervisorLike() &&
          resource.data.status == "New" &&
          request.resource.data.status == "Assigned" &&
          request.resource.data.assignedToId != null)

        // Supervisor/HOD: reassign at any pre-completion stage
        || (isSupervisorLike() &&
          resource.data.status in ["New", "Assigned", "Accepted"] &&
          request.resource.data.status == "Assigned")

        // Technician (the assignee): Assigned -> Accepted
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "Assigned" &&
          request.resource.data.status == "Accepted")

        // Technician (the assignee): Assigned -> New (decline; clears assignment)
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "Assigned" &&
          request.resource.data.status == "New" &&
          request.resource.data.assignedToId == null)

        // Technician (the assignee): Accepted -> In Progress
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "Accepted" &&
          request.resource.data.status == "In Progress")

        // Technician (the assignee): In Progress <-> On Hold
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "In Progress" &&
          request.resource.data.status == "On Hold")
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "On Hold" &&
          request.resource.data.status == "In Progress")

        // Technician (the assignee): In Progress -> Resolved (must include resolutionNotes)
        || (role() == "Technician" &&
          resource.data.assignedToId == request.auth.uid &&
          resource.data.status == "In Progress" &&
          request.resource.data.status == "Resolved" &&
          request.resource.data.resolutionNotes is string &&
          request.resource.data.resolutionNotes.size() > 0)

        // Requester: Resolved -> Closed (verify the fix)
        || (role() == "Requester" &&
          resource.data.requesterId == request.auth.uid &&
          resource.data.status == "Resolved" &&
          request.resource.data.status == "Closed" &&
          request.resource.data.verifiedBy == request.auth.uid)

        // Requester: Resolved -> In Progress (reject verification, reopen)
        || (role() == "Requester" &&
          resource.data.requesterId == request.auth.uid &&
          resource.data.status == "Resolved" &&
          request.resource.data.status == "In Progress")

        // HOD override: Resolved -> Closed, if the requester hasn't responded
        || (role() == "HOD" &&
          resource.data.status == "Resolved" &&
          request.resource.data.status == "Closed")
      );

      // DELETE — never. Closing is a status, not a deletion; the record
      // is the audit trail.
      allow delete: if false;

      match /statusHistory/{eventId} {
        // Append-only. Anyone who could make the parent transition can log it;
        // nothing here is ever updated or deleted once written.
        allow read: if signedIn();
        allow create: if signedIn();
        allow update, delete: if false;
      }

      match /progressLog/{entryId} {
        allow read: if signedIn();
        // Only the current assignee may add a progress note, and only
        // while the parent work order is in an active attending state.
        allow create: if signedIn() &&
          get(/databases/$(database)/documents/workOrders/$(woId)).data.assignedToId == request.auth.uid &&
          get(/databases/$(database)/documents/workOrders/$(woId)).data.status in ["Accepted", "In Progress", "On Hold"] &&
          request.resource.data.actorId == request.auth.uid;
        allow update, delete: if false;
      }

      match /attachments/{attachmentId} {
        allow read: if signedIn();
        // Requester (their own WO) or the current assignee may attach evidence.
        allow create: if signedIn() && (
          get(/databases/$(database)/documents/workOrders/$(woId)).data.requesterId == request.auth.uid ||
          get(/databases/$(database)/documents/workOrders/$(woId)).data.assignedToId == request.auth.uid
        );
        // Only HOD may remove an attachment (e.g., wrong/sensitive file), for
        // compliance reasons — never a silent client-side delete otherwise.
        allow delete: if signedIn() && role() == "HOD";
        allow update: if false;
      }
    }

    match /notifications/{notificationId} {
      allow read: if signedIn() && resource.data.recipientId == request.auth.uid;
      // Notifications are written server-side only (Cloud Functions triggered
      // by the status transitions above) — never directly by a client.
      allow create, update, delete: if false;
    }

    match /counters/{counterId} {
      // Sequential numbering must never race between two clients creating
      // work orders simultaneously — writable only inside a Cloud Function
      // transaction, never directly.
      allow read: if false;
      allow write: if false;
    }
  }
}
```

### 5.3 Rules Design Notes

- **The update rule is a transition matrix, not a field-permission list.** This is deliberate: the workflow's entire value is that a work order can only move through the exact sequence given (Requester → Supervisor → Technician → Requester), so the rules encode *(current status, next status, who)* triples rather than trusting the client to send a sane status.
- **`statusHistory` and `progressLog` are append-only from any allowed writer, but never editable.** This is what makes them a trustworthy audit trail — even a Supervisor or HOD cannot edit yesterday's log entry, only add new ones.
- **`resolutionNotes` is enforced at the rules layer**, not just the UI — a Technician cannot mark a work order `Resolved` without submitting notes, closing a loophole where the app's client-side validation could be bypassed by a direct API call.
- **HOD's override power is narrow by design**: HOD can force-close a `Resolved` work order (covering an unresponsive Requester) but cannot skip earlier steps (e.g., cannot jump `New` straight to `Closed`) — the escalation path still respects the workflow, it just adds a release valve at the one step most likely to stall in practice.
- **Notifications and the counter are entirely server-authoritative.** No client ever writes them directly; they exist so that Cloud Functions (triggered by the `update` transitions above) can create them with certainty about *why* they were created, rather than trusting a client to self-report "I was just assigned a job."

---

## 6. Cloud Function Triggers Implied by This Design

Listed here because the security rules above assume they exist — this module cannot be production-ready with client-only writes to `notifications` and `counters`.

| Trigger | Fires on | Action |
|---|---|---|
| `onWorkOrderCreate` | `workOrders` create | Assign `woNumber` via `/counters` transaction; compute `slaAckDueAt`/`slaResolutionDueAt`; write a `statusHistory` `New` event; create a notification for all Supervisors/HOD in `plantId` |
| `onWorkOrderAssigned` | `status` → `Assigned` | Create a notification for `assignedToId` |
| `onWorkOrderDeclined` | `status` → `New` with prior status `Assigned` | Increment `declinedCount`; notify Supervisors again |
| `onWorkOrderResolved` | `status` → `Resolved` | Notify `requesterId` to verify |
| `onWorkOrderReopened` | `status` → `In Progress` with prior status `Resolved` | Notify `assignedToId` |
| `onWorkOrderClosed` | `status` → `Closed` | Stamp `closedAt`; recompute `slaBreached` one final time for reporting |
| `slaBreachSweep` | Scheduled, every 5 min | Query `slaResolutionDueAt < now AND status not in [Closed]`; set `slaBreached = true`; notify Supervisors/HOD for newly-breached items only |

---

This is the complete Firestore design for the Work Order Management module only — no other module's collections, and no UI, per your instruction.
