# Three changes: a shorter technician workflow, attributed photos, chart legends

Date: 2026-08-27
Status: approved design, not yet implemented

Three independent changes, shipped together. They share no code, but two of
them need the same migration slot, so they are specified as one unit and
implemented in the order below.

1. **Remove `on_the_way` and `on_site`.** A technician who has accepted a job
   presses **Start Work** and goes straight to Repairing.
2. **Every photo records who uploaded it, under which role, when, and in which
   phase of the work order.** The Attachments tab groups photos by phase and
   captions each one.
3. **Every dashboard chart gets a tap-to-show legend** explaining what its
   colours, bars and axes mean.

---

## 1. Removing On The Way and On Site

### What changes for the person using it

A technician accepts a job. The next button is **Start Work**, and pressing it
puts the job into Repairing. The two screens in between — "En route, mark
arrival once you're at the equipment" and "On site, start repair when you've
assessed the issue" — are gone. Everything from Repairing onwards is unchanged:
waiting for a spare part, testing, completing.

The requester used to be told "Technician has arrived". They are now told
"Technician has started work" one step later, which is the thing they actually
wanted to know.

### The rule lives in the transition matrix, not in the client

`wo_status_transitions` is the boundary (0003), so the migration edits rows:

**Deleted** — five rows:

| from | to | why |
|---|---|---|
| `accepted` | `on_the_way` | rung removed |
| `on_the_way` | `on_site` | rung removed |
| `on_site` | `repairing` | replaced by `accepted → repairing` |
| `on_the_way` | `on_the_way` | "reassign mid-flight", unreachable now |
| `on_site` | `on_site` | "reassign mid-flight", unreachable now |

**Inserted** — one row, carrying `on_site → repairing`'s exact shape so nothing
else about the move changes:

```
('accepted','repairing', '{technician,manager,admin}', '{}', false, 'Start work')
```

Once those rows are in place `si_guard_work_order_transition` refuses the old
moves on its own. No client change can re-enable them, which is the point of the
matrix being data.

### The enum values stay, and stay labelled

Postgres cannot remove a value from `si_wo_status`, and removing it would be
wrong here regardless: `work_order_history` holds real rows saying a technician
was on site last month. Deleting the two `wo_statuses` rows would leave those
history entries rendering a blank grey badge — the exact failure migration 0031
was written to prevent for the other lookups.

So `wo_statuses` gains **`is_active boolean not null default true`**, set false
for `on_the_way` and `on_site`. This is 0031's retire pattern applied to the one
table 0031 deliberately skipped. 0031's reasoning was that nobody *picks* a
status, so retiring one means editing `wo_status_transitions` — which is exactly
what this migration does. The flag is not the enforcement; the matrix is. The
flag decides only what the timeline ladder draws, which is display, and display
narrowing is always the sanctioned direction.

Consequences:

- `statusLabel` / `statusColor` keep reading **every** row, retired included, so
  an old work order's "On The Way" badge still resolves to its amber. Same as
  the priorities in 0031.
- `statusFlow` in `lib/referenceData.js` filters on `is_active`. It is the
  ordered ladder `StatusTimeline` draws, and a rung nobody can reach should not
  be drawn for a new work order.

### StatusTimeline draws the active ladder *plus* whatever actually happened

If the ladder were the active flow alone, an old work order's `on_the_way` and
`on_site` history rows would render nowhere. That is precisely the bug migration
0038 fixed for declines — rows sitting in `work_order_history` and displayed on
no screen.

So the rung list becomes: the active flow, with any retired status the work
order has a history row for spliced back in at its `sort_order`. A work order
raised after this change has no such rows and draws the short ladder. One raised
before draws its full, truthful history.

### Existing mid-flight work orders move to Repairing

Anything sitting in `on_the_way` or `on_site` when the migration runs is set to
`repairing`, with one `work_order_history` row each recording why. Without this
they would be stranded: no matrix row out of their status, so no button in
`WorkflowPanel` and no way for a technician to finish the job.

The backfill has to disable two triggers around that one statement, and both
reasons are load-bearing:

