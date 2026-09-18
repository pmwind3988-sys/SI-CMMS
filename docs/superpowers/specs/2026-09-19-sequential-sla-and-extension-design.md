# Every SLA stage starts when the last one finished, and an Administrator may extend one

Date: 2026-09-19
Status: approved design, not yet implemented
Migrations: 0067, 0068, 0069 (numbers provisional — see "Migration numbering")

## What changes, in end-user terms

Three things, shipped together because each one is wrong without the others.

**A repair window is measured from the repair.** Today a P1 promises four hours
counted from the moment the fault was reported, so three hours spent finding a
technician comes out of the technician's four hours. From now on each stage's
clock opens when the previous stage actually finished: five minutes to assign
it, then ten minutes to get someone moving, then three hours forty-five to fix
it. The headline promise for each priority is the same number it has always
been.

**"Overdue" means the stage it is sitting in is late, and clears when it moves
on.** A work order that took nine minutes to assign shows as overdue during
those nine minutes and stops being overdue the moment it is assigned — the
missed acknowledge stage is still recorded and still shown on the work order's
own SLA panel, it simply stops occupying the dashboard's Overdue card, which
from now on answers "what is late right now" rather than "what has ever been
late".

**An Administrator can extend a work order that is running out of time.** A
button on the work order opens a dialog that has already worked out the
smallest priority step that buys enough time, shows how much time that is, and
asks yes or no. The extension is recorded on the work order's timeline with the
name of whoever granted it. **P8** is the new bottom rung: a month.

## Non-goals

- No change to who may do anything, anywhere. The authorization boundary is
  untouched.
- No change to sign-off. `verified_at` / `verified_by` are never written by any
  part of this.
- No new capability toggle. Extension is Administrator-only and inherent, for
  the reason 0051 gives about the priority being what the SLA is computed from.
- No retention or notification-volume work, though this adds one notification
  type's worth of traffic.

---

## 1. The sequential conversion

### 1.1 The numbers are a subtraction, not a re-authoring

Today's three targets are cumulative offsets from `created_at`. Sequential
targets are stage durations. Converting one to the other is
`stage(n) = cumulative(n) - cumulative(n-1)`, which preserves the total exactly
and preserves every intermediate deadline for a work order whose stages all
complete on time.

| | ack | response stage | resolution stage | total |
|---|---|---|---|---|
| P1 | 5 min | 10 min | 3 h 45 min | 4 hrs |
| P2 | 15 min | 45 min | 7 hrs | 8 hrs |
| P3 | 30 min | 3 h 30 min | 20 hrs | 24 hrs |
| P4 | 2 hrs | 22 hrs | 4 days | 5 days |
| P7 | 5 days | 3 days | 7 days | 15 days (unchanged) |
| P8 | 5 days | 5 days | 20 days | 30 days (new) |

In minutes: P1 `5 / 10 / 225`, P2 `15 / 45 / 420`, P3 `30 / 210 / 1200`,
P4 `120 / 1320 / 5760`, P8 `7200 / 7200 / 28800`.

`targets_are_sequential` becomes `true` for every row in `sla`. The column
stays rather than being dropped: it is what makes the model data rather than
code, and 0050's argument against `if priority = 'P7'` in two trigger bodies
holds just as strongly for `if true`.

Labels are re-authored to match ("3 hrs 45 min after work starts"), since
`resolution_target_label` is printed on the detail page.

### 1.2 The accepted consequence

A team that beats a stage target finishes earlier than it would have today:
respond to a P1 in two minutes and the repair is due at 3 h 47 min from the
raise, not 4 hrs. That is what the sequential model means and it is the
deliberate trade. It never works the other way — a stage that overruns does not
shorten the next one, because the next one starts when the previous stage
actually completed.

### 1.3 What has to change in the database

`si_sla_targets` keeps its shape; only the seed rows change, plus its hardcoded
fallbacks (`sequential := (p = 'P7')` becomes `true`, and the three `case`
fallbacks take the new numbers and gain P8).

`si_before_work_order_insert` needs no change at all: its `if v_seq` branch
already sets both later deadlines to NULL, and that branch is now always taken.

`si_stamp_work_order` needs no change to its sequential block either — it
already opens each stage's deadline from the previous stage's timestamp. It
does need the `closed` branch amended, see §2.3.

## 2. Per-stage breach, and a transient "overdue"

### 2.1 Why one column cannot do it

`sla_breached` is a permanent record. The export reports it, the FSD forbids
clearing it by the passage of time, and 0051 treats clearing it as an exception
requiring a named Administrator. The behaviour asked for here — overdue clears
when the stage advances — is the opposite. So they are different facts and get
different columns.

New on `work_orders`:

- `sla_ack_breached boolean not null default false`
- `sla_response_breached boolean not null default false`
- `sla_resolution_breached boolean not null default false`

