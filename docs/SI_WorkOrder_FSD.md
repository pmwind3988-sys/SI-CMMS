# SI — Service Inside
## Functional Specification Document (FSD)
## Work Order Management Module
**Version 1.5 · August 27, 2026 · Status: Official specification for development**
**No code in this document, per instruction.**

> **Revision 1.2 — the Technician flow loses two steps.** `On The Way` and
> `On Site` are removed. A Technician who has accepted a job goes straight to
> repairing it, and the action that starts that is called **Start Work** rather
> than Start Repair. Sections 1, 3, 8, 9.1, 9.2, 12 and 15.2 are amended. Nothing else
> about the flow changes: no step may still be skipped, the two backward
> transitions and the two loops are unaffected, and work orders raised before
> this revision keep both steps in their recorded history — an audit trail is
> not rewritten by a change to the specification (Section 14).

> **Revision 1.3 — priority can no longer be overridden, and two collected
> fields are withdrawn.** Priority is now derived from Production Impact and the
> two risk flags and nothing else: the manual override described in 1.0's
> Section 7.3 is gone, along with the four priority buttons on the raise form.
> **Estimated downtime** is no longer collected, and **video attachments** are
> no longer accepted. Sections 4, 6, 7.3, 8, 10.1 and 11.4 are amended. The
> escalation rules themselves are unchanged — a safety flag still forces at
> least P2 and P1 at High severity, and an environmental flag still forces at
> least P2.

> **Revision 1.4 — an account holds a set of roles, and a work order can be
> deleted.** Two things this document has described incorrectly since 1.0, both
> load-bearing. An account is no longer one role: it holds any combination, and
> its authorization is their union. And Section 4 rule 7's "a work order is
> never deleted" is not true — deletion exists as a capability that must be
> granted, and is off for everybody but Administrators by default. Sections 2,
> 4, 12 and the new 12.1 and 12.2 are amended.

> **Revision 1.5 — "requester" means whoever raised the work order.** A
> clarification of 1.4's role model with real consequences. The person who
> raised a work order is its requester and may verify, reopen and edit it,
> whatever roles their account carries. Previously this was read as "an account
> holding the Requester role", so a Supervisor or Technician who reported a
> fault could not close it — and an Administrator or HOD who reported one was
> offered the unresponsive-requester override on their own work order. Sections
> 4 rule 5 and 12 are amended.

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
| **Administrator** | Administers accounts, reference data and system settings. Holds every work order capability the four roles above hold, so that a stuck record can always be corrected. Not a maintenance role — an Administrator is not expected to appear in the technician roster or on any queue. | Desktop-first |
| **Superuser** | An Administrator marked protected. Exists so the account that administers Administrators is not itself administrable from inside the app. Grants the two capabilities nobody else has: setting another person's credentials, and switching on deletion. | Desktop-first |

**HOD is implemented under the name Manager.** The two are the same role; this
document uses HOD because that is the plant's word for it.

### 2.1 An account holds a set of roles

A person holds **any combination** of the roles above, not exactly one. One
account can be a Supervisor and a Technician, which is the ordinary case in a
small maintenance team.

Four rules follow, and they are the whole model:

1. **Authorization is the union.** An account may do anything any of its roles
   may do. There is no "acting as" and no role switch that grants or withholds
   anything — a Supervisor+Technician can assign work *and* be assigned work, at
   the same time, with no mode to change first.
2. **Seniority is the highest role held.** Wherever this document says one role
   outranks another, the comparison uses the most senior role an account holds.
   A Supervisor+Technician ranks as a Supervisor. The order is
   Requester → Technician → Supervisor → HOD → Administrator → Superuser.
3. **Nobody assigns work to themselves.** A Supervisor+Technician may not assign
   a work order to their own account, and neither may an Administrator or a
   Superuser. The accepted consequence: where one person is the only active
   Supervisor *and* the only active Technician, somebody else has to do the
   assigning.
4. **Any screen that offers a choice of role is showing a view, never granting
   one.** A person holding several roles sees a control for choosing which
   queue they are looking at. It changes what is displayed and nothing else. No
   capability may ever depend on it, or an authorization boundary ends up living
   in a display preference.