- **`a_guard_work_order_transition`** would refuse the move. There is no matrix
  row for `on_site → repairing` any more — the migration just deleted it — and
  `auth.uid()` is null on a migration connection, so the admin bypass does not
  apply either.
- **`after_work_order_update`** (`si_notify_work_order_update`) would fan out a
  notification per affected work order for a change nobody made. `accepted →
  repairing` is about to become a notifying transition, and these rows are not
  arriving there by anyone's action.

`b_stamp_work_order` stays **enabled** — its stamping is what should happen.

History rows are written explicitly in the same statement, with `actor_id` null
and a remark naming the migration. An audit trail that silently skips a status
change is not an audit trail; a null actor honestly says "the system did this".

### The notification branch moves

`si_notify_work_order_update` is replaced wholesale (0038's version — `create or
replace` has no way to amend one branch). One branch is removed:

```sql
if old.status = 'on_the_way' and new.status = 'on_site' then ... 'Technician has arrived' ...
```

and one added:

```sql
if old.status = 'accepted' and new.status = 'repairing' then
  perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
    'status_change', 'Technician has started work',
    coalesce(new.assigned_to_name, 'A technician') || ' has started work on ' || v_ref || '.');
end if;
```

Requester only, matching what the removed branch did. Every other branch —
accept, decline, complete, reopen, the 0038 fan-out to Supervisors, Managers and
Admins — is carried over byte-for-byte.

### `si_open_statuses()` is trimmed

It lists the statuses the SLA sweep counts as "still in flight" and currently
names both removed rungs. After the backfill nothing can be in them. Leaving a
list naming values nothing can hold is the shape of bug this codebase keeps
hitting from the other direction — a field written and never read — so it is
trimmed to `open, assigned, accepted, repairing, waiting_spare_part, testing`.

It is `immutable`, so `create or replace` is enough; nothing caches it across a
statement.

### Client changes

| File | Change |
|---|---|
| `lib/workOrders.js` | Delete `startTravel` and `arriveOnSite`. `startRepair` now transitions `accepted → repairing`, remark "Started work". |
| `components/workorders/WorkflowPanel.jsx` | Delete the `on_the_way` and `on_site` branches. The `accepted` branch's button becomes **Start Work** (`Wrench` icon, amber) calling `startRepair`; its InfoBox becomes "Accepted. Start work when you're at the equipment." The non-assignee text becomes "…has accepted and will start shortly." Drop the now-unused `Truck` and `MapPin` imports. |
| `components/dashboard/RoleDashboard.jsx` | `IN_PROGRESS` drops the two codes. |
| `lib/referenceData.js` | `statusFlow` filters `is_active`; select `is_active` from `wo_statuses`; fix the module comment that uses `"on_the_way"` as its example of a fallback label. |
| `components/workorders/StatusTimeline.jsx` | Ladder = active flow ∪ rungs the work order has history for. |

### What is deliberately NOT changed

- **The export keeps its "En Route At" and "On Site At" columns.** An export is
  a record. Work orders that passed through those rungs have those timestamps
  and they belong in the file. The columns will be blank for everything raised
  from here on, exactly as "Priority Overridden" has read "No" since 0036.
- **`si_wo_status` keeps both values.** Enum values cannot be removed, and rows
  reference them.
- **`docs/SI_WorkOrder_FSD.md` is not edited by this change.** The FSD is
  authoritative where it and the code disagree, so a workflow change that
  contradicts it needs the user's call on the document, not a silent edit. Flag
  it at the end of implementation.

---

## 2. Photo attribution and phase

### What changes for the person using it

The Attachments tab stops being one undifferentiated grid. Photos sit under
headings for the phase of the job they were taken in:

- **Uploaded earlier** — anything stored before this change; no phase is known
- **Before work** — `open`, `assigned`, `accepted`
- **During repair** — `repairing`, `waiting_spare_part`
- **Testing** — `testing`
- **After completion** — `completed`, `verified`, `closed`

Each thumbnail carries a caption: **Arun Kumar · Technician · 14 Aug 2026, 2:56
PM**. Empty groups do not render, so a fresh work order still shows one group.

### Two new columns

```sql
alter table attachments
  add column uploaded_by_name text,
  add column wo_status si_wo_status;
