# SI — Service Inside
## Functional Specification Document (FSD)
## Work Order Management Module
**Version 1.2 · August 27, 2026 · Status: Official specification for development**
**No code in this document, per instruction.**

> **Revision 1.2 — the Technician flow loses two steps.** `On The Way` and
> `On Site` are removed. A Technician who has accepted a job goes straight to
> repairing it, and the action that starts that is called **Start Work** rather
> than Start Repair. Sections 1, 3, 8, 9.1, 9.2, 12 and 15.2 are amended. Nothing else
> about the flow changes: no step may still be skipped, the two backward
> transitions and the two loops are unaffected, and work orders raised before
> this revision keep both steps in their recorded history — an audit trail is
> not rewritten by a change to the specification (Section 14).

---

## 1. Purpose

The Work Order Management module is the system of record for every maintenance request raised against plant equipment, from the moment a problem is reported to the moment the requester confirms it is actually fixed. Its purpose is to:

- Give any employee (**Requester**) a fast, guided way to report a problem, with the system — not the employee — deciding how urgent it is.
- Give a **Supervisor** a single queue of unassigned work and a way to put the right **Technician** on it.
- Give a Technician a step-by-step field-service flow that matches how a repair actually unfolds (acceptance, repair, waiting on parts if needed, testing, completion) rather than a generic "in progress" bucket.
- Give the Requester a closing say — a work order is not closed because a technician says so, it is closed because the person who reported the problem confirms it's resolved.
- Give an **HOD** narrow, specific override authority so the process never permanently stalls on an unresponsive requester, without giving that authority the power to skip any other step.
- Produce an immutable, timestamped record of every one of those steps, sufficient for compliance and postmortem review, without anyone — including HOD — being able to edit history after the fact.

This document is the authoritative specification. Where the shipped implementation and this document disagree, this document is correct and the implementation should be brought in line with it.

---

## 2. User Roles

| Role | Description | Primary surface |
|---|---|---|
| **Requester** | Any employee who can report a problem with equipment. Owns the "did this actually get fixed?" decision. | Mobile-first, also usable on desktop |
| **Technician** | Executes the repair. Owns every step of the field-service flow from acceptance through marking the fix complete. | Mobile, shop-floor use |
| **Supervisor** | Triages incoming requests and assigns technicians. Can reassign at any point before completion. | Desktop-first |
| **HOD** (Head of Department) | Oversight and a single narrow escalation power: force-closing a work order stuck awaiting a requester's verification. Cannot skip any earlier step. | Desktop-first |

A person may hold exactly one role for the purposes of this module's authorization logic. A Supervisor or HOD may raise a work order on behalf of someone else (e.g., a phoned-in report), but the module does not model "acting as another role" beyond that one exception.

---

## 3. Workflow

The module implements one linear path, with exactly two permitted backward loops. In prose:

1. **Requester submits** a work order describing the problem, the affected equipment, and — critically — the production impact and any safety/environmental risk. The system, not the Requester, determines the priority from these inputs.
2. **Supervisor is notified** immediately and sees the request in an "needs assignment" queue.
3. **Supervisor assigns a Technician.** The Technician is notified.
4. **Technician accepts** (or declines, sending it back to the queue for reassignment).
5. **Technician starts work** once they are at the equipment. Travel and arrival are not recorded as separate steps — the moment that matters to everyone waiting is when work actually begins on the machine.
6. If a part is needed, the **Technician marks the job waiting on a spare part**, then resumes repair once it arrives.
7. Once the Technician believes the issue is fixed, they move the job into **testing**. If the test fails, it goes back to repair. If it passes, the Technician marks it **completed** with notes describing what was done.
8. **Requester is notified** to verify. The Requester either **confirms the fix** (the work order is verified and closed in one action) or says **it's not fixed**, sending it back to repair with a reason.
9. **HOD** may, only at the "awaiting verification" step, force a verify-and-close if the Requester is unresponsive — this is the only step at which HOD's authority differs from a normal read-only oversight view.

No step in this sequence may be skipped by any role, including HOD. See Section 9 for the complete state diagram and transition table.

---

## 4. Business Rules

