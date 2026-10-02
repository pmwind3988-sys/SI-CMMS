# Extend SLA by a priority's amount — design

**Date:** 2026-10-02 · **Branch:** `claude/extend-sla-by-priority` · **Migration:** 0078

## The problem, in the user's terms

A work order that is graded correctly can still run out of time in one stage — a P7 overhaul
sitting in Testing past its 7-day resolution window, or a repair stuck waiting weeks for a
spare part. Today an Administrator has two buttons and three meanings:

- **Change priority** (0051) — re-grade the work order; reason required.
- **Extend SLA** (0072/0075) — either *re-grade to a less urgent priority* (the same thing as
  Change priority, by a different door) or *top up* the open stage with one more of the work
  order's own stage window (a P7 resolution stage can only ever get another 7 days).

The overlap is confusing, and neither mode can say "keep it a P7, give this stage a month".

## The decision

Two buttons, one job each.

| Button | Means | Changes the priority? |
|---|---|---|
| **Change priority** | "This job was graded wrong." | Yes — unchanged from 0051 |
| **Extend SLA** | "The grading is right; this stage needs more time." | **Never** |

**Extend SLA becomes a single list.** One row per active priority, labelled with its full
total; the work order's own priority pre-selected; one tap and Extend.

```
Extend Resolution stage · currently 10 days overdue
  ○ P1 · 4 hrs   ○ P2 · 8 hrs   ○ P3 · 24 hrs   ○ P4 · 5 days
  ● P7 · 15 days  (this work order's priority)
  ○ P8 · 30 days
New deadline: 17/10/2026 14:00 · Priority stays P7
                                       [Cancel] [Extend]
```

### Rules

1. **Only the open stage moves.** Acknowledge, response or resolution — whichever the work
   order is in. Repairing, Waiting for spare part and Testing are all inside resolution.
2. **Amount = the chosen priority's full total** — acknowledge + response + resolution from
   `si_sla_targets`. P7 = 15 days, P8 = 30 days, P3 = 24 hrs. Any active priority may be
   chosen, more or less urgent than the work order's own: every choice only *adds* time.
3. **New deadline = later of (now, current deadline) + amount.** An overdue stage has its
   overdue time absorbed and the full amount starts now; a stage not yet overdue gets the
   amount on top of what is left. The Administrator never does overdue arithmetic.
4. **No typed reason.** The server writes the timeline remark, e.g. *"Resolution stage was
   10 days overdue; extended by P7 (15 days). Now due 17/10/2026 14:00. Priority unchanged at
   Long-term task (P7)."*
5. **Unchanged from today:** Administrator only; live work orders only; button shows only when
   the open stage is overdue or in its last quarter; the sticky "stage missed" flags are never
   reset; from the second extension on, the dialog says which time this is, in red.

## Data

Additive only. One new column:

- `work_orders.sla_overdue_absorbed_mins int not null default 0` — total minutes of overdue
  absorbed across all extensions, so a report can tell a 25-day extension that was mostly
  lateness from a planned one.

The granted time is stored the way 0075 stores it — in the stage's existing
`sla_*_extra_mins` column, `absorbed + amount` added on — so a later **Change priority**
still preserves every extension (0075 note 1). Algebra, with `due = start + target + extra`:

```
absorbed  = max(0, now - due)
extra'    = extra + absorbed + amount
due'      = start + target + extra' = max(now, due) + amount
```

`sla_extension_count` and `sla_top_up_count` both increment, so existing export columns and
the "Nth time" disclaimer keep meaning what they mean.

## Server

- **New RPC `si_extend_sla_stage(p_work_order_id uuid, p_by_priority si_priority)`**,
  SECURITY DEFINER, `search_path` pinned, revoked from `public, anon`, granted to
  `authenticated`. Re-checks Administrator, live status and the at-risk gate in its body
  (RLS does not apply inside), restates `work_orders_select` visibility, opens the
  `si.allow_priority_override` door with `set_config(..., true)`, updates the stage extra,
  the counts, `sla_overdue_absorbed_mins`, the stage's due column and `sla_stage_overdue`,
  writes one `work_order_history` row (`event_type = 'sla_extension'`) and notifies the same
  recipients 0075's top-up notifies.
- **`si_guard_priority_override` gains `sla_overdue_absorbed_mins`** in its protected set
  (`create or replace`, every existing check kept), so the column cannot be PATCHed directly.
- **`si_extend_work_order_sla` (0072/0075) is left exactly in place.** See the release plan.

## Client

- `lib/slaExtension.js` — `extensionOptions()` returns one option per active priority:
  `{ id, label, grantMs, absorbedMs, dueAt }`; `suggestExtension()` pre-selects the work
  order's own priority. Pure, checked in Node (`scripts/checks/slaExtension.check.mjs`
  rewritten).
- `lib/workOrders.js` — `extendSlaStage(woId, byPriority)` calls the new RPC.
  `extendWorkOrderSla` is removed from the client.
- `ExtendSlaDialog.jsx` — the single list above; the re-grade and top-up options are gone.
- `exportWorkOrders.js` — adds **SLA Overdue Absorbed (hrs)**; "SLA Time Added (hrs)" stays
  the sum of the three extras (it now includes the absorbed time, and the header comment
  says so).
- `canExtendSla()` unchanged.

## Production safety — nothing on the live site is interrupted

The failure this release must avoid has already happened once (recorded 2026-09-19): a new
client calling an RPC by an argument set production does not have yet returns `PGRST202` and
breaks extension outright. So:

1. **The migration is purely additive.** A new column with a default, a new function, and a
   `create or replace` of the guard that keeps every existing check. It removes and renames
   nothing, so the **current live site keeps working unchanged** once it is applied —
   including the old Extend SLA dialog, because `si_extend_work_order_sla` is untouched.
2. **Every statement is re-runnable** (`add column if not exists`, `create or replace`,
   `revoke`/`grant`), because production migrations go in through the SQL Editor and the next
   real `db push` re-runs the file.
3. **Schema first, then web.** Order:
   1. Apply 0078 to **test**; run `scripts/checks/sla0078ExtendByPriority.mjs` (one
      transaction, assertions, rollback) and click through the dialog on test.
   2. **You** paste 0078 into production's SQL Editor. The live site is unaffected.
   3. I probe production with the anon key: `si_extend_sla_stage` must answer `42501`
      against a fake-function `PGRST202` control.
   4. Only then push the web change to `main` → Vercel.
4. **Open tabs with the old code keep working** after the web deploy, because the old RPC
   still exists. Retiring `si_extend_work_order_sla` is a separate, later migration — not in
   this change.
5. **Existing extensions are untouched.** No backfill; rows already extended keep their extras,
   counts and timeline entries.

## Out of scope

Dropping `si_extend_work_order_sla`; any change to Change priority; making Waiting for spare
part a stage of its own.