```

Both nullable, deliberately. Existing rows have no honest value for either, and
`null` says "not recorded" where a backfilled guess would be indistinguishable
from a fact a year from now. That is what the "Uploaded earlier" group exists
to render.

**`uploaded_by_name` is denormalised rather than joined at read time.** Same
reasoning as `work_order_history.actor_name` and `comments.author_name`:
`users_select` hides test accounts and protected accounts, so a join returns
nothing for exactly those rows and the photo would show no uploader at all.

### Both are stamped by a trigger, not sent by the browser

`addAttachment` currently sends `uploaded_by_id` and `uploaded_by_role` from the
client. A phase the client supplies is a phase the client can omit or get wrong,
and this repo has shipped that failure twice — `users.status` was written by the
admin screen and read by nothing for four migrations (0026), and 0031's header
makes the same argument about a retirement that only filters a dropdown.

So a `BEFORE INSERT` trigger on `attachments` owns all four fields:

```
si_stamp_attachment()  -- SECURITY DEFINER, search_path pinned
  new.uploaded_by_id   := coalesce(auth.uid(), new.uploaded_by_id);
  new.uploaded_by_name := (select name from users where id = new.uploaded_by_id);
  new.uploaded_by_role := highest role from si_roles();
  new.wo_status        := (select status from work_orders where id = new.entity_id)
                          -- only when entity_type = 'work_order'
