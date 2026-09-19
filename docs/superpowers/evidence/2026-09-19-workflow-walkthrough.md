# Workflow walkthrough — SI-CMMS staging, 2026-09-19

Target: https://si-cmms-push-test.vercel.app (SI-CMMS-test Supabase project). Manual browser
walkthrough of the raise-to-signed-off work order journey, plus the SLA-branch-specific
variations (P8, Extend SLA, priority override) and role-boundary checks. No code, migrations
or data were changed; only work orders were created/transitioned through the UI as instructed.

## 1. Verdict

**Yes** — a work order can go from raised to signed-off with no dead button, no stuck
spinner, and no silent failure. The full clean walk (Requester → Supervisor → Technician →
HOD) completed without incident on WO-2026-000047. Every transition, confirmation dialog and
guard behaved exactly as CLAUDE.md documents.

Two real (non-blocking) issues were found and are recorded below — a copy bug in the SLA
caption, and a display inconsistency after re-grading a P8 work order down to a severity
priority. Neither stops anyone from completing a work order.

## 2. The walk, step by step

| # | Role | Action | Result | Console/network |
|---|---|---|---|---|
| 1 | Requester (Ravi Kumar) | Raised WO-2026-000047, Production F1, Air Compressor 1000 K/P, Breakdown, impact "Running at reduced capacity" | Created as **P2**. SLA preview showed 15 min / 45 min / 7 hrs before submit, matched exactly after submit. Equipment picker correctly scoped to the chosen plant; criticality/machine-code strip rendered. | Clean except the RSC-prefetch 404 noise described in §3.6 |
| 2 | Supervisor (Priya Nair) | Opened WO-047 from "Waiting for assignment", assigned to Arun Kumar | Button showed "Assigning…" with a spinning icon (per-row state, not a global-disable). `SentDialog` confirmed correct wording for a pre-acceptance assignment. Status → Assigned, Response SLA "45m left". | Clean |
| 3 | Technician (Arun Kumar) | Accepted → Start Work → Start Testing → Mark Completed (with notes) | Each move landed on the correct next Workflow-tab prompt. Resolution SLA showed "7h 0m left" on entering Repairing, matching P2's target. Completing auto-closed the work order in the same action (0061 behaviour) — no separate close step, no need for it. | Clean |
| 4 | HOD (Rajesh Menon) | Opened "Waiting for you to verify", pressed Verify, confirmed the "Yes, verify" button is inert with an empty note, typed a note, confirmed | Verify with no note did nothing (no request fired, no error) — correct per 0063's requirement. With a note, verification succeeded; Workflow tab showed "Completed and verified. Nothing further is needed." | Clean |
| 5 | — | Reviewed Status Timeline for WO-047 | All eight rungs present and correctly ordered/labelled including "Waiting Spare Part — Pending" (a rung never reached) and the "Verified" sub-entry with the HOD's note. No `null`/`undefined`/`Invalid Date` anywhere. | — |
| 6 | Requester's own list / dashboards | Confirmed WO-047 shows "Closed" everywhere it should | Consistent across Requester and Supervisor dashboards. | — |

## 3. Variations tested

### 3.1 P8 "Scheduled work (month-scale)"
Raised WO-2026-000048 (Maintenance / F2 / Batching Plant / Project type) with impact
"Scheduled work (month-scale)". SLA preview before submit showed **P8**, teal badge, 5 days /
5 days / 20 days (= 30 days total, matches the documented table). After submit the Overview
page rendered the same figures with no NaN/Invalid Date/null, and the SLA card correctly
showed "Acknowledge 5d 0h left · Running" rather than a countdown error. On the work order
list, the P8 badge rendered in a distinct teal, visually different from P7's violet and from
the grey "broken lookup" fallback colour.

Admin dashboard's **P8 Scheduled** card read 1, and P1(6)+P2(7)+P3(4)+P4(5)+P7(0)+P8(1) = 23 =
**Total Open** — the priority bands sum correctly with P8 included.

### 3.2 Technician decline
Assigned WO-048 to Meera Iyer, signed in as Meera, opened Workflow tab, clicked "Can't take
this one". The reason field and "Confirm decline" appeared; "Confirm decline" was inert until
a reason was typed (correct — no request fired on the empty attempt). A "Decline
WO-2026-000048?" confirmation dialog appeared quoting the typed reason back, as documented.
Confirming routed Meera away from the work order page to `/work-orders/` and showed a toast
"Declined — WO-2026-000048 sent back for reassignment." The work order disappeared from her
list.

### 3.3 Extend SLA
- On a work order already carrying **P8** (the lowest-urgency priority), Extend SLA correctly
  refused with a plain-English message: "There is no lower priority to move this work order
  to, so its SLA cannot be extended further." No crash, no confusing state — a well-written
  refusal exactly matching the "deliberately surfaced verbatim" rule for good server messages.