A Supervisor, HOD or Administrator may raise a work order on behalf of someone
else (e.g., a phoned-in report). That is a property of those roles, not an
exception to the rules above.

A role change takes effect when the account's session credentials are next
issued, not instantly — in practice within the hour, or immediately on signing
out and back in. The same latency applies to deactivating an account.

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

1. **Priority is a system decision.** It is derived from Production Impact plus any Safety/Environmental Risk flags, and nobody — Requester, Supervisor or HOD — may set it directly when raising a work order. Whoever raises it answers the questions; the system answers the priority. Derivation is enforced where the record is written, not only in the form, so a priority arriving from anywhere else is replaced rather than accepted. An Administrator may subsequently re-grade a live work order with a recorded reason, which is Section 7.5 — a deliberate, audited exception and the only one.
2. **Safety risk always escalates priority to at least P2, and to P1 if severity is High**, regardless of what Production Impact alone would suggest. A cosmetic issue with a High safety risk is still at least P1.
3. **Environmental risk always escalates priority to at least P2.**
4. **Only the technician a work order is currently assigned to may act on it.** A second technician viewing the same work order sees a read-only description of what's happening, never an action button that isn't theirs to press.
5. **Only the person who raised a work order may verify or reopen it.** This is a fact about the work order, not about the role the person holds: anyone can report a fault, so anyone can be a requester, and a Supervisor or Administrator who reports one has exactly the same closing say over it as a machine operator would. Nobody may verify on their behalf; only HOD's narrow override exists for that gap, and it applies to *other people's* work orders only — see Section 12.

   The corollary matters as much: HOD's override is not the route by which an HOD closes their own work order. They close it the ordinary way, because on that work order they are the requester. Recording the ordinary act as an override would put "requester unresponsive" in the audit trail about somebody who was not.
6. **A Supervisor or HOD may reassign a work order at any point before it reaches Completed**, including after a Technician has already started repairing — a mid-repair reassignment does not reset the flow back to Assigned's acceptance step; it simply changes who owns the remaining steps forward from wherever the work order currently sits. Reassignment before acceptance (from `Open` or `Assigned`) still routes through `Assigned` so the new technician accepts fresh; reassignment at `Accepted` or any later stage preserves the current status exactly.
7. **Closing is a status, not a deletion, and deleting is a capability that has to be granted.** The normal end of a work order's life is `Closed`, and a closed work order remains queryable indefinitely. Permanent deletion exists for genuine mistakes — a duplicate, a test record, a work order raised against the wrong plant — and is off for every role but Administrator until a Superuser switches it on. It is irreversible and it is not part of the workflow. See Section 12.2.
8. **A decline always returns a work order to Open, unassigned** — it does not stay attached to the declining technician in any way, and does not silently reassign to anyone; a Supervisor must actively re-triage it.
9. **Marking a work order Completed requires resolution notes.** A Technician cannot close the loop with no record of what was actually done. This is enforced at the data layer, not only in the UI.
10. **Reopening a completed work order requires a reason.** Same principle as (9) — a Requester cannot silently bounce a work order back without leaving a record of what's still wrong.
11. **Equipment belongs to a plant, and the plant is what a work order is raised against.** The site operates four plants — F1, F2, F3 and Facility — and each keeps its own machinery register, taken from that plant's Machinery & Equipment Master List. Whoever raises a work order chooses the plant and then the machine, and only that plant's machines are offered: the registers overlap by code (three of the four have an AC1, two have a BP), so one combined list would offer four different machines under the same label.
12. **The equipment register is controlled, and "Other (specify)" is the escape hatch.** Machines are added by an Administrator only. Anyone raising a work order against something unlisted chooses **Other (specify)** and names it; that name is recorded on **that work order** — it appears in the list, on the detail page and in the export — and is added to no register. This replaced open self-registration, which had filled the register with one-off entries.
13. **Department is not the same question as plant, and the two are allowed to disagree.** Department says who should handle the job and is answered by the person reporting it. Plant says where the machine physically is. A machine's register entry carries a plant and need not carry a department at all.

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