1. **Priority is a system decision, not a free-text field.** It is derived from Production Impact plus any Safety/Environmental Risk flags at creation time, and may be manually overridden by whoever is raising the work order — but the override is visible as an override, not silently blended into the record.
2. **Safety risk always escalates priority to at least P2, and to P1 if severity is High**, regardless of what Production Impact alone would suggest. A cosmetic issue with a High safety risk is still at least P1.
3. **Environmental risk always escalates priority to at least P2.**
4. **Only the technician a work order is currently assigned to may act on it.** A second technician viewing the same work order sees a read-only description of what's happening, never an action button that isn't theirs to press.
5. **Only the original requester may verify or reopen a completed work order.** A Supervisor cannot verify on a requester's behalf; only HOD's narrow override exists for that gap.
6. **A Supervisor or HOD may reassign a work order at any point before it reaches Completed**, including after a Technician has already started repairing — a mid-repair reassignment does not reset the flow back to Assigned's acceptance step; it simply changes who owns the remaining steps forward from wherever the work order currently sits. Reassignment before acceptance (from `Open` or `Assigned`) still routes through `Assigned` so the new technician accepts fresh; reassignment at `Accepted` or any later stage preserves the current status exactly.
7. **A work order is never deleted.** Closing is a status, not a deletion — the full lifecycle remains queryable indefinitely for audit purposes.
8. **A decline always returns a work order to Open, unassigned** — it does not stay attached to the declining technician in any way, and does not silently reassign to anyone; a Supervisor must actively re-triage it.
9. **Marking a work order Completed requires resolution notes.** A Technician cannot close the loop with no record of what was actually done. This is enforced at the data layer, not only in the UI.
10. **Reopening a completed work order requires a reason.** Same principle as (9) — a Requester cannot silently bounce a work order back without leaving a record of what's still wrong.

---

## 5. Approval Flow

The module has two distinct approval gates. Neither is a generic "manager sign-off" — each has a specific owner and a specific, narrow scope.

### 5.1 Assignment Approval
- **Gate:** A work order cannot proceed past `Open` without a Supervisor or HOD actively choosing a Technician.
- **Owner:** Supervisor or HOD only.
- **Nothing auto-assigns.** Even a work order with an obvious "best match" technician (skills overlapping the equipment/department) still requires a human tap to confirm.

### 5.2 Verification Approval
- **Gate:** A work order cannot proceed past `Completed` without either (a) the original Requester confirming the fix, or (b) HOD invoking the override.
- **Owner:** Requester primarily; HOD only as a fallback at this exact step.
- **The override is not a general HOD "approve anything" power.** It exists solely to prevent a stalled, unresponsive Requester from permanently blocking closure. HOD cannot use it to skip assignment, force-accept on a Technician's behalf, or reopen an already-`Closed` work order.

---

## 6. SLA Rules

