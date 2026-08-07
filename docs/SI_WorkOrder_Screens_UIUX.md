# SI — Service Inside
## Work Order Management Module — Complete Screen Specification
**Version 1.0 · July 22, 2026 · UI/UX only — no backend, per instruction**
**Design system:** Navy `#0F3D91` / Orange `#F59E0B` / Green `#22C55E` / Red `#EF4444`, Inter, 12px radius
**Roles:** Requester · Technician · Supervisor · HOD

---

## 0. How to Read This Document

Screens 4–8 (Assign Technician, Technician Job Screen, Progress Update, Complete Work Order, Requester Verification) are **tabs inside Work Order Details on desktop**, but each becomes its **own full-screen mobile view**, reached via the sticky action button — a phone screen can't hold a six-tab strip the way a desktop card can. Screen 9 (Work Order History) is the Status Timeline tab on desktop and its own screen on mobile for the same reason. This split is called out explicitly in each screen below rather than left implicit.

Status colors are the same six meanings everywhere in the module — restated per screen for completeness, not because they ever change:

| Status | Color |
|---|---|
| New, Assigned | Navy `#0F3D91` |
| Accepted, In Progress | Orange `#F59E0B` |
| On Hold | Slate `#64748B` |
| Resolved | Amber `#F59E0B` (distinct label, same hue as In Progress by design — "still open, just at a different gate") |
| Verified, Closed | Green `#22C55E` |
| SLA breached (any status) | Red `#EF4444` |

Priority colors: **P1** Red · **P2** Orange · **P3** Amber-tint `#FBBF24` · **P4** Navy.

---

## 1. Work Order List

**Purpose:** Entry point for every role — Requester's "My Work Orders," Technician's "My Tasks," Supervisor/HOD's full oversight list.

### Desktop Layout
Left sidebar (Work Orders nav item, user identity, sign-out) + top bar (search, notification bell, role badge) + content: page header (role-specific title + count) → conditional alert banner → filter row → table.