Every work order carries three SLA targets. For P1-P4 the deadlines are computed once at creation from the priority and are not recalculated by an edit: a deadline is a promise made when the work order was raised, so editing an Open work order's Production Impact re-derives its priority but leaves its deadlines as they were.

| Priority | Acknowledge target | Response target | Resolution target | Measured from |
|---|---|---|---|---|
| P1 | 5 minutes | 15 minutes | 4 hours | creation |
| P2 | 15 minutes | 1 hour | 8 hours | creation |
| P3 | 30 minutes | 4 hours | 24 hours | creation |
| P4 | 2 hours | 24 hours | 5 business days | creation |
| P7 | 5 days | 3 days | 7 days | **the previous stage** |

- **"Acknowledge"** is measured from creation to the Supervisor/HOD assigning a technician (i.e., leaving `Open`).
- **"Response"** is measured to the work order reaching `Repairing` — work actually under way. `Accepted` is deliberately not the marker: on a long-term task it would start the resolution window days before anybody is at the machine.
- **"Resolution"** is measured to the work order reaching `Closed`.

### 6.1 P7 is measured in stages
P7 is a long-term task, and its three windows run in sequence rather than in parallel: it must be **acknowledged within 5 days of being raised**, then reach `Repairing` **within 3 days of being acknowledged**, then close **within 7 days of work starting**. Each window opens only when the one before it is met.

The consequence, and it is intended: a P7 has **no response deadline until it is assigned, and no resolution deadline until work starts**. A deadline that has not begun cannot be breached, and inventing one from the creation time would be the P1-P4 model wearing P7's numbers.

Which model a priority uses is configuration, not code — a per-priority flag on the SLA targets. P7 is the only priority that carries it; P1-P4 behave exactly as they did before P7 existed.

### 6.2 Changing an already-running deadline
This was previously called out as an edge case needing an explicit product decision. That decision has been made, and it is narrow: **the only thing that recalculates a deadline is an Administrator re-grading the priority** (Section 7.5). Nothing else does — not an edit, not a transition, not a relabelling of the SLA targets.

When it happens, the new priority's targets are applied **from the work order's creation time**, not from the moment of the re-grade. A work order raised on Monday and re-graded on Wednesday is measured from Monday: the fault is as old as it is, and restarting the clock would reward re-grading a job that is already late. For P7 the staged shape is preserved — the response deadline is computed from when it was actually acknowledged and the resolution deadline from when work actually started, so a stage not yet reached stays unset.
- A background sweep runs on a fixed interval and flags any work order whose resolution target has passed and which is not yet `Closed`, setting a breach flag. This flag, once set, does not clear itself with the passage of time or when the work order later closes — a breach is a permanent fact about that work order's history, not a live-only indicator. The single exception is an Administrator re-grading the priority (Section 7.5), which recomputes the flag in both directions: what clears it there is a named person with a recorded reason, which is the opposite of it clearing itself.
- A newly-flagged breach triggers exactly one additional notification round to Supervisor/HOD; it does not re-notify on every subsequent sweep for the same already-flagged work order.
- SLA breach status is informational only — it does not block any workflow action. A Technician can still complete a breached work order normally; the breach is a record, not a lock.

---

## 7. Priority Rules

### 7.1 Inputs
- **Production Impact** (required): Full stoppage, Reduced capacity, Auxiliary equipment only, No impact, Long-term task. Each maps to exactly one priority — P1, P2, P3, P4, P7 respectively.
  - **Long-term task** is planned work: an improvement, an upgrade, a rebuild scheduled into a shutdown. Nothing is stopped and nothing is degraded, which is what separates it from "No impact" — a cosmetic fault is still a fault waiting to be fixed, where a long-term task is work waiting to be scheduled. It is the only route to P7 on the raise form.
- **Safety Risk** (optional flag + severity): if flagged, escalates the suggestion — High severity forces at least P1, Medium/Low forces at least P2.
- **Environmental Risk** (optional flag): if flagged, escalates the suggestion to at least P2.

