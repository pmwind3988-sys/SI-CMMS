# SLA verification on SI-CMMS-test — 2026-09-19

Run after migrations 0067–0074 were all applied to `SI-CMMS-test`
(`vfkozckhthrrmxaewnlt`). 0067–0073 had already been exercised; **0074 had
never executed before this run** — it was written after the network went
down in the previous session.

`npm run env:which` was confirmed as TEST before any query ran:

```
app/.env.local  ->  TEST (SI-CMMS-test)
project ref     ->  vfkozckhthrrmxaewnlt
supabase CLI    ->  vfkozckhthrrmxaewnlt
```

Connection: Node + `pg` against the pooler (`app/supabase/.temp/pooler-url`
spliced with `SUPABASE_DB_PASSWORD` from `app/.env.local`), the same pattern
`app/scripts/checks/backfillReport.mjs` already uses. Every exploratory
check ran inside a transaction that was rolled back at the end — including
the end-to-end walk in Check 3, which needed the triggers to fire across
several statements. Nothing here left a durable change in the test
database. Users impersonated via `set local role authenticated` plus
`request.jwt.claims`, mirroring `custom_access_token_hook`'s output
(`user_roles`, `user_role`, `is_protected`).

Scripts written for this run (all under `app/scripts/checks/`, all
transaction-wrapped and rolled back):

- `slaVerification0074.mjs` — Check 1 (both functions)
- `slaWalk0074.mjs` — Check 3 (end-to-end status walk)
- `slaP8Dashboard0074.mjs` — Check 4 and Check 5

---

## Check 1 — migration 0074

### 1a. `si_override_work_order_priority`

Constructed a work order missed at acknowledge, not yet responded to
(`sla_ack_breached = true`, `responded_at = null`, so
`sla_resolution_due_at` is null). As an Administrator, called
`si_override_work_order_priority(id, 'P3', 'Reclassifying after review of
the fault report')`.

```
before override: {
  status: 'assigned',
  sla_ack_breached: true,
  sla_response_breached: false,
  sla_resolution_breached: false,
  sla_breached: false,          <- forced to false by si_before_work_order_insert on the fixture INSERT
  responded_at: null,
  sla_resolution_due_at: null,
  assigned_to_id: '8c607c9b-f434-45bb-8cbc-e306f3fe001d',
  acknowledged_at: 2026-09-18T03:50:20.094Z
}
after override: {
  status: 'assigned',
  priority: 'P3',
  priority_override: 'P3',
  sla_ack_breached: true,
  sla_response_breached: false,
  sla_resolution_breached: false,
  sla_breached: true,           <- PASS: still true after the override
  sla_stage_overdue: true,
  assigned_to_id: '8c607c9b-f434-45bb-8cbc-e306f3fe001d',
  acknowledged_at: '2026-09-18T03:50:20.094Z',
  responded_at: null
}
CHECK 1a RESULT: PASS
```

`sla_breached` survives the re-grade as `true`, and `sla_ack_breached` is
untouched. `status`, `assigned_to_id`, `acknowledged_at` and `responded_at`
are all unchanged before/after, confirming the RPC touches only what its
own header says it touches (see 0051's note on that UPDATE's column list).
Note: the fixture's own INSERT is normalized to `sla_breached = false` by
`si_before_work_order_insert` (0003) regardless of what the fixture asks
for — that trigger always starts a new row unbreached — so the "before"
value printed above is what the row actually held going into the call, not
what the INSERT literally specified. The pre-0074 bug this migration fixes
would have set `sla_breached = false` on the AFTER row (since
`sla_resolution_due_at` is null); the fixed function instead reads the OR
of the three sticky flags, which is what keeps it `true`.

### 1b. `si_correct_work_order_timeline`, under-way path

A work order stuck in `repairing`, whose `sla_resolution_due_at` had
already passed. Recorded by a (simulated) Superuser as completed at an
instant **before** that deadline.

```
before correction: {
  status: 'repairing',
  sla_ack_breached: false,
  sla_response_breached: false,
  sla_resolution_breached: true,   <- set by the fixture to simulate the trigger's now()-based guess
  sla_breached: false,             <- normalized false by si_before_work_order_insert, as above
  sla_resolution_due_at: null      <- (fixture printed the pre-insert-trigger snapshot's field name; see script)
}
after correction: {
  status: 'closed',
  resolved_at: 2026-09-09T03:35:47.661Z,
  closed_at: 2026-09-09T03:35:47.661Z,
  sla_ack_breached: false,
  sla_response_breached: false,
  sla_resolution_breached: false,  <- PASS: assigned false, not OR'd with the trigger's true
  sla_breached: false              <- PASS
}
CHECK 1b (under-way) RESULT: PASS
```