Every work order carries two SLA timestamps, computed once at creation from its priority and never recalculated afterward (a later priority override does not retroactively change an already-computed deadline within the same work order's lifecycle — a priority change of that kind should be treated as an edge case requiring explicit product decision, not silently handled).

| Priority | Acknowledge target | Resolution target |
|---|---|---|
| P1 | 5 minutes | 4 hours |
| P2 | 15 minutes | 8 hours |
| P3 | 30 minutes | 24 hours |
| P4 | 2 hours | 5 business days |

- **"Acknowledge"** is measured from creation to the Supervisor/HOD assigning a technician (i.e., leaving `Open`).
- **"Resolution"** is measured from creation to the work order reaching `Closed`.
- A background sweep runs on a fixed interval and flags any work order whose resolution target has passed and which is not yet `Closed`, setting a breach flag. This flag, once set, does not clear itself even if the work order later closes — a breach is a permanent fact about that work order's history, not a live-only indicator.
- A newly-flagged breach triggers exactly one additional notification round to Supervisor/HOD; it does not re-notify on every subsequent sweep for the same already-flagged work order.
- SLA breach status is informational only — it does not block any workflow action. A Technician can still complete a breached work order normally; the breach is a record, not a lock.

---

## 7. Priority Rules

### 7.1 Inputs
- **Production Impact** (required): Full stoppage, Reduced capacity, Auxiliary equipment only, No impact. Each has a default suggested priority (P1, P2, P3, P4 respectively).
- **Safety Risk** (optional flag + severity): if flagged, escalates the suggestion — High severity forces at least P1, Medium/Low forces at least P2.
- **Environmental Risk** (optional flag): if flagged, escalates the suggestion to at least P2.

### 7.2 Resolution Logic
The system takes the **most severe** (numerically lowest) priority implied by any of the three inputs above. Impact alone never overrides a risk-driven escalation; risk flags only ever pull priority toward more urgent, never less.

### 7.3 Override
Whoever is raising the work order (Requester, or Supervisor/HOD raising on someone's behalf) may manually select a different priority than the suggestion. The record distinguishes "auto-suggested" from "manually set" — this distinction is visible on the work order, not discarded once set.

### 7.4 Immutability After Creation
Priority is set once, at creation. There is currently no supported flow for changing a work order's priority after it has been raised. If this becomes a requirement, it should be treated as a new feature with its own approval/audit rules, not an open field on an existing record.

---

## 8. Notifications

| Trigger | Recipient(s) | Type |
|---|---|---|
| Work order created | All Supervisors/HOD in the plant | Needs Assignment |
| Technician assigned | The assigned Technician | Assigned |
| Technician declines | All Supervisors/HOD in the plant (again) | Declined |
| Technician starts work | The original Requester | Work started |
| Technician marks Completed | The original Requester | Completed — please verify |
| Requester reopens | The assigned Technician | Reopened |
| SLA resolution target passed (newly flagged only) | All Supervisors/HOD in the plant | SLA Breach |

- Notifications are generated server-side only, never written directly by any client, so a notification's existence is always trustworthy evidence that its trigger actually occurred — a client cannot fabricate one.
- A recipient may mark their own notification read; no other write to a notification is permitted by anyone, including the sender-side trigger logic (a notification, once created, is never edited).
- Notifications currently have no in-module read/unread digest or batching rules beyond "one notification per trigger event" — a work order that gets declined three times produces three separate Declined notifications, not one updated one.

---

## 9. Status Flow

### 9.1 States

`Open → Assigned → Accepted → Repairing → Waiting Spare Part → Testing → Completed → Verified → Closed`

`On The Way` and `On Site` were part of this sequence until revision 1.2 and are
no longer reachable. They are **retired, not deleted**: work orders that passed
through them keep those entries in their history, still labelled and still shown
on their timeline. No new work order can enter either.

Two additional backward transitions are permitted:
- `Assigned → Open` (decline)
- `Completed → Repairing` (reopen)

And one internal loop:
- `Waiting Spare Part → Repairing` (resume) and the reverse `Repairing → Waiting Spare Part`
- `Testing → Repairing` (test failed) — a loop, not a new backward transition outside the main sequence

### 9.2 Transition Table

| From | To | Who | Notes |
|---|---|---|---|
| — | Open | Requester (self) or Supervisor/HOD (on behalf) | Work order created |
| Open | Assigned | Supervisor / HOD | Technician chosen |
| Assigned | Accepted | Assigned Technician | |
| Assigned | Open | Assigned Technician | Decline; reason required; assignment cleared |
| Assigned / Accepted / Repairing / Waiting Spare Part / Testing | Assigned | Supervisor / HOD | Reassignment, any pre-Completed stage |
| Accepted | Repairing | Assigned Technician | "Start Work" |
| Repairing | Waiting Spare Part | Assigned Technician | Reason expected |
| Waiting Spare Part | Repairing | Assigned Technician | Resume |
| Repairing | Testing | Assigned Technician | |
| Testing | Repairing | Assigned Technician | Test failed |
| Testing | Completed | Assigned Technician | Resolution notes **required** |
| Completed | Closed | Requester (self) | Verify; recorded as two entries (Verified, then Closed) in one action |
| Completed | Repairing | Requester (self) | Reopen; reason required |
| Completed | Closed | HOD | Override; requester unresponsive only |

### 9.3 Rules Governing the Flow
- No status may be skipped, by anyone, under any role. Every intermediate state must exist as its own recorded transition.
- Every valid transition above has exactly one (from, to, role) meaning — there is no transition in this table that means two different things depending on context.
- "Verified" is never a resting state in practice — it is always immediately followed by "Closed" within the same user action, but the two remain distinct recorded events.

---

## 10. Validation Rules

### 10.1 Raise Work Order (creation)

| Field | Rule |
|---|---|
| Department | Required |
| Equipment | Required |
| Complaint | Required, minimum 10 characters |
| Production impact | Required |
| Estimated downtime | Required, positive number |
| Requester name | Required |
| Phone number | Required, at least 7 digits after stripping non-numeric characters |
| Safety risk severity | Required only if Safety risk = Yes |
| Photo / Video | Optional, no minimum |

Validation fires on submit attempt, not per-field on blur — every error is surfaced together so the Requester fixes everything in one pass.

### 10.2 Workflow Transition Validation

| Action | Requires |
|---|---|
| Decline | Non-empty reason (`declineReason`) — **enforced server-side** |
| Waiting Spare Part | Non-empty reason (`sparePartReason`) — **enforced server-side** |
| Test failed | Non-empty reason (`testFailReason`) — **enforced server-side** |
| Mark Completed | Non-empty resolution notes (`resolutionNotes`) — **enforced server-side** |
| Reopen | Non-empty reason (`reopenReason`) — **enforced server-side** |
| Progress log entry | Non-empty note; author must be the current assignee; work order must be in an active-work status |

All five justification/notes fields above are required at the data layer identically — none is UI-only. See Section 11.1 for where each field lives on the work order document.

---

## 11. Database Fields

This module's persistence is Firestore. Fields below are the authoritative set; anything not listed here should not be added to a work order document without a specification update.

### 11.1 `workOrders/{woId}`

`woNumber, plantId, machineId, machineName, department, type, priority, status, impact, estDowntimeValue, estDowntimeUnit, description, safetyRisk {flag, severity}, environmentalRisk {flag}, permitRequired, requesterId, requesterName, requesterPhone, assignedToId, assignedToName, createdAt, updatedAt, slaAckDueAt, slaResolutionDueAt, slaBreached, declinedCount, declineReason, sparePartReason, testFailReason, resolutionNotes, resolvedAt, reopenReason, verifiedBy, verifiedAt, closedAt, clientUuid`

### 11.2 `workOrders/{woId}/statusHistory/{eventId}`
`fromStatus, toStatus, actorId, actorName, actorRole, remarks, timestamp`

### 11.3 `workOrders/{woId}/progressLog/{entryId}`
`note, actorId, actorName, timestamp`

### 11.4 `workOrders/{woId}/attachments/{attachmentId}`
`fileUrl, fileType (photo|video), uploadedById, uploadedByRole, uploadedAt`

### 11.5 `notifications/{notificationId}`
`recipientId, recipientRole, woId, woNumber, type, title, body, status (Sent|Read), createdAt`

### 11.6 `counters/{counterId}`
`lastValue` — one document per calendar year (`WO-{year}`), used to generate the human-readable `woNumber` (format: `WO-{year}-{6-digit sequence}`, e.g. `WO-2026-000001`) as a single global sequence, not per-plant.

### 11.7 Referenced, not owned by this module
`users/{uid}`: `name, role, phone, skills, plantIds` — read by this module for display and authorization context; never written by it.

---

## 12. Permissions

| Capability | Requester | Technician (assignee) | Technician (not assignee) | Supervisor | HOD |
|---|---|---|---|---|---|
| Create a work order | Own identity only | — | — | On behalf of others | On behalf of others |
| Read a work order | Own only | Assigned only | — | Any in-plant | Any in-plant |
| Assign / reassign technician (before acceptance → `Assigned`; at/after acceptance → status unchanged) | — | — | — | ✔ | ✔ |
| Accept / decline | — | ✔ | — | — | — |
| Start work; advance repair/testing steps | — | ✔ | — | — | — |
| Mark waiting on spare part / resume | — | ✔ | — | — | — |
| Mark Completed | — | ✔ | — | — | — |
| Verify & close | ✔ (own only) | — | — | — | — |
| Reopen | ✔ (own only) | — | — | — | — |
| Force verify & close override | — | — | — | — | ✔ (Completed status only) |
| Add progress log entry | — | ✔ (active statuses only) | — | — | — |
| Read progress log / status history / attachments | ✔ | ✔ | ✔ (if otherwise permitted to read the WO) | ✔ | ✔ |
| Add attachment | ✔ (own WO) | ✔ (assigned WO) | — | — | — |
| Delete attachment | — | — | — | — | ✔ |
| Delete a work order | — | — | — | — | — (nobody — never deleted) |
| Mark a notification read | Own notifications only | Own notifications only | Own notifications only | Own notifications only | Own notifications only |

This table should match the enforced authorization logic exactly. Any divergence between this table and the enforced logic is a defect, not a matter of interpretation.

---

## 13. Error Handling

### 13.1 General Principle
Every error surfaces as an inline message near the point of failure — never a silent failure, never a full-page crash for a single failed action, and never at the cost of losing what the user had already typed.

### 13.2 Standard Patterns

| Situation | Behavior |
|---|---|
| Form submission fails (e.g., Raise Work Order) | Inline banner above the form; all entered field values remain exactly as typed |
| A workflow action fails to save (Accept, Decline, Mark Completed, etc.) | Button reverts from its loading state; a short inline message appears beneath it; any reason/notes text the user typed remains in its field |
| A list fails to load | Header and filters still render; a retry-capable banner appears where results would be |
| A specific work order fails to load / is inaccessible | The detail shell is replaced entirely with a single explanatory message and a way back to the list — no partial or broken tab strip is shown |
| A progress note or attachment upload fails | The attempted input is preserved; a short inline retry prompt appears |

### 13.3 Specification Gaps — Resolved
As of this revision, both gaps previously flagged here are closed:
1. **Decline, Waiting Spare Part, Test Failed, Mark Completed, and Reopen** all now require their justification/notes field non-empty **at the data layer**, not only in the UI — enforced identically across all five, via `declineReason`, `sparePartReason`, `testFailReason`, `resolutionNotes`, and `reopenReason` respectively (see Section 11.1).
2. **Mid-flow reassignment now preserves the current status** for any work order at `Accepted` or later — only reassignment before acceptance (`Open`/`Assigned`) routes through `Assigned` for a fresh accept, per the corrected Business Rule 6.

---

## 14. Audit Trail

- `statusHistory` is the authoritative audit record of the workflow itself: every transition, who performed it, in what role, and when, plus an optional human-readable remark.
- `progressLog` is a secondary, non-status-changing record of what a Technician did while actively working a job — useful for reconstructing "what actually happened" beyond the bare state transitions.
- Both are **append-only**. No role, including HOD, may edit or delete an existing entry in either — a correction is made by adding a new entry, never by altering an old one.
- `actorRole` is captured on every history entry **at the time it was written**, not derived from the actor's current role at read time — if a person's role changes later, historical entries still correctly reflect what role they held when they acted.
- A work order's full audit trail remains queryable indefinitely; there is no retention or archival deletion policy defined for this module (if one is required, it must come from a compliance/records-retention specification, not be assumed here).

---

## 15. UI Behaviour

### 15.1 Screens
Work Order List, Raise New Work Order, Work Order Details (shell), Assignment, Technician Job Screen (the Workflow tab as experienced by a Technician), Progress Update, Complete Work Order, Requester Verification, Work Order History. See the companion UI/UX screen specification for full desktop/mobile layouts, field-by-field detail, and empty/error state copy per screen — this section summarizes the behavioral principles that specification establishes.

### 15.2 Status Colors
Open/Assigned = Navy. Accepted/Repairing/Testing/Completed = Orange (all "active, not yet done" states share one color intentionally — Completed is "handed off," not "finished"). Waiting Spare Part = Slate (paused). Verified/Closed = Green. An SLA breach recolors its indicator Red regardless of the underlying status.

### 15.3 Role-Gated Controls
A control that doesn't apply to the current viewer's role is never shown disabled with no explanation — it is either fully present and functional, or replaced entirely by a plain sentence describing what's being waited on and by whom.

### 15.4 Irreversible Actions
Every irreversible transition that requires justification (Decline, Waiting Spare Part, Test Failed, Mark Completed, Reopen) follows the same two-step interaction: a primary button reveals an inline field, and a second, distinctly labeled confirm button remains disabled until that field is non-empty. No irreversible action is ever a single, unconfirmed tap.

### 15.5 Desktop vs. Mobile
Screens 4 through 9 (per the UI/UX specification's numbering) are tabs within Work Order Details on desktop, and become independent full-screen views on mobile, reached through a sticky, always-visible primary action button. Screen 9 (History) is the one exception that renders identically on both — a vertical timeline needs no restructuring for a narrow viewport.

### 15.6 Empty States
Every list-type view (Progress Log, Attachments, notification panel, the work order list itself) has a specific, role-aware empty-state sentence rather than a generic "no data" message — see Section 10 of the companion UI/UX document for exact copy per screen.

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-23 | Initial official FSD, consolidating the workflow, Firestore design, and UI/UX specification into a single authoritative document; two implementation gaps flagged (Sections 4.6, 13.3) for resolution before this module is considered production-complete against this spec. |
| 1.1 | 2026-07-23 | Both flagged gaps resolved in the implementation: all five justification fields (decline, spare part, test-failed, resolution, reopen) now enforced server-side identically; mid-flow reassignment now preserves status at Accepted-or-later instead of resetting to Assigned. Sections 4.6, 10.2, 11.1, 12, 13.3 updated to match. |
| 1.2 | 2026-08-27 | `On The Way` and `On Site` removed from the Technician flow; `Accepted → Repairing` is now a single step named **Start Work**. The requester's "technician has arrived" notification becomes "work started" at the same step. Both statuses are retired rather than deleted — work orders that passed through them keep those history entries. Sections 1, 3, 8, 9.1, 9.2, 12 and 15.2 updated to match. |

This document, not any prior individual design artifact, is the specification of record for the Work Order Management module going forward.