Each is **sticky**: set when that stage's deadline passes with the stage not yet
complete, never cleared. These are what the work order's SLA panel shows stage
by stage and what the export reads.

- `sla_stage_overdue boolean not null default false`

**Transient**: true only while the currently-open stage is past its deadline.
This is what the dashboard's Overdue card counts.

`sla_breached` is kept and redefined as "any stage was ever missed" —
`sla_ack_breached or sla_response_breached or sla_resolution_breached`. Keeping
it avoids churning the export's heading and every reader that already has it.

### 2.2 Which stage is open

Derived, not stored, from the two stage timestamps and the status:

| condition | open stage |
|---|---|
| `acknowledged_at is null` | acknowledge |
| `responded_at is null` | response |
| status not in (`completed`, `closed`) | resolution |
| otherwise | none — the work order is finished |

A helper `si_open_sla_stage(work_orders) returns text` states this once;
everything that needs it calls it rather than restating the chain, which is the
mistake `suggestPriority()` vs `si_derive_priority()` already costs this
schema. A client mirror lives in `lib/slaStages.js`, which already exists for
exactly this pairing.

### 2.3 Who maintains the flags

- **`si_stamp_work_order`** (BEFORE UPDATE, already fires on every status
  change) sets the sticky flag for the stage being *left* if it was late, and
  clears `sla_stage_overdue` unconditionally — the new stage's clock has only
  just opened. The sweep re-sets it within five minutes if the new stage is
  somehow already late, which is reachable when a stage target is shorter than
  the sweep interval.
  Its `closed` branch stops writing `sla_breached` directly and writes
  `sla_resolution_breached` instead, with `sla_breached` following from the
  three.
- **`si_sla_breach_sweep`** (pg_cron, 5 min) is rewritten to work per stage: for
  each live work order it finds the open stage, and if that stage's deadline has
  passed it sets both the stage's sticky flag and `sla_stage_overdue`. Its
  notification fan-out is unchanged in shape but names the stage.
- **`si_sla_warning_sweep`** is unchanged in mechanism. Its
  `(due - created_at) * 0.25` window becomes `(due - stage_start) * 0.25`, so
  "at risk" means the last quarter of the *current stage* rather than of a
  window that no longer exists.

### 2.4 What reads them

- `si_compute_dashboard_stats`: `overdue` counts `sla_stage_overdue` instead of
  `sla_breached`.
- `si_dashboard_card_rows`: the `overdue` card's predicate follows it.
- `RoleDashboard`: its client-side overdue and at-risk buckets read the new
  fields via `constants.js` helpers rather than recomputing.
- `exportWorkOrders.js`: the existing "SLA Breached" column keeps its meaning
  (ever missed); three columns are added naming which stages were missed.
- `WorkOrderDetail` / `lib/slaStages.js`: each stage row gains its own
  met/missed mark, which is where a cleared overdue is still visible.

## 3. The backfill — the part that must not be got wrong

The closing section of `0067`, after the seeds and the function replacements —
it has to run last, because it depends on the new targets `si_sla_targets`
returns. It touches no table other than `work_orders` and no columns other than
the SLA ones named in §3.2.

### 3.1 The rule

Every work order, closed and verified ones included, is recomputed under the new
model **from what actually happened**, never from `now()`. A closed work order's
acknowledge stage is judged by comparing its real assignment moment against its
deadline, so its verdict is a fact about June and does not change again.

### 3.2 The reconstruction

`acknowledged_at` and `responded_at` are already backfilled by 0050, but the
backfill re-derives them for any row where they are null and history says
otherwise, using 0050's own rule: first occurrence of `assigned` / `repairing`
in `work_order_history`, **filtered to `event_type = 'transition'`**. Without
that filter a photo replaced (0043) or a priority re-graded (0051) while the job
was assigned carries the work order's current status in `to_status` and reads as
the moment it was assigned.

Stage completion moments, per work order:

| stage | deadline | completed at | missed if |
|---|---|---|---|
| acknowledge | `created_at + ack` | `acknowledged_at` | `acknowledged_at > deadline`, or it is null and `now() > deadline` |
| response | `acknowledged_at + response` | `responded_at` | same shape |
| resolution | `responded_at + resolution` | `coalesce(resolved_at, closed_at)` | same shape |

A stage whose predecessor never happened has no deadline and no verdict: its
flag stays false and the deadline column stays NULL. That is not "met", it is
"never started", and §2.2's open-stage chain is what keeps such a work order
visible as overdue at the stage it is actually stuck in.

`sla_ack_due_at`, `sla_response_due_at` and `sla_resolution_due_at` are written
to the reconstructed values so every countdown on screen agrees with the flags.

`sla_stage_overdue` is computed last, from the open stage against `now()`.