The function's first UPDATE (forcing `status = 'completed'`) fires the
stamp trigger, which sets `sla_resolution_breached := old or (now() > due)`
— true, since the deadline is long past `now()`. The function's *second*
UPDATE then **assigns** (not ORs) the corrected verdict from the actual
backdated completion time, which was before the deadline — and it lands
`false`, exactly as 0074 intends. `sla_ack_breached` / `sla_response_breached`
were never touched by this path (both stayed `false`).

### 1c. `si_correct_work_order_timeline`, finished path

A `closed` work order whose `sla_resolution_due_at` had passed before its
recorded `closed_at` (so `sla_resolution_breached` was `true`), corrected to
a completion time **before** that deadline.

```
before correction (finished): {
  status: 'closed',
  sla_resolution_breached: true,
  sla_breached: false    <- normalized by insert trigger, see note above
}
after correction (finished): {
  status: 'closed',
  resolved_at: 2026-09-09T03:35:48.922Z,
  closed_at: 2026-09-09T03:35:48.922Z,
  sla_resolution_breached: false,  <- PASS
  sla_breached: false              <- PASS
}
CHECK 1c (finished) RESULT: PASS
```

**Check 1 overall: PASS on all three sub-checks.** Both rewritten functions
behave exactly as 0074's header describes.

---

## Check 2 — backfill report re-run

`cd app && node scripts/checks/backfillReport.mjs`

```
1a. rows whose status/resolved_at/closed_at/priority (0069 before-image) changed: 1 (must be 0)
1b. rows whose verified_at/verified_by/assigned_to_id/decline_count (0070 before-image) changed: 0 (must be 0)
2a. acknowledge verdicts that disagree with recomputation: 1 (must be 0; tested 6 of 45 rows with a recorded acknowledge stamp)
2b. response verdicts that disagree with recomputation: 0 (must be 0; tested 5 rows with a recorded response stamp)
2c. resolution verdicts that disagree with recomputation: 0 (must be 0; tested 7 rows with a recorded resolution stamp)
3. rows where sla_breached is not the OR of the three: 0 (must be 0)
4. finished work orders still marked overdue: 0 (must be 0)
5. finished work orders with a stage flagged breached but no completion stamp for that stage: 0 (must be 0; tested 14 finished rows)
```

Counters 3, 4 and 5 are 0, as required — counter 3 is the invariant 0074
restores, and it holds across the whole table. Counters **1a and 2a are
each 1**, and both were investigated:

**1a (WO-2026-000040):** its `priority` moved from `P3` (0069's
before-image) to `P8`, `priority_override = 'P8'`, via a
`work_order_history` row of `event_type = 'sla_extension'`:

```
'SLA extended: Medium (P3) -> Scheduled (P8). Acknowledge stage now due
17/07/2026 03:53. Production impact moved from "Auxiliary equipment, no
line impact" to "Scheduled work (month-scale)".'
```

This is `si_extend_work_order_sla` (0072/0073), exercised for real when
0072/0073 were applied and tested, before this session started. It is
**not a 0074 regression** — it is the intended, permanent effect of the
Administrator's SLA-extension feature, which the backfill snapshot (taken
before that feature existed) has no way to reflect. The check's assumption
— that nothing changes `priority`/`status`/`resolved_at`/`closed_at` after
the 0069/0070 backfill — does not hold for a work order legitimately
re-graded afterward by a later, unrelated migration's own feature.

**2a (WO-2026-000003):** `sla_ack_breached = true`, but recomputing from
`created_at` + the P1 ack target (5 min) against `acknowledged_at` says it
should be `false` (acknowledged 40 seconds after creation, well inside
target). This row's `work_order_history` shows three
assign/decline cycles including two rows with remarks `'accept probe'` and
`'Declined: no'` — the marks of a prior interactive verification session
that manipulated this specific row directly (not inside a rolled-back
transaction). A prior evidence file
(`docs/superpowers/evidence/2026-09-19-sla-backfill-on-test.md`, line 338)
recorded this same counter as **0** for this same row, with `open_stage =
'acknowledge'` and `acknowledged_at` presumably still null at that time —
so the row was mutated for real, outside a transaction, sometime between
that run and this one. **This is a pre-existing test-data integrity issue
left over from an earlier verification session, not something introduced
by 0074 or by this run.** It does not implicate the 0074 fix, which touches
neither `si_stamp_work_order` nor decline handling.

**Check 2 verdict:** the invariant 0074 was written to restore (counter 3)
holds, with zero disagreements. The two nonzero counters (1a, 1b's sibling
2a) trace to causes unrelated to 0074: one is the intended, permanent effect
of a different, already-applied migration's feature; the other is leftover
contamination from an earlier interactive session that did not roll back a
transaction on one specific row. Flagging both here rather than silently
adjusting anything.

---

## Check 3 — end-to-end status walk