- On WO-2026-000039 (P2, 68 days overdue, unassigned), Extend SLA opened a dialog listing P3 /
  P4 / P7 / P8 as options, each annotated with the new deadline and "· still overdue" (since
  68 days late cannot be un-lated by a few hours' extension) and P8 pre-marked "Suggested".
  Selecting P4 updated the confirm button label live to "Yes, extend to P4". Confirming
  succeeded: priority badge changed to P4, and the Status Timeline gained an "SLA extended"
  sub-entry under "Open" reading "SLA extended: High (P2) → Low (P4). Acknowledge stage now
  due 13/07/2026 17:53." with the Administrator's name and timestamp.
- On a **freshly raised, non-overdue** work order (WO-048, "4d 23h left"), the Extend SLA
  button was **absent** — only Edit / Change priority / Delete showed. Confirms the button is
  correctly gated on being overdue or near-due, not shown unconditionally.

### 3.4 Change priority (older Administrator action, alongside the new one)
On WO-048 (still P8 at this point), opened Change priority, selected P1 Critical. A reason
field enforced the documented 10-character minimum (button stayed disabled until enough text
was entered — confirmed by testing with an empty reason first). Confirmed the change:
priority badge became P1, Acknowledge SLA recomputed from the original raise time down to "1m
left" (P1's 5-minute ack window against a work order raised minutes earlier — expected, not a
bug). The change is recorded as expected.

### 3.5 Role boundary check
Signed in as **Manager** (Vikram Shah) and opened the same overdue work order (WO-039, now
P4). Only an **Edit** button was present — no Change priority, no Extend SLA. Confirms both
actions are correctly restricted to Administrator and are not leaking to Manager, matching
CLAUDE.md's "Administrator only" statement for both features.

### 3.6 Non-blocking framework noise (checked, not a work-order bug)
Every page load/navigation on this static export throws a fixed pattern of console errors:
`GET .../__next.<page>.__PAGE__.txt?_rsc=... → 404`. This happens on *every* route change
regardless of whether the action succeeded, including the fully successful ones in the clean
walk. It is Next.js's RSC-prefetch mechanism trying to fetch a server component payload that
does not exist on a static export (`output: "export"`), not a symptom of any work-order
action failing — the underlying page and its data always loaded correctly in the same
sequence. Logged once here rather than repeated at every step in the table above.

## 4. Findings, worst first

None of the following block the raise-to-signed-off journey. Listed worst-first by
impact.

1. **[Cosmetic, data-consistency] Re-grading a work order away from P8 leaves a contradictory
   impact label.** After using Change priority to move WO-048 from P8 ("Scheduled work
   (month-scale)") down to P1 ("Critical"), the Overview page continued to show "Production
   impact: Scheduled work (month-scale)" next to "Priority: P1" — i.e. "Scheduled work
   (month-scale) · P1", the mirror image of the exact contradiction migration 0073 fixed for
   the P7/P8-*target* direction ("Full production stoppage · P7"). 0073's fix in
   `si_override_work_order_priority` only rewrites `impact` when the *new* priority is P7 or
   P8; it does not restore a severity-appropriate impact when overriding *away* from P8 (or
   P7) back to P1–P4. Not a crash and not visible to non-Administrators (impact/priority
   detail is shown to everyone, so this is user-visible, just confusing rather than broken).
   Where: `WorkOrderDetail` Overview tab, `si_override_work_order_priority` (migration
   0051/0073). Not a blocker.

2. **[Cosmetic, copy bug] The SLA preview/warning text always calls the target "a long-term
   task", regardless of the actual priority.** Seen twice: (a) on the raise form, choosing
   "Running at reduced capacity" (**P2**) still showed the caption "A long-term task is
   measured in stages: each window starts when the one before it is met, not when the job is
   raised." under the SLA preview; (b) in the Change-priority dialog, selecting **P1
   Critical** produced the warning "Its SLA deadlines are recomputed from when it was raised,
   against **P1** — a long-term task, measured in stages: 5 min to assign, then 10 min after
   assignment, then 3 hrs 45 min after work starts." P1 and P2 are not long-term tasks; this
   phrasing was presumably written when only P7 (and later P8) were sequential, and 0067 made
   every priority sequential without updating the caption to be priority-neutral. Purely
   textual — the numbers themselves were correct throughout. Not a blocker.

3. **[Non-issue, documented for completeness] Constant RSC-prefetch 404s in the console on
   every navigation.** See §3.6. Framework artifact of the static export attempting Next.js
   RSC prefetches that have no server to answer them; happens on every single page load
   including fully successful ones, carries no failed data fetch and no visible symptom.
   Flagging so it isn't mistaken for a hidden failure by a future reader of the console log,
   but it is not evidence of anything actually failing.

No button was found that did nothing when pressed. No spinner was found stuck indefinitely —
row-scoped "Assigning…"/"Declining" states worked as designed, matching the fix CLAUDE.md
describes for the historical global-disable and non-spinning-icon bugs. No raw database/RLS
text was surfaced anywhere in this walk. No `null`/`undefined`/`NaN`/`Invalid Date` was seen
in any SLA figure, including the new P8 figures.

## 5. What could not be tested

- **Waiting Spare Part detour and P8/P1 resolution-stage timing in practice** — the clean walk
  went straight through Repairing → Testing without needing a spare part, so the
  `waiting_spare_part ⇄ repairing` cycle and its own notification (0056) were not exercised
  live in this session (existing rows on test already show this stage was used by other
  seeded data).
- **Web/OS push notification delivery** (status bar, chime) — not observable through the
  browser-automation tools used here; would need a real device or a service-worker inspection
  session.
- **Multi-tab/session race conditions** (e.g. two Supervisors assigning the same work order at
  once) — outside the scope of a single-browser walkthrough.
- **The security advisor** — cannot be run from here; not relevant to this functional walk in
  any case.
- **Android/APK build** — out of scope per project convention (web-only staging target).