### 7.2 Resolution Logic
The system takes the **most severe** (numerically lowest) priority implied by any of the three inputs above. Impact alone never overrides a risk-driven escalation; risk flags only ever pull priority toward more urgent, never less.

### 7.3 No Override At Creation
The derived priority is the priority. **Nobody may select a different one when
raising a work order** — the four priority buttons that stood here until revision
1.3 are gone from the raise form, and the rule is enforced where the work order
is written rather than only in the form, so it holds for anything reaching the
data layer by any route. The one way a priority can subsequently differ from its
derivation is an Administrator re-grading it, which is Section 7.5 and is a
different operation with its own audit rules.

The reason is that an overridable priority is not a system decision, and Section
4 rule 1 claims it is. In practice an override also defeated the escalations:
the safety and environmental flags exist to pull priority toward more urgent, and
a requester in a hurry could pull it straight back.

The record still distinguishes "auto-suggested" from "manually set" and always
reports auto-suggested. That field is retained rather than removed because an
export is a record of what happened, and work orders raised before this revision
may legitimately carry a manual value.

### 7.4 Changing It By Changing Its Inputs
Priority follows its inputs, so it is not frozen at creation — it can be changed
by changing the answers it is derived from. Editing an Open work order's
Production Impact or risk flags re-derives it. Once a work order leaves `Open`
its core fields can no longer be edited, so by that route the priority is settled
from that moment.

Its SLA deadlines are **not** recomputed when this happens — see Section 6.2.
This route is available to whoever may edit an Open work order, requires no
reason, and writes no history row.

### 7.5 Re-grading It — Administrator only
Some jobs are graded wrongly, and not because the requester answered wrongly: a
breakdown that turns out to be a rebuild is correctly reported and incorrectly
prioritised, and no edit to its production impact describes that honestly.

**An Administrator may set the priority directly.** Nobody else can — not a
Manager, not a Supervisor, not the person who raised it. This is not a grantable
capability like deleting a work order; it is reserved by role, because the
priority is what the SLA clock is computed from.

Five rules govern it:

1. **A reason is required**, minimum 10 characters. It is stored on the work
   order, shown on its Overview, written to its Status Timeline and sent to the
   assigned technician and the requester. It is part of the change, not a
   confirmation of it — there is no separate "are you sure" step.
2. **Only while the work order is live.** Refused once it is `Verified` or
   `Closed`: at that point it is a finished record whose SLA outcome has been
   decided.
3. **It sticks.** The re-graded priority outranks the derivation from then on,
   including through any later edit of the production impact. An Administrator
   can hand the work order back to the derivation, which is itself a re-grade and
   needs its own reason.
4. **Re-grading to P7 also sets the production impact to Long-term task**,
   because P7 is not a severity but a kind of work, and "Full production
   stoppage · P7" is a contradiction rather than a re-graded job. Re-grades
   between P1 and P4 leave the production impact exactly as the requester
   answered it: those four *are* severities, the requester's answer is an
   observation they made at the machine, and the Administrator is disagreeing
   with the grading rather than with the observation. The displaced value is
   recorded in the audit entry either way.
5. **The SLA deadlines are recomputed** from the creation time — see Section 6.2.
   The breach flag moves with them, in both directions.
6. **Nothing else about the work order moves.** It keeps its assigned technician
   and it keeps its current status, at every stage from `Open` to `Completed` —
   a job being repaired goes on being repaired by the same person, and the
   technician is told the priority changed rather than that they have been
   reassigned. Re-grading is not a re-triage: only what is expected of the work
   order changes, never who owns it or how far along it is.

The record keeps "auto-suggested vs manually set" (Section 7.3) separate from
this. They are different events, and an Administrator's re-grade is reported in
its own fields rather than folded into a flag that means a requester overrode a
suggestion.

---

## 8. Notifications