### Mobile Layout
Top app bar (title + filter icon) → conditional alert banner (full-width, dismissible) → horizontal filter chip row (Priority, Status — scrollable) → **card list** replacing the table (table columns don't fit; each card shows WO#, equipment name, priority + status badges stacked, SLA countdown, department) → bottom tab bar (Tasks/List, Raise, Notifications, Profile).

### Buttons
| Button | Location | Action |
|---|---|---|
| Raise Work Order | Header, top-right (hidden for Technician role) | Navigate to Screen 2 |
| Export | Filter row | Download current filtered view as CSV |
| Filter icon (mobile) | App bar | Expands filter chip row / opens filter sheet |
| Row / card (tap) | List body | Navigate to Screen 3 (Work Order Details) |

### Input Fields
| Field | Type | Notes |
|---|---|---|
| Search | Text input | Matches WO number or equipment name, debounced 250ms |
| Priority filter | Select / chip group | All, P1, P2, P3, P4 |
| Status filter | Select / chip group | All + every status in the flow, plus On Hold |

### Validation Rules
None — this is a read screen. Search and filters are non-blocking; an empty result set is handled by the empty state, not an error.

### User Actions by Role
- **Requester:** views own submissions only; taps a card to check status.
- **Technician:** views only assigned tasks; sees a banner when something needs their Accept/Decline response.
- **Supervisor / HOD:** views everything in scope; sees a banner counting work orders still unassigned.

### Status Colors
Badges rendered exactly as the global map (Section 0). Priority badge always precedes status badge, left to right, in both table row and card.

### Empty State
Centered, single line, role-aware:
- Requester: *"You haven't raised any work orders yet."* + inline "Raise your first one" link.
- Technician: *"No tasks assigned to you right now."*
- Supervisor/HOD: *"No work orders match these filters."*
No illustration — text-only, consistent with the system's restrained, data-dense character.

### Error State
If the list fails to load (network/permission): a full-width banner above the (empty) table — Red-tinted background, "Couldn't load work orders. Check your connection and try again," with a **Retry** button. The filter row and header still render so the screen doesn't feel broken, only the data area shows the error.

---

## 2. Raise New Work Order

**Purpose:** The Requester's (or Supervisor/HOD's, on someone's behalf) entry point for reporting a problem.

### Desktop Layout
Two-column: left/main column (form, ~65% width) with grouped fields in a single scrollable card; right column (~35%, sticky) shows the live SLA Preview panel (Navy card, mirrors whatever priority is currently in effect).

### Mobile Layout
Single column, full-width fields stacked top to bottom in the exact required order (Department → Equipment → Complaint → Priority → Auto Priority Suggestion → Production Impact → Upload Photo → Upload Video → Estimated Downtime → Safety Risk → Environmental Risk → Requester → Phone). The SLA Preview collapses into a **dismissible summary strip** right above the sticky Submit button rather than a sidebar (no room for two columns). Photo/video upload buttons open the camera directly, not a file picker.

### Buttons
| Button | Action |
|---|---|
| Submit | Validates all fields; on success creates the work order (status `New`) and opens Screen 3 |
| Cancel | Returns to Screen 1; confirms first if any field has been touched |
| Apply → (inside Auto Priority Suggestion box) | Only visible once priority has been manually overridden away from the suggestion; snaps it back |
| P1 / P2 / P3 / P4 (priority selector) | Manually overrides the auto-suggested priority |
| Upload photo / Upload video | Opens file picker (desktop) or camera (mobile) |
| ✕ on each thumbnail/file chip | Removes that attachment before submit |
| Yes / No (Safety risk, Environmental risk) | Toggles the risk flag |
| Low / Medium / High (Safety severity, shown only if Safety risk = Yes) | Sets severity, which drives escalation |

### Input Fields
| Field | Type | Required |
|---|---|---|
| Department | Select | Yes |
| Equipment | Select (searchable) | Yes |
| Work order type | Segmented control (Breakdown/Inspection/Project) | Defaults to Breakdown |
| Complaint | Textarea | Yes |
| Priority | Segmented control P1–P4 | Defaults to auto-suggestion |
| Production impact | Radio list (4 options, each showing its suggested priority) | Yes |
| Photo | File/camera, multiple | No |
| Video | File/camera, multiple | No |
| Estimated downtime | Number + unit (Hours/Days) | Yes |
| Safety risk | Yes/No toggle, + severity if Yes | No (defaults No) |
| Environmental risk | Yes/No toggle | No (defaults No) |
| Requester | Text, prefilled from logged-in identity | Yes |
| Phone number | Text | Yes |

### Validation Rules
| Field | Rule | Error message |
|---|---|---|
| Department | Must be selected | "Select a department." |
| Equipment | Must be selected | "Select the affected equipment." |
| Complaint | Minimum 10 characters | "Describe the complaint (min. 10 characters)." |
| Production impact | Must be selected | "Select the production impact." |
| Estimated downtime | Must be a positive number | "Estimate the downtime." |
| Requester | Non-empty | "Requester name is required." |
| Phone number | At least 7 digits after stripping non-numeric characters | "Enter a valid phone number." |

All errors render inline, directly under the offending field, in Red, on Submit attempt (not on blur — this is a longer form and per-field validation-on-blur would feel naggy). The Submit button never disables preemptively; it always attempts submission and surfaces errors together so the Requester can fix everything in one pass.

### User Actions by Role
- **Requester:** fills and submits under their own identity.
- **Supervisor / HOD:** may fill this out on behalf of a Requester (e.g., phoned-in report); Requester field is editable rather than locked.
- **Technician:** not a primary flow for this role, but not blocked — the "Raise Work Order" entry point is simply hidden from Technician's list screen rather than the form itself being restricted.

### Status Colors
Priority segmented control and the impact radio list's badges use the standard P1–P4 colors. The Auto Priority Suggestion box tints its background/border in whatever color the current suggestion is, so the color itself reinforces the recommendation before you've even read the text.

### Empty State
Not applicable — a create form has no "empty" condition; every field starts blank by design and that blank state is the normal state, not an edge case.

### Error State
Submission failure (e.g., network drop on submit): the Submit button returns to its normal state (no more spinner), and a Red banner appears above the form: *"Couldn't submit this work order. Your entries are still here — try again."* Nothing the Requester typed is lost.

---

## 3. Work Order Details

**Purpose:** The shared shell every role lands on after opening a work order — header + tab strip that routes to Screens 4–9.

### Desktop Layout
Back link → header row (WO# in mono, priority badge, status badge, equipment name as page title, SLA countdown chip top-right, Red-tinted if breached) → horizontal tab strip (Overview, Assignment, Progress Log, Attachments, Status Timeline, Workflow) → active tab's content in a single white card below.

### Mobile Layout
Back arrow + condensed header (WO# and equipment name only, badges wrap to a second line if needed) → SLA chip moves inline under the header, full width → **tabs become a horizontal scroll strip** of pills rather than an underline strip (more thumb-friendly) → content below. Because this is the shell for Screens 4–9, on mobile each tab tap is really a navigation to that screen, not just a content swap — the back arrow always returns here, to this shell, from any of them.

### Buttons
| Button | Action |
|---|---|
| Back to Work Orders | Returns to Screen 1 |
| Overview / Assignment / Progress Log / Attachments / Status Timeline / Workflow (tabs) | Switches active content |

### Input Fields
None on the Overview tab itself — it is a read-only summary (Equipment, Department, Type, Production impact, Estimated downtime, Requested by, Requester phone, Safety risk, Environmental risk, Permit/LOTO required, Complaint text, SLA targets table). Fields with values are populated at creation (Screen 2) and never edited here directly.

### Validation Rules
None — read-only screen.

### User Actions by Role
Identical viewing rights for all four roles (any role that can open the work order can read every field on Overview) — the *restriction* lives in the Workflow tab (Screen 8-equivalent logic) and Assignment tab (Screen 4), not here.

### Status Colors
Header badges per Section 0. The SLA chip background flips from neutral gray to Red the instant `now > slaResolutionDueAt` and status isn't `Closed` — this is the same live check used in the list and the Traffic Light concept elsewhere in SI.

### Empty State
Not applicable to Overview (a work order always has its core fields once created).

### Error State
If the specific work order fails to load (bad/stale link, deleted record, permission revoked mid-session): full-screen replacement of the tab shell with a single message — *"This work order couldn't be found or you no longer have access to it."* + a **Back to Work Orders** button. No partial/broken tab strip is ever shown underneath.

---

## 4. Assign Technician

**Purpose:** Supervisor/HOD's screen (desktop tab / mobile full screen) to put a name on a `New` work order, or reassign later.

### Desktop Layout
Tab content within Screen 3: a status line ("Currently assigned: —" or a name), then a vertical list of technician cards (avatar initials, name, skill tags, open-job count, an **Assign** button per card). A "Best match" tag highlights whichever technician's skills overlap the equipment/department.

### Mobile Layout
Same card list, full width, one column — this tab already reads as a list on desktop so it needs no real restructuring for mobile, just larger tap targets (44px minimum) on the Assign button per card.

### Buttons
| Button | Action |
|---|---|
| Assign (on an unassigned technician's card) | Sets that technician as assignee, status `New → Assigned`, notifies the technician |
| Reassign (replaces "Assigned" label once someone is already assigned) | Swaps assignee, keeps status at `Assigned` (does not reset the flow, since acceptance hasn't happened yet) |

### Input Fields
None — this is a selection screen, not a form. There is no search/filter field in v1 given the technician roster is small; a "search technicians" field is a natural v2 addition once the roster grows past a page.

### Validation Rules
- The Assign/Reassign action is **not available at all** (buttons don't render) for Requester or Technician roles — this isn't a disabled-button state, the controls simply don't exist for those roles, reinforced by an inline note: *"Only a Supervisor or HOD can assign or reassign a technician."*
- No technician can be assigned to a work order that is already `Resolved`, `Verified`, or `Closed` — the tab still shows history (who was assigned) but the action buttons disappear once the job has moved past active work.

### User Actions by Role
- **Supervisor / HOD:** the only roles with live Assign/Reassign buttons.
- **Technician / Requester:** view-only — can see who's assigned, cannot change it.

### Status Colors
The currently-assigned technician's card gets an Orange-tinted background and border to visually separate it from the rest of the roster at a glance.

### Empty State
Not the roster itself (the technician list is a fixed lookup, never empty) — but if the work order has no one assigned yet, the status line explicitly reads *"Unassigned — waiting on Supervisor"* rather than leaving a blank space, so every role immediately understands why nothing is happening yet.

### Error State
If the assignment write fails (e.g., a stale work order was already reassigned by someone else a moment earlier): the tab shows a Red inline banner — *"Couldn't assign — this work order may have just been updated. Refresh and try again."* — and reloads the current assignment state rather than trusting the local optimistic update.

---

## 5. Technician Job Screen

**Purpose:** The Technician's primary working view once a job is `Assigned` through `In Progress` — this is the screen a Technician actually lives in on the shop floor.

### Desktop Layout
This is the Workflow tab of Screen 3 for a Technician viewer, plus the Overview/Attachments tabs alongside it — on desktop it's genuinely a multi-tab experience since there's room.

### Mobile Layout
**This is where mobile diverges most from desktop.** Rather than tabs, the Technician's phone shows a single vertical scroll: equipment summary card (photo placeholder, name, criticality) → complaint text → the current Workflow action block (Accept/Decline, or Attend, or Put on Hold/Mark Resolved, depending on status) pinned as a **sticky button at the bottom of the viewport** → progress log entries and an inline "add note" field below the fold → attachments grid at the very bottom. A Technician never has to hunt through tabs mid-job with greasy gloves on; everything relevant to *right now* is in one thumb-reachable stack.

### Buttons
| Button | Status it appears in | Action |
|---|---|---|
| Accept | `Assigned` (viewer is assignee) | → `Accepted` |
| Decline | `Assigned` (viewer is assignee) | Reveals a reason field; on confirm → back to `New`, unassigned |
| Attend / Start job | `Accepted` (viewer is assignee) | → `In Progress` |
| Put on hold | `In Progress` (viewer is assignee) | → `On Hold` |
| Resume | `On Hold` (viewer is assignee) | → `In Progress` |
| Mark Resolved | `In Progress` (viewer is assignee) | Reveals resolution notes field; on confirm → `Resolved` |
| Log (progress note) | `Accepted` / `In Progress` / `On Hold` (viewer is assignee) | Appends a timestamped entry, does not change status |

### Input Fields
| Field | Appears when | Required to proceed |
|---|---|---|
| Decline reason | Decline tapped | Yes — Confirm decline stays disabled until non-empty |
| Progress note | Always (if assignee, active statuses) | No — logging is optional per entry |
| Resolution notes | Mark Resolved tapped | Yes — Submit for verification stays disabled until non-empty |

### Validation Rules
- Every action button here is **role- and identity-gated**, not just status-gated: a Technician who is *not* the assignee sees the same screen in **read-only** form (a plain status sentence, no buttons) — this is the single most important rule on this screen, since two technicians could otherwise both try to act on the same job.
- Decline and Mark Resolved cannot be confirmed with an empty reason/notes field (button stays disabled, not merely validated-on-click) — this is intentionally stricter than the Raise Work Order form, because these actions are irreversible workflow transitions, not editable draft data.

### User Actions by Role
- **Technician (assignee):** the only role with live buttons on this screen.
- **Technician (not assignee), Requester, Supervisor, HOD:** see the same information, presented as plain sentences ("Assigned to Karan Mehta — waiting for them to accept") with zero interactive controls, so the screen never looks broken, just inert for that viewer.

### Status Colors
Matches Section 0 exactly. The sticky action button itself is colored by *urgency of the action*, not the status: Accept/Attend/Resume use Green (success — move it forward), Put on hold uses neutral Ghost styling, Decline uses Red, Mark Resolved uses Green.

### Empty State
The progress log section, specifically: *"No progress logged yet."* — shown only to the extent the log is genuinely empty; the input field to add the first note is still present above this message so there's an obvious next action.

### Error State
If a status-changing tap fails to save (connectivity drop mid-shift is the realistic case here, given the mobile/shop-floor context): the button reverts to its pre-tap state, and a small inline Red note appears directly beneath it — *"Not saved — check your connection and try again."* The attempted note/reason text the Technician typed is preserved in the field, not cleared, so nothing has to be retyped.

---

## 6. Progress Update

**Purpose:** Technically the same tab as part of Screen 5 on both platforms, called out as its own numbered screen because logging progress is a distinct, repeatable action independent of any status change — a Technician may log five updates across a single `In Progress` period.

### Desktop Layout
A text input + Log button pinned at the top of the Progress Log tab, with the log itself below, newest entry first. Each entry is a Canvas-tinted card: note text, then "actor · timestamp" caption.

### Mobile Layout
Identical structure, full width; the input field and Log button sit just below the sticky Workflow action button described in Screen 5 rather than in a separate tab, since mobile collapses tabs into one scroll as noted above.

### Buttons
| Button | Action |
|---|---|
| Log | Appends the current input text as a new entry, then clears the field |
| (Enter key, desktop) | Equivalent to tapping Log, for faster repeated entries |

### Input Fields
| Field | Type | Required |
|---|---|---|
| Progress note | Single-line text input | Non-empty to enable Log |

### Validation Rules
- Log button is disabled while the input is empty or whitespace-only.
- No maximum length is enforced in the UI (a Technician might paste a longer diagnostic note); the field will simply wrap.
- Only the current assignee, and only while the work order is `Accepted`, `In Progress`, or `On Hold`, sees the input at all — once `Resolved`, the log becomes read-only history (the input row disappears entirely, it does not merely disable).

### User Actions by Role
- **Technician (assignee, active statuses):** can add entries.
- **Everyone else, at any status:** can read the full log, never add to it.

### Status Colors
Not status-driven — entries are neutral Canvas-tinted regardless of what status the work order was in when logged; color is reserved for the badges above, not for log content.

### Empty State
*"No progress logged yet."* (identical wording to Screen 5, since this is literally the same panel) — input row still visible above it if the viewer is permitted to log.

### Error State
A failed log-append: the typed text stays in the input (not cleared), and a small Red caption appears beneath the input — *"Couldn't save that update — try again."* — so a Technician never loses a note they just typed because of a dropped connection.

---

## 7. Complete Work Order

**Purpose:** The specific moment inside Screen 5's Workflow tab where a Technician declares the job done — "Mark Resolved."

### Desktop Layout
Within the Workflow tab: an info line explaining the two paths forward (log more, or resolve), then a **Put on hold** / **Mark Resolved** button pair. Tapping Mark Resolved expands an inline resolution-notes textarea directly beneath, with a **Submit for verification** button that only enables once notes are present.

### Mobile Layout
Same expand-in-place pattern, anchored to the sticky action button at the bottom of the Technician Job Screen (Screen 5) — tapping "Mark Resolved" grows the sticky area upward to reveal the textarea rather than navigating to a separate page, keeping the Technician's thumb in the same spot.

### Buttons
| Button | Action |
|---|---|
| Mark Resolved | Reveals the resolution-notes field (no state change yet) |
| Submit for verification | Confirms → status `Resolved`; disabled until notes are non-empty |
| (implicit) Cancel | Collapsing the notes field back without submitting is done by tapping Mark Resolved again / tapping elsewhere — no separate Cancel button, since nothing has been committed yet |

### Input Fields
| Field | Type | Required |
|---|---|---|
| Resolution notes | Textarea, 3 rows | Yes — describes what was done, and this exact text is what the Requester reads on Screen 8 |

### Validation Rules
- Submit for verification is disabled (not just validated-on-click) while resolution notes are empty — this mirrors Decline's strictness on Screen 5 for the same reason: it's an irreversible transition, not a draft.
- Only the current assignee can see this control at all; it does not exist for any other viewer of the same work order at this status.

### User Actions by Role
- **Technician (assignee):** the only role that can trigger this.
- **Supervisor / HOD / Requester:** see the work order sitting at `In Progress` with a passive sentence ("X is attending to this work order") until the Technician actually resolves it — no one else can shortcut this step.

### Status Colors
The Mark Resolved / Submit for verification buttons use Green (success direction). Once submitted, the status badge updates immediately to `Resolved`'s Orange/Amber, which is the visual cue that this isn't fully "done" yet — it's handed off, not closed.

### Empty State
Not applicable — this is a momentary action, not a list/data view.

### Error State
If the resolve action fails to save: the notes text remains in the textarea (never cleared) and the button reverts from a loading state to "Submit for verification," with a Red caption: *"Couldn't mark this resolved — try again."* The status badge does not change until the save actually succeeds, so there's never a moment where the UI claims `Resolved` but the transition didn't take.

---

## 8. Requester Verification

**Purpose:** The Requester's (or HOD-override) screen to confirm the fix actually worked — the step that turns `Resolved` into `Closed`.

### Desktop Layout
Within the Workflow tab, when the viewer is the requester and status is `Resolved`: an info line ("The technician marked this resolved. Please verify the fix before it's closed"), then a **Confirm fixed — Close** / **Not fixed** button pair. "Not fixed" expands an inline reason field with a **Reopen** button.

### Mobile Layout
Same expand-in-place pattern as Screen 7, since a Requester checking on their reported issue is just as likely to be doing this from their phone on the floor as from a desk — the sticky-button treatment applies equally here on the Technician-facing screen's mirror image for the Requester.

### Buttons
| Button | Action |
|---|---|
| Confirm fixed — Close | Sets `verifiedBy`/`verifiedAt`, writes a `Verified` history entry immediately followed by a `Closed` entry, in one tap |
| Not fixed | Reveals the reopen-reason field (no state change yet) |
| Reopen | Confirms → status back to `In Progress` (skips re-assignment — same technician still owns it); disabled until a reason is entered |
| Force verify & close (HOD only, same status) | Same effect as Confirm fixed, available as an override so a stalled, unresponsive Requester doesn't block closure indefinitely |

### Input Fields
| Field | Type | Required |
|---|---|---|
| Reopen reason | Text input | Yes — what's still wrong, shown to the Technician when they're notified |

### Validation Rules
- Reopen is disabled until the reason field is non-empty, same pattern as every other irreversible-transition field on Screens 5–8.
- Confirm fixed / Close requires no additional input — the Technician's resolution notes (Screen 7) already stand as the record of what was done; the Requester's tap itself is the confirmation.
- The HOD override button only ever appears at this exact status for this exact role — it is not a general "HOD can close anything" control, deliberately narrow per the workflow's design intent.

### User Actions by Role
- **Requester (the original requester of this specific work order):** Confirm fixed or Not fixed/Reopen.
- **HOD:** the narrow override, visible only if the Requester hasn't acted.
- **Technician / Supervisor:** read-only — a passive sentence: "Waiting for the requester to verify the fix."

### Status Colors
Confirm fixed uses Green. Not fixed/Reopen uses Red — this is the one place in the module where a Red button represents a *legitimate, expected* action rather than a purely destructive one (reopening isn't a mistake, it's the workflow working correctly when a fix didn't hold), so its Red styling is paired with clear, non-alarming copy ("Not fixed") rather than anything implying fault.

### Empty State
Not applicable.

### Error State
If Confirm/Reopen fails to save: identical pattern to Screens 4, 6, and 7 — nothing typed is lost, the action button reverts, and a Red inline message prompts a retry. Specifically here: *"Couldn't verify this work order — try again."*

---

## 9. Work Order History

**Purpose:** The full, immutable Status Timeline — proof that the Requester→Supervisor→Technician→Requester loop happened, in order, with who and when for every step.

### Desktop Layout
The Status Timeline tab of Screen 3: a vertical stepper, one row per stage in the canonical flow (New, Assigned, Accepted, In Progress, Resolved, Verified, Closed), each with a filled/checked circle if reached, the actor + timestamp if that stage has occurred, or "Pending" in muted gray if not yet reached. A connecting line between circles fills Green as the flow progresses. A separate callout below the stepper surfaces the most recent remark if the work order is currently `On Hold`.

### Mobile Layout
Identical vertical stepper, full width, no structural change needed — a vertical timeline is naturally mobile-friendly already (this is one of the few desktop layouts that ports over unchanged).

### Buttons
None — this is a pure read/audit screen for every role.

### Input Fields
None.

### Validation Rules
Not applicable — nothing is editable here, by any role, ever. This is deliberate: the timeline is the module's audit trail, and an audit trail that could be edited wouldn't be one.

### User Actions by Role
Identical for all four roles: view only. There is no role for whom this screen has any interactive control.

### Status Colors
- Completed step (not current): filled Green circle with a checkmark.
- Current step: filled Orange circle, slightly larger ring.
- Not yet reached: light gray circle, "Pending" caption.
- On Hold callout (if applicable): Red-tinted background box beneath the stepper, showing the hold reason.

### Empty State
Never truly empty — the moment a work order exists, its first `New` entry exists too. The closest analog is a work order that has *only* its `New` entry (just raised, nothing else has happened yet): every step after the first renders normally as "Pending," which functions as its own empty-state messaging without needing a separate empty-state treatment.

### Error State
If the history subcollection fails to load separately from the rest of the work order (a plausible partial-failure case since it's a distinct read): the stepper skeleton still renders (all circles gray/pending) with a single Red line beneath it — *"Couldn't load the full history — try again."* — rather than leaving a blank tab, so the rest of Screen 3 remains usable even if this one tab's data hiccups.

---

## 10. Cross-Screen Consistency Notes

- **Every irreversible action across Screens 4–8** (Assign, Decline, Mark Resolved, Confirm fixed, Reopen) follows the same interaction pattern: primary button → inline expand for any required justification/notes → a second, explicitly-labeled confirm button that stays disabled until that input is non-empty. No irreversible action is ever a single tap with no chance to add context.
- **Every error state across the module** uses the same shape: a Red-tinted inline message near the point of failure, the user's in-progress input preserved (never silently cleared), and a retry path that doesn't require re-navigating away from where they were.
- **Every role-restricted control** is either fully present (with working buttons) or fully absent (replaced by a plain sentence) — never shown-but-disabled with no explanation. If a control could theoretically exist for a role but doesn't apply to their current context (e.g., Supervisor viewing `Assigned` before the technician has responded), the plain sentence explains what's being waited on, not just that the viewer can't act.

This document defines UI/UX only, for all nine screens — no backend/data-layer code, per your instruction.