`verified_at`, `verified_by`, `status`, the assignee, `resolved_at`, `closed_at`
and `decline_count` are **not named in the UPDATE**. The omission is the
mechanism, as in 0051 and 0064.

### 3.3 How it is verified before it is trusted

1. On the test project, snapshot every work order's five SLA columns into a
   temp table before the migration runs.
2. Run the backfill.
3. Produce a per-work-order before/after table — id, wo_number, priority,
   status, the three stage timestamps, old `sla_breached`, the three new flags,
   the three deadlines — and hand it over for review **before any of this is
   pushed to production**.
4. Assert mechanically: no row's `verified_at`, `verified_by`, `status`,
   `assigned_to_id`, `resolved_at`, `closed_at` or `decline_count` changed; every
   work order with all three stages complete has each flag decided by a
   timestamp comparison and none by `now()`; and for every on-time work order
   the recomputed resolution deadline equals the old one (§1.1's invariant).

The migration is written so that re-running it is a no-op producing identical
values, because it derives everything from history rather than from its own
previous output.

## 4. P8

Two files, because Postgres refuses to let a transaction use an enum value the
same transaction added and the CLI wraps each migration in one — the 0048/0050
rule.

- **0068** adds `si_priority.'P8'` and `si_impact.'scheduled'`. Nothing else.
- **0069** seeds the rows and ships §5.

Seeds:

- `priorities`: `P8`, label "Scheduled", rank 8, colour `#0891B2`. Teal because
  violet is P7's, slate is what `priorityColor()` returns on a *failed* lookup,
  and a priority badge exists to be told apart at a glance.
- `impact_levels`: `scheduled` → `P8`, sort order 6, label "Scheduled work
  (month-scale)". A full impact level, so the 1:1 impact→priority map 0051
  depends on holds, and so P8 is reachable from the raise form. **Consequence
  to expect: requesters will see this option**, which is the trade accepted when
  the alternative (override-only) was declined.
- `sla`: `7200 / 7200 / 28800`, sequential.

`si_compute_dashboard_stats` and `si_dashboard_card_rows` hardcode four priority
keys plus P7; both gain a `p8_scheduled` branch. Without it a P8 is counted in
`total_open` and in no band, the four cards visibly stop adding up, and the
longest-running work is the work with no figure watching it — the trap 0050
documents.

## 5. Extending an SLA

### 5.1 What it is

Re-grading a work order to a less urgent priority, which under §1 gives the open
stage a longer window. It is 0051's machinery behind a different front door.

### 5.2 The RPC

`si_extend_work_order_sla(p_work_order_id uuid, p_priority si_priority)`,
SECURITY DEFINER, `search_path` pinned, revoked from `public, anon`, granted to
`authenticated`. It opens the same `si.allow_priority_override` door as 0051 and
reuses the same SLA recomputation, and differs in exactly three ways that earn
it a separate function rather than a flag on the existing one:

- It **refuses any target that is not strictly less urgent** — the target's rank
  in `priorities` must be greater than the current priority's. Extending can only
  ever grant time; that is the whole meaning of the word, and enforcing it in the
  body means no client can turn "extend" into a covert escalation.
- It **generates its own remark** rather than requiring a typed reason, per the
  decision that this is a yes/no action on a phone. The generated text names both
  priorities, the time granted and the stage it applies to.
- It writes `event_type = 'sla_extension'`, so the timeline tells an extension
  and a re-grade apart.

It re-checks in its own body, because RLS does not apply inside it: signed in,
`si_is_admin()`, the work order exists, status not `verified`/`closed`, the
target is active, and the at-risk-or-overdue gate of §5.4.

New column `sla_extension_count int not null default 0`, incremented by the RPC,
so a work order extended four times says so on its face. It joins the four
`priority_override*` columns in `si_guard_priority_override`'s protected set, so
nothing reaches it outside the two RPCs — a direct PATCH from an Administrator's
own token is refused, at any rank.

The extension reuses `priority_override`, `priority_overridden_by` and
`priority_overridden_at`; `priority_override_reason` takes the generated text.
Sharing those columns is deliberate: the standing decision "this work order's
priority is P3 regardless of its impact" is one fact however it was reached, and
two parallel override columns would need `si_force_derived_priority` to arbitrate
between them.

### 5.3 The suggestion

`lib/slaExtension.js` — pure, rows in / answer out, no React and no Supabase,
the shape `exportWorkOrders.js`, `chartPeriods.js` and `slaStages.js` have, and
the reason it can be exercised in Node.

`suggestExtension(wo, priorities, slaRows, now)` walks the priorities of greater
rank than the work order's current one, in rank order, computing what the open
stage's deadline would become under each, and returns the first one that lands
in the future, together with the milliseconds gained and the resulting deadline.
If none clears it, it returns the last rung flagged as insufficient — the dialog
then says the extension still leaves the work order overdue, which is honest and
still worth offering.

It is **advisory only**. The server validates the rank increase and nothing
else; the suggestion never becomes an authorization decision.

### 5.4 When the button appears

`canExtendSla(wo, currentUser)` in `constants.js`: Administrator, status not
`verified`/`closed`, and the open stage is either past its deadline or in its
last quarter — the same threshold `si_sla_warning_sweep` uses, so the button and
the warning agree about "at risk". Restated in the RPC body, so a disagreement
produces an error rather than a silent success.

### 5.5 The dialog

`ExtendSlaDialog`, opened from `WorkOrderDetail`. It states the current priority
and how late the open stage is; pre-selects the suggested target and lists every
less urgent priority below it, each with the time it would grant and the
resulting deadline; carries the disclaimer that the extension is recorded on the
work order's timeline with the Administrator's name and notifies the technician
and the requester; and offers Yes / No. No free-text field.

Because the stage windows differ in kind, each option names its own deadline
rather than only a delta — "+3 hrs 15 min · due 20/09 14:30" — and an option on a
work order whose stage has not opened says so instead of inventing a date.

### 5.6 Logged and announced

- `work_order_history`, `event_type = 'sla_extension'`, from and to the status it
  is sitting in, actor read server-side from `auth.uid()`.
- `lib/historyEvents.js` gains the label.
- The notification reuses `priority_changed`, which is already in
  `NOTIFICATION_META` and in both `ICONS` maps, with wording naming the
  extension. A new type added server-side and not on the client renders as a grey
  generic bell.

## 6. Files touched

Database — `app/supabase/migrations/`:

- `0067_sla_stages_start_when_the_last_one_finished.sql` — seeds,
  `si_sla_targets`, the four new columns, `si_open_sla_stage`,
  `si_stamp_work_order`, both sweeps, both dashboard functions, and the backfill.
- `0068_p8_and_scheduled_enum_values.sql` — two enum labels, nothing else.
- `0069_p8_and_extending_an_sla.sql` — P8's three rows, the dashboard branches,
  `sla_extension_count`, `si_guard_priority_override`, `si_extend_work_order_sla`.

Client — `app/src/`:

- `lib/slaExtension.js` (new, pure)
- `lib/slaStages.js` — per-stage met/missed, the open-stage mirror
- `lib/constants.js` — `canExtendSla`, stage helpers, the P8 colour fallback
- `lib/workOrders.js` — `extendWorkOrderSla`
- `lib/historyEvents.js` — `sla_extension`
- `lib/exportWorkOrders.js` — three stage-breach columns, extension count
- `components/workorders/WorkOrderDetail.jsx` — the button, the dialog
- `components/workorders/ExtendSlaDialog.jsx` (new)
- `components/dashboard/RoleDashboard.jsx` — overdue and at-risk buckets

## 7. Verification

There is no test runner in this repository, so:

- `npm run build` as the compile check, never while `npm run dev` is live.
- `lib/slaExtension.js` and `lib/slaStages.js` exercised in Node against fixed
  instants, both models, every boundary: a stage not yet open, a stage exactly on
  its deadline, a suggestion that clears the breach, one that does not, and the
  P4→P7 change of model.
- Every RPC branch exercised against the test project through the pooler inside a
  rolled-back transaction: a non-admin refused, a requester refused, a finished
  work order refused, a same-or-more-urgent target refused, a work order that is
  neither overdue nor at risk refused, a direct PATCH of `sla_extension_count`
  refused, and a successful extension at each of `open`, `assigned`, `repairing`
  and `testing` asserting that status, assignee and the stage timestamps are
  byte-identical either side.
- A full walk of the flow on test, asserting that `sla_stage_overdue` sets while a
  stage is late and clears on advance while the sticky flag stays set.
- The backfill's before/after table, per §3.3, reviewed before production.
- `plpgsql` bodies are not parsed until called, so **a successful `db push` is not
  evidence that any of this works** — every branch is exercised.

## 8. Migration numbering

`0066` is the highest file here, but the test project is shared with other
worktrees and a duplicate version is silently skipped by `db push`. Before
writing the files, check `npm run env:which` and the applied migration list, and
renumber if 0067-0069 are taken. A file can never be numbered between two
existing ones: the CLI orders by filename and every digit sorts below `_`.

## 9. Risks

- **The backfill is irreversible and touches every row.** Mitigated by deriving
  from history rather than from previous state, by the before/after review gate,
  and by naming only SLA columns in the UPDATE.
- **Overdue will read differently on day one**, in both directions: work stuck at
  an early stage appears that never did, and long-overdue work whose stage has
  since advanced disappears. That is the intended meaning of the new card and
  should be said out loud to whoever reads the dashboard daily.
- **P8 is visible to requesters** as a raise-form impact option. Accepted
  deliberately; the alternative was rejected.
- **Notification volume rises** on a table that still has no retention.