| Trigger | Recipient(s) | Type |
|---|---|---|
| Work order created | All Supervisors/HOD in the plant | Needs Assignment |
| Technician assigned | The assigned Technician | Assigned |
| Technician accepts | The original Requester, and all Supervisors/HOD in the plant | Accepted |
| Technician declines | All Supervisors/HOD in the plant (again) — deliberately **not** the Requester | Declined |
| Technician starts work | The original Requester | Work started |
| Technician marks Completed | The original Requester | Completed — please verify |
| Requester reopens | The assigned Technician | Reopened |
| SLA resolution target passed (newly flagged only) | All Supervisors/HOD in the plant | SLA Breach |

- Notifications are generated server-side only, never written directly by any client, so a notification's existence is always trustworthy evidence that its trigger actually occurred — a client cannot fabricate one.
- A recipient may mark their own notification read, and may **delete** their own already-read notifications. No other write is permitted by anyone, including the sender-side trigger logic — a notification, once created, is never edited.
- Deleting one destroys no audit trail. The status history is the record of what happened; a notification is only ever a copy of it addressed to somebody, which is why this is allowed where deleting a work order's history is refused outright (Section 14).
- Telling the Requester their work order was declined is deliberately omitted. A decline is an internal routing problem the ops chain resolves in minutes, and telling the person who reported the fault that nobody has taken it invites a second work order for the same fault. They can still see the decline, and its reason, in full on the status history.
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
| Plant | Required |
| Equipment | Required. Offered from the chosen Plant only |
| Which equipment | Required, minimum 3 characters — only when Equipment is "Other (specify)" |
| Complaint | Required, minimum 10 characters |
| Production impact | Required |
| Requester name | Required |
| Phone number | Required, at least 7 digits after stripping non-numeric characters |
| Safety risk severity | Required only if Safety risk = Yes |
| Photo | Optional, no minimum. Photos only — video is not accepted |

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
`fileUrl, fileType (photo|document), uploadedById, uploadedByName, uploadedByRole, uploadedAt, woStatus`

`uploadedByName` and `woStatus` record who uploaded the file and which step of the work order it documents, both captured at upload time and written by the server rather than supplied by the client. `fileType` retains `video` as a readable value: video upload was withdrawn in revision 1.3, but files stored before that remain viewable.

### 11.5 `notifications/{notificationId}`
`recipientId, recipientRole, woId, woNumber, type, title, body, status (Sent|Read), createdAt`

### 11.6 `counters/{counterId}`
`lastValue` — one document per calendar year (`WO-{year}`), used to generate the human-readable `woNumber` (format: `WO-{year}-{6-digit sequence}`, e.g. `WO-2026-000001`) as a single global sequence, not per-plant.

### 11.7 Referenced, not owned by this module
`users/{uid}`: `name, role, phone, skills, plantIds` — read by this module for display and authorization context; never written by it.

---

## 12. Permissions

An account holding several roles gets the union of its columns (Section 2.1).
Administrator is omitted as a column because the answer is uniform: an
Administrator holds every capability below, on any work order in the plant.

| Capability | Requester | Technician (assignee) | Technician (not assignee) | Supervisor | HOD |
|---|---|---|---|---|---|
| Create a work order | Own identity only | — | — | On behalf of others | On behalf of others |
| Read a work order | Own only | Assigned, plus any they raised | Any they raised | Any in-plant | Any in-plant |
| Assign / reassign technician (before acceptance → `Assigned`; at/after acceptance → status unchanged) | — | — | — | ✔ | ✔ |
| Accept / decline | — | ✔ | — | — | — |
| Start work; advance repair/testing steps | — | ✔ | — | — | — |
| Mark waiting on spare part / resume | — | ✔ | — | — | — |
| Mark Completed | — | ✔ | — | — | — |
| Verify & close | ✔ (work orders they raised) | ✔ (work orders they raised) | ✔ (work orders they raised) | ✔ (work orders they raised) | ✔ (work orders they raised) |
| Reopen | ✔ (work orders they raised) | ✔ (work orders they raised) | ✔ (work orders they raised) | ✔ (work orders they raised) | ✔ (work orders they raised) |
| Force verify & close override | — | — | — | — | ✔ (Completed status only, and only on a work order somebody else raised) |
| Add progress log entry | — | ✔ (active statuses only) | — | — | — |
| Read progress log / status history / attachments | ✔ | ✔ | ✔ (if otherwise permitted to read the WO) | ✔ | ✔ |
| Add attachment | ✔ (own WO) | ✔ (assigned WO) | — | — | — |
| Delete attachment | — | — | — | — | ✔ |
| Delete a work order | Only if granted, own only | Only if granted, assigned only | — | Only if granted | Only if granted |
| Mark a notification read | Own notifications only | Own notifications only | Own notifications only | Own notifications only | Own notifications only |