```

Named `si_stamp_attachment`, trigger `a_stamp_attachment` — the same
`create trigger` naming this schema uses elsewhere; no other BEFORE trigger
exists on this table, so ordering is not yet load-bearing, but the prefix keeps
it deterministic if one is added.

Four details:

- **`coalesce(auth.uid(), …)` rather than a bare assignment**, so the seed and
  bootstrap scripts still run. Same door `si_protected_override()` and
  `si_guard_test_account` open for a service-role connection with a null uid.
- **Role is the highest held, via `si_roles()`**, matching what
  `work_order_history.actor_role` records and what the client used to send.
  `uploaded_by_role` is singular and stays singular: it records a role in a
  moment, and a moment has one.
- **`attachments_insert`'s `with check (uploaded_by_id = auth.uid())` still
  applies and now always passes.** BEFORE row triggers run before RLS's WITH
  CHECK is evaluated on the resulting row, so the trigger stamping the uid is
  what satisfies the policy rather than what bypasses it. The policy stays as
  the boundary.
- **The function must be `revoke all … from public, anon, authenticated`.** It
  is a trigger body with no caller in the app — the shape 0033 used. Note
  `PGRST202` from the anon key proves nothing for a `returns trigger` function;
  PostgREST does not publish those at all. Check grants against a privileged
  caller, per the 0036 note.

`wo_status` is stamped for **every** uploader, not only technicians. One rule is
cheaper than two and it makes the grouping coherent: a requester's photos from
the raise form land under *Before work* on their own, without a special case.

### Client changes

| File | Change |
|---|---|
| `lib/workOrders.js` | `addAttachment` stops sending `uploaded_by_id` / `uploaded_by_role` — the trigger owns them. `listenAttachments` already selects `*`, so the two new columns arrive with no change. |
| `components/workorders/AttachmentsPanel.jsx` | Group photos by phase; caption each thumbnail. Documents keep their existing flat section, captioned the same way. The legacy `<video>` branch is untouched (0036 keeps playback for rows that have one). |
| `lib/attachmentPhases.js` *(new)* | The status → phase map and the ordered group list. Pure, no React, no Supabase — one place both the panel and any future export column read it from. |

Captions use `fmtDateTimeMY` from `lib/datetime.js`, so they render in plant
time. The rest of that component still uses `toLocaleString(undefined, …)`;
this change does not sweep the file, per the standing note that those call sites
are left alone deliberately.

### Scope

Photos and documents on **work orders**. `attachments` is polymorphic
(`entity_type`), but nothing else in the app writes an attachment today, so
`wo_status` is left null for any other entity type rather than inventing a
meaning for it.

---

## 3. Chart legends on all four charts

### What changes for the person using it

Every chart card gains a small **Legend** button under its subtitle. Tapping it
expands a panel inside the card saying what the chart is showing. Tapping again
collapses it. Nothing is shown by default, so no chart loses plot height on a
phone.

Content per chart:

| Chart | Panel says |
|---|---|
| **Monthly Work Orders** | Line = work orders created that month. Horizontal axis: the last 12 months. Vertical axis: how many were raised. Excludes test data. |
| **Department Breakdown** | One swatch per department, with its colour and count. Replaces the always-visible Recharts `<Legend>`, giving the pie its height back. Excludes test data. |
| **Machine Breakdown** | Red = the three machines with the most work orders. Amber = the rest of the top ten. Horizontal axis: work order count. Excludes test data. |
| **Technician Performance** | Green bar = work orders completed by that technician. Horizontal axis: how many. Hover or tap a bar for their average repair time. Excludes work performed by test accounts. |

The "excludes test data" line is worth stating rather than assuming — it is a
real rule (migrations 0033, 0034) that makes a chart disagree with the work
order list, and a user comparing the two deserves to know why.

### Implementation

One shared component, `components/dashboard/ChartLegend.jsx`:

- Props: `items` — an array of `{ color?, label, note? }`. An item without a
  colour renders as a plain explanatory line, which is how the two single-series
  charts describe their axes.
- Renders a `<button aria-expanded>` reading "Legend" with a chevron, and the
  expanded panel below it.
- State is local to each card. Nothing persists — a legend is read once.

Each of the four chart components imports it and passes its own items.
`DepartmentBreakdownChart` additionally drops `Legend` from its recharts import
and computes its swatch list from the same `COLORS[i % COLORS.length]` the
`<Cell>`s use, so the key cannot drift from the pie.

`MachineBreakdownChart`'s "top 3" is `i < 3` on an array the aggregate already
returns sorted; the legend restates that and does not recompute it.

---

## Order of work

1. Migration `0039` — everything in sections 1 and 2 that is SQL. One file: the
   two features share no statements, but they share the migration slot and a
   half-applied pair is worse than an atomic one.
2. `npm run db:types`.
3. `lib/` changes — `workOrders.js`, `referenceData.js`, new
   `attachmentPhases.js`.
4. Components — `WorkflowPanel`, `StatusTimeline`, `RoleDashboard`,
   `AttachmentsPanel`, the four charts and `ChartLegend`.
5. Section 3 is independent of 1 and 2 and can land first if the migration is
   blocked.

## Verification

There is no test suite and no test runner. Verification is manual, and every
claim below has to be backed by output, not by reading the diff.

- `npm run build` from `app/` is the compile check (`npm run lint` is broken —
  Next 16 removed `next lint`). Not while a dev server is live.
- Migration applied to the **test** project only: `npm run env:test`, then
  `npm run db:push`. Confirm with `npm run env:which` first.
- **A `db push` succeeding is not evidence a plpgsql function works.** Both new
  trigger bodies must be exercised: an attachment inserted at three different
  work order statuses, and a transition through `accepted → repairing`.
- Walk the workflow on test: raise, assign, accept, **Start Work**, check the
  requester's notification reads "has started work", finish through testing and
  completion.
- Confirm the backfill: query `work_orders` for `status in ('on_the_way',
  'on_site')` before and after, and check the history rows it wrote.
- Confirm an old work order's timeline still shows its On The Way / On Site
  rungs, and a new one does not.
- Upload a photo before starting work and another during repair; confirm the
  two land in different groups with correct name, role and time.
- Open all four charts and expand every legend, on a narrow viewport as well as
  desktop.
- Ask the user to run the Supabase security advisor after the migration — this
  session cannot run it, and 0039 adds a function.

## Open items for the user, not decided here

- **`docs/SI_WorkOrder_FSD.md` still describes the six-step technician flow.**
  The FSD is authoritative where it and the code disagree, so changing the code
  puts them in conflict by design. Raise it once the change is working; do not
  edit the FSD as part of this work.
- Nothing recompresses or re-attributes existing attachments, and nothing
  should. Their `uploaded_by_name` and `wo_status` stay null forever.