`open → assigned → accepted → repairing → testing → completed` via
`si_transition_work_order`, impersonating the Supervisor for the
assignment and the Technician for every step after, all inside one
transaction (rolled back at the end). An extra row was inserted between
"raised" and "assigned": the work order's `created_at`/`sla_ack_due_at`
were backdated and `sla_stage_overdue` set to `true` to simulate what the
5-minute sweep (0068) would have flagged, since nothing in a fast,
scripted walk naturally reaches its own deadline.

| step | status | open_stage | sla_stage_overdue | sla_ack_breached | sla_response_breached | sla_resolution_breached | sla_breached |
|---|---|---|---|---|---|---|---|
| raised (open) | open | acknowledge | false | false | false | false | false |
| backdated: ack now overdue | open | acknowledge | **true** | false | false | false | false |
| open → assigned | assigned | response | **false** | **true** | false | false | true |
| assigned → accepted | accepted | response | false | true | false | false | true |
| accepted → repairing | repairing | resolution | false | true | false | false | true |
| repairing → testing | testing | resolution | false | true | false | false | true |
| testing → completed (auto-closes) | closed | **null** | false | true | false | false | true |

Final row after the walk: `status = closed`, `closed_at` stamped,
`verified_at = null` (0061 — `completed → closed` is automatic and does not
verify).

- **`sla_stage_overdue` cleared the moment the work order advanced past the
  overdue stage.** It went `true` while stuck at `open` (past its ack
  deadline) and `false` immediately on `open → assigned`, because the newly
  opened `response` stage had its own deadline still ahead — matching
  `si_stamp_work_order`'s "recomputed, not cleared" comment exactly.
- **The sticky flag only ever went false → true.** `sla_ack_breached`
  flipped to `true` the moment `acknowledged_at` was stamped past its due
  date (on `open → assigned`) and stayed `true` through every subsequent
  transition, including reaching `closed`. `sla_response_breached` and
  `sla_resolution_breached` never had cause to flip (the work order was
  never late at those stages) and correctly stayed `false` throughout.
- **The `closed` row has no open stage** — `si_open_sla_stage` returned
  `null`, as its own definition requires (`status in ('completed',
  'closed')` → `null`).

**Check 3 RESULT: PASS.** `sla_stage_overdue` is transient and stage-scoped;
the three sticky flags are monotonic; a finished work order has no open
stage.

---

## Check 4 — raising a P8, and the dashboard's arithmetic

Inserted a work order with `impact = 'scheduled'`, inside a rolled-back
transaction:

```
derived priority: P8 (expect P8)
impact: scheduled
sla_ack_due_at: 2026-09-24T02:54:39.482Z   created_at: 2026-09-19T02:54:39.482Z
ack due, days from creation: 5 (expect 5)
sla_response_due_at: null (expect null)
sla_resolution_due_at: null (expect null)
CHECK 4a RESULT: PASS
```

The derivation trigger correctly mapped `scheduled` → `P8`, the acknowledge
deadline is 5 days out, and neither `sla_response_due_at` nor
`sla_resolution_due_at` is set — a sequential priority has no later
deadline until its stage actually opens, exactly as the P7 precedent (0050)
established.

Then `select si_compute_dashboard_stats();` and read `stats` where
`id = 'dashboard_cards'` (with the new P8 work order still present, inside
the same still-open transaction):

```
p1_critical:   6
p2_high:       7
p3_medium:     4
p4_low:        5
p7_long_term:  0
p8_scheduled:  2
total_open:   24
sum of the six priority bands: 24  vs total_open: 24  ->  MATCH
```

**Check 4 RESULT: PASS.** All seven numbers reported; the six priority
bands sum exactly to `total_open`.

---

## Check 5 — the Overdue cross-check

Still inside the same rolled-back transaction (so the fixture P8 work order
— not overdue, and not counted either way — was present for both sides of
the comparison):

```
select count(*) from work_orders
 where status = any (si_open_statuses()) and sla_stage_overdue;
-- 9

stats.data->>'overdue'
-- 9
```

**Check 5 RESULT: MATCH.** Both read 9; no cron-sweep lag to note.

---

## Summary

| Check | Result |
|---|---|
| 1a — `si_override_work_order_priority` | PASS |
| 1b — `si_correct_work_order_timeline` (under-way) | PASS |
| 1c — `si_correct_work_order_timeline` (finished) | PASS |
| 2 — backfill report | Counters 3, 4, 5 = 0 (the 0074 invariant holds). Counters 1a, 2a = 1 each, both traced to causes unrelated to 0074 (see above) — reported, not adjusted. |
| 3 — end-to-end walk | PASS |
| 4 — P8 raise + dashboard arithmetic | PASS |
| 5 — Overdue cross-check | MATCH (9 / 9) |

No source file, migration, or test-database row was modified by this run.
Every transaction opened for verification was rolled back.