This table should match the enforced authorization logic exactly. Any divergence between this table and the enforced logic is a defect, not a matter of interpretation.

### 12.1 Capabilities reserved to the Superuser
Three things no Administrator may do, because each of them would let one
Administrator take over another person's account or quietly widen their own
authority:

- Set another person's password, or change another person's sign-in address.
  These are restricted **together**: repointing somebody's address at a mailbox
  you control and then using the public password-reset flow reaches the same
  place, so restricting either one alone achieves nothing. Correcting your own
  address, and changing your own password, are not restricted.
- Switch work order deletion on or off for a role (Section 12.2).
- Retire or restore a reference value — a priority, an impact level, a work
  order type, a safety severity, a department or a piece of equipment.

What an Administrator uses instead of setting a password is sending the person a
recovery link.

### 12.2 Deleting a work order
Irreversible, and deliberately awkward.

- **It must be granted.** There is one switch per role. Only a Superuser may
  change them, and they ship with Administrator on and every other role off.
- **Granting it never widens what somebody can see.** A granted Requester
  reaches their own work orders; a granted Technician reaches those assigned to
  them; a granted Supervisor or HOD reaches any work order in the plant. The
  grant answers "may this role delete", never "which records can this role
  reach" — those stay exactly as Section 12's Read row defines them.
- **The Superuser can always delete**, switches or not. The account that holds
  the switches cannot flip its own way out of fixing a mistake.
- **What goes with it.** The work order's status history, progress log,
  attachments and any notifications referring to it are removed with it, and the
  stored files themselves are deleted from storage. A summary of the deleted
  work order — its number, equipment, department, status, priority, who raised
  it, who it was assigned to, and who deleted it and when — is written to a
  separate deletion record that is not itself deletable from the app.
- **A refused deletion says so.** It never silently does nothing.

Deleting a *person's account* is a different operation, governed by the account
administration rules rather than this module: it is reserved to the Superuser and
is refused outright for anybody who has ever acted on a work order, because that
would break the audit trail Section 14 requires. Deactivation is the answer for a
person who has worked.

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
| 1.3 | 2026-08-27 | Priority override removed — priority is derived from Production Impact and the two risk flags and cannot be set by anyone; the escalation rules are unchanged. Estimated downtime is no longer collected. Video attachments are no longer accepted, though files stored earlier remain viewable. Attachments now record the uploader's name and the step of the work order they document. Accept notifications and a recipient's right to delete their own read notifications are documented. Sections 4, 6, 7.3, 8, 10.1 and 11.4 updated to match. |
| 1.4 | 2026-08-27 | The role model corrected: an account holds any combination of roles and its authorization is their union, seniority is the highest role held, nobody assigns work to themselves, and a role-switching control is a view control only (new Section 2.1). Administrator and Superuser added to the role table; HOD recorded as being implemented under the name Manager. Section 4 rule 7's "a work order is never deleted" replaced — deletion exists, must be granted per role, and is off for everyone but Administrator by default (new Section 12.2). Superuser-only capabilities documented (new Section 12.1). Section 12's table amended. |
| 1.5 | 2026-08-27 | "Requester" clarified to mean the person who raised the work order rather than an account holding the Requester role. Consequences: a Supervisor or Technician who reports a fault can now see, verify, reopen and edit it, where previously the work order became invisible to a Technician the moment they submitted it; and an Administrator or HOD who reports one verifies it the ordinary way instead of being offered the unresponsive-requester override on their own work order. Section 4 rule 5 and Section 12 updated to match. |

This document, not any prior individual design artifact, is the specification of record for the Work Order Management module going forward.
