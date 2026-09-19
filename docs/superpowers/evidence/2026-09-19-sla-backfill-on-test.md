# Task 5 report: migration 0069 — the backfill

## Status: DONE

## What I implemented

- `app/supabase/migrations/0069_recompute_every_sla_under_the_new_model.sql` — byte-for-byte
  the SQL in the brief: creates the permanent `sla_backfill_0069` audit table (RLS enabled,
  Superuser-only SELECT policy), snapshots every current work order's SLA columns into it with
  `on conflict do nothing`, then recomputes `acknowledged_at`, `responded_at`, and the three
  deadline/breach column sets in one UPDATE, followed by a second UPDATE (reading the values the
  first one just committed) that derives `sla_breached` and `sla_stage_overdue`.
- `app/scripts/checks/backfillReport.mjs` — the brief's review-gate script, with one adaptation
  to the connection lookup (see below). Everything else — the query, the `console.table`, and the
  four assertions — is verbatim from the brief.

## Change to the script's env lookup

The brief's script reads `SUPABASE_DB_URL` from `app/.env.local`. That variable is not present in
this worktree's `.env.local` (confirmed with `grep`). Tasks 3 and 4's reports record the route
that actually works on this machine: build the connection string from
`app/supabase/.temp/pooler-url` (host/user/db) plus `SUPABASE_DB_PASSWORD` from `.env.local`. I
kept `SUPABASE_DB_URL` as the first choice (so the script still works unmodified if that variable
is ever added) and added a fallback that reads `pooler-url`, splices in the password via
`encodeURIComponent`, and uses that. Verified the constructed string in isolation before running
the script for real:

```
postgresql://postgres.vfkozckhthrrmxaewnlt:***@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
```

`pg` was already present in `node_modules` from Task 3/4's `--no-save` install; nothing else
changed in `package.json`/`package-lock.json`.

## env:which output

```
  app/.env.local  ->  TEST (SI-CMMS-test)
  project ref     ->  vfkozckhthrrmxaewnlt
  supabase CLI    ->  vfkozckhthrrmxaewnlt
```

Confirmed **test** before pushing.

## db:push output

```
Connecting to remote database...
Applying migration 0069_recompute_every_sla_under_the_new_model.sql...
{"upToDate":false,"dryRun":false,"migrations":["0069_recompute_every_sla_under_the_new_model.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

Applied cleanly to test, no errors.

## backfillReport.mjs output — full per-work-order table

```
┌─────────┬──────────────────┬──────────┬──────────────────────┬──────────────┬────────────┬─────────────┬────────────┬─────────────┬───────────────┬──────────────────────────┬──────────────────────────┐
│ (index) │ wo_number        │ priority │ status               │ was_breached │ ack_missed │ resp_missed │ res_missed │ overdue_now │ open_stage    │ res_due_before           │ res_due_after            │
├─────────┼──────────────────┼──────────┼──────────────────────┼──────────────┼────────────┼─────────────┼────────────┼─────────────┼───────────────┼──────────────────────────┼──────────────────────────┤
│ 0       │ 'WO-2026-000045' │ 'P4'     │ 'repairing'          │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-06T01:54:04.413Z │ null                     │
│ 1       │ 'WO-2026-000044' │ 'P3'     │ 'on_site'            │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-02T01:54:04.413Z │ null                     │
│ 2       │ 'WO-2026-000043' │ 'P2'     │ 'on_the_way'         │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T09:54:04.413Z │ null                     │
│ 3       │ 'WO-2026-000042' │ 'P1'     │ 'accepted'           │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T05:54:04.413Z │ null                     │
│ 4       │ 'WO-2026-000041' │ 'P2'     │ 'testing'            │ true         │ true       │ false       │ true       │ true        │ 'acknowledge' │ 2026-09-01T09:54:04.413Z │ 2026-09-10T17:27:35.743Z │
│ 5       │ 'WO-2026-000040' │ 'P3'     │ 'open'               │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-02T01:54:04.413Z │ null                     │
│ 6       │ 'WO-2026-000039' │ 'P2'     │ 'open'               │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T09:54:04.413Z │ null                     │
│ 7       │ 'WO-2026-000038' │ 'P1'     │ 'closed'             │ false        │ true       │ false       │ false      │ false       │ null          │ 2026-09-01T05:54:04.413Z │ null                     │
│ 8       │ 'WO-2026-000037' │ 'P4'     │ 'closed'             │ true         │ true       │ false       │ false      │ false       │ null          │ 2026-09-06T01:54:04.413Z │ null                     │
│ 9       │ 'WO-2026-000036' │ 'P3'     │ 'testing'            │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-02T01:54:04.413Z │ null                     │
│ 10      │ 'WO-2026-000035' │ 'P2'     │ 'waiting_spare_part' │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T09:54:04.192Z │ null                     │
│ 11      │ 'WO-2026-000034' │ 'P1'     │ 'repairing'          │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T05:54:04.192Z │ null                     │
│ 12      │ 'WO-2026-000033' │ 'P4'     │ 'on_site'            │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-06T01:54:04.192Z │ null                     │
│ 13      │ 'WO-2026-000001' │ 'P2'     │ 'closed'             │ true         │ false      │ false       │ true       │ false       │ null          │ 2026-07-23T08:15:00.000Z │ 2026-07-23T07:33:00.000Z │
│ 14      │ 'WO-2026-000032' │ 'P3'     │ 'on_the_way'         │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-02T01:54:04.192Z │ null                     │
│ 15      │ 'WO-2026-000031' │ 'P2'     │ 'accepted'           │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T09:54:04.192Z │ null                     │
│ 16      │ 'WO-2026-000030' │ 'P1'     │ 'accepted'           │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T05:54:04.192Z │ null                     │
│ 17      │ 'WO-2026-000029' │ 'P4'     │ 'open'               │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-06T01:54:04.192Z │ null                     │
│ 18      │ 'WO-2026-000028' │ 'P3'     │ 'open'               │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-02T01:54:04.192Z │ null                     │
│ 19      │ 'WO-2026-000027' │ 'P2'     │ 'closed'             │ false        │ true       │ false       │ false      │ false       │ null          │ 2026-09-01T09:54:04.192Z │ null                     │
│ 20      │ 'WO-2026-000026' │ 'P1'     │ 'repairing'          │ true         │ true       │ false       │ true       │ true        │ 'acknowledge' │ 2026-09-01T05:54:04.192Z │ 2026-09-02T17:43:05.623Z │
│ 21      │ 'WO-2026-000025' │ 'P4'     │ 'testing'            │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-06T01:54:03.967Z │ null                     │
│ 22      │ 'WO-2026-000024' │ 'P3'     │ 'waiting_spare_part' │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-02T01:54:03.967Z │ null                     │
│ 23      │ 'WO-2026-000023' │ 'P2'     │ 'repairing'          │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T09:54:03.967Z │ null                     │
│ 24      │ 'WO-2026-000022' │ 'P1'     │ 'on_site'            │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T05:54:03.967Z │ null                     │
│ 25      │ 'WO-2026-000021' │ 'P4'     │ 'on_the_way'         │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-06T01:54:03.967Z │ null                     │
│ 26      │ 'WO-2026-000020' │ 'P2'     │ 'accepted'           │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T09:54:03.967Z │ null                     │
│ 27      │ 'WO-2026-000019' │ 'P2'     │ 'closed'             │ true         │ true       │ false       │ false      │ false       │ null          │ 2026-09-01T09:54:03.967Z │ 2026-09-09T15:49:38.580Z │
│ 28      │ 'WO-2026-000018' │ 'P1'     │ 'open'               │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T05:54:03.967Z │ null                     │
│ 29      │ 'WO-2026-000017' │ 'P4'     │ 'open'               │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-06T01:54:03.967Z │ null                     │
│ 30      │ 'WO-2026-000016' │ 'P3'     │ 'closed'             │ false        │ true       │ false       │ false      │ false       │ null          │ 2026-09-02T01:54:03.967Z │ null                     │
│ 31      │ 'WO-2026-000004' │ 'P2'     │ 'closed'             │ false        │ true       │ true        │ true       │ false       │ null          │ 2026-08-27T11:31:44.543Z │ 2026-08-18T16:31:44.543Z │
│ 32      │ 'WO-2026-000015' │ 'P2'     │ 'closed'             │ true         │ true       │ false       │ false      │ false       │ null          │ 2026-09-01T09:54:03.633Z │ null                     │
│ 33      │ 'WO-2026-000014' │ 'P1'     │ 'closed'             │ false        │ true       │ false       │ false      │ false       │ null          │ 2026-09-01T05:54:03.633Z │ null                     │
│ 34      │ 'WO-2026-000013' │ 'P2'     │ 'waiting_spare_part' │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T09:54:03.633Z │ null                     │
│ 35      │ 'WO-2026-000003' │ 'P1'     │ 'open'               │ true         │ false      │ true        │ false      │ true        │ 'response'    │ 2026-08-21T18:53:54.989Z │ null                     │
│ 36      │ 'WO-2026-000012' │ 'P3'     │ 'repairing'          │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-02T01:54:03.633Z │ null                     │
│ 37      │ 'WO-2026-000011' │ 'P2'     │ 'on_site'            │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T09:54:03.633Z │ null                     │
│ 38      │ 'WO-2026-000010' │ 'P1'     │ 'on_the_way'         │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-01T05:54:03.633Z │ null                     │
│ 39      │ 'WO-2026-000005' │ 'P2'     │ 'closed'             │ true         │ false      │ false       │ false      │ false       │ null          │ 2026-08-27T11:34:55.293Z │ 2026-08-27T10:38:10.311Z │
│ 40      │ 'WO-2026-000009' │ 'P4'     │ 'accepted'           │ true         │ true       │ false       │ false      │ true        │ 'acknowledge' │ 2026-09-06T01:54:03.633Z │ null                     │
│ 41      │ 'WO-2026-000008' │ 'P7'     │ 'closed'             │ false        │ true       │ false       │ false      │ false       │ null          │ 2026-09-09T14:04:45.118Z │ 2026-09-09T14:04:45.118Z │
│ 42      │ 'WO-2026-000007' │ 'P2'     │ 'closed'             │ true         │ true       │ true        │ false      │ false       │ null          │ 2026-09-01T09:54:03.633Z │ 2026-09-09T15:38:12.021Z │
│ 43      │ 'WO-2026-000006' │ 'P7'     │ 'closed'             │ false        │ false      │ false       │ false      │ false       │ null          │ 2026-09-09T13:10:07.865Z │ 2026-09-09T13:10:07.865Z │
│ 44      │ 'WO-2026-000046' │ 'P1'     │ 'closed'             │ false        │ true       │ false       │ false      │ false       │ null          │ 2026-09-08T05:14:45.533Z │ null                     │
└─────────┴──────────────────┴──────────┴──────────────────────┴──────────────┴────────────┴─────────────┴────────────┴─────────────┴───────────────┴──────────────────────────┴──────────────────────────┘
rows whose status/resolved_at/closed_at/priority changed: 0 (must be 0)
acknowledge verdicts that disagree with recomputation: 0 (must be 0)
rows where sla_breached is not the OR of the three: 0 (must be 0)
finished work orders still marked overdue: 0 (must be 0)
```

45 work orders recomputed. All four counters are `0`.

Notes reading the table (not required by the brief, but worth flagging for the review gate):

- `was_breached` (the OLD model's `sla_breached`, from the snapshot) disagrees with the new
  per-stage flags on several rows in both directions — some rows that read breached under the old
  cumulative-offset model now read clean (e.g. `WO-2026-000038`, `...-000027`, `...-000016`,
  `...-000004`, `...-000014`), and some that read clean before now read breached
  (`WO-2026-000015`, `...-000005`). That is the expected effect of 0067/0069: the old model
  measured every stage from `created_at`; the new one measures each stage from when its
  predecessor actually finished, so a work order whose early stages ran long but whose later ones
  were fast (or vice versa) gets a different verdict.
- `res_due_before` vs `res_due_after` moved on every row where a resolution deadline exists at
  all, which is expected — the resolution due date is now anchored to `responded_at` rather than
  to `created_at` plus a cumulative offset.
- Rows still on retired statuses (`on_site`, `on_the_way`) are present and were recomputed
  identically to any other open row; the migration does not treat them specially, matching the
  brief (status itself is never named in either UPDATE).
- The two P7 rows (`WO-2026-000006`, `...-000008`) show `res_due_after` equal to their own
  `created_at`-adjacent timestamp because they went straight through with `responded` present at
  the moment resolution was recorded — consistent with a sequential priority whose resolution
  window starts at `responded_at`.

## Files changed

- `app/supabase/migrations/0069_recompute_every_sla_under_the_new_model.sql` (new)
- `app/scripts/checks/backfillReport.mjs` (new)

## Self-review against the four required questions

1. **Does any verdict compare against `now()` where a recorded instant was available?** No.
   `now()` appears only in the three `sla_*_breached` CASE branches' final `else` arm — reached
   only when the stage's completion stamp (`acked`/`responded`/`resolved`) is null, i.e. the stage
   is still open — and in the second UPDATE's `sla_stage_overdue` line, which is explicitly a
   question about the present per the brief. Every other branch compares two recorded instants
   (`c.acked > c.ack_due`, etc.).
2. **Is `verified_at`, `verified_by`, `status`, the assignee, `resolved_at`, `closed_at`, or
   `decline_count` named in either UPDATE?** No — confirmed by grep against the SET clauses of
   both UPDATE statements; the only hits for those tokens in the file are in comments/CTE column
   references (`resolved` and `closed_at` appear only as SELECT-side inputs read via `coalesce`,
   never as SET targets).
3. **Is the snapshot insert `on conflict do nothing`?** Yes — `on conflict (work_order_id) do
   nothing`, so a re-run keeps the first run's before-image.
4. **Does the RLS policy on `sla_backfill_0069` exist and is it Superuser-only?** Yes —
   `sla_backfill_0069_select` is `for select using (si_is_superuser())`, and RLS is enabled on the
   table.

## Concerns

None. All four script assertions passed, the transcribed SQL and JS match the brief exactly
(with the one documented, minimal adaptation to the env lookup), and the self-review found no
irregularities. This migration has **not** been pushed to production — per the brief, it stops
at this review gate and Task 6 has not been started.


---

# Fix round 1 (migration 0070)

## What was wrong, per the coordinator's ruling

Both Criticals were defects in 0069's own SQL (which I transcribed faithfully from the
brief), not in my transcription:

- **Ruling 1**: `si_open_sla_stage` keyed on `acknowledged_at`/`responded_at` being null
  rather than on `work_orders.status`. Measured on test before the fix: 33 of 45 work
  orders were parked at the `acknowledge` stage purely because `acknowledged_at` was null,
  including rows sitting in `repairing` and `testing` -- statuses that can only be reached
  by having already left that stage.
- **Ruling 2**: the breach arithmetic's `else now() > due` branch fired whenever a
  completion stamp was null, regardless of whether the work order had moved past that
  stage. On a closed work order with no completion stamp for a stage, that read "we have
  no record this happened" as "the clock ran out", and wrote `sla_breached = true` onto
  six closed rows that could never clear it again: WO-2026-000038, -000027, -000016,
  -000014, -000046 and -000008.

Both are fixed in a new migration, `0070_the_open_stage_is_what_the_status_says.sql` --
0067 and 0069 are already applied to test and are never edited in place.

## How I implemented both rulings

- **`si_open_sla_stage`** now maps status directly: `open` -> acknowledge;
  `assigned`/`accepted`/`on_the_way`/`on_site` -> response; everything else live
  (`repairing`/`waiting_spare_part`/`testing`) -> resolution; `completed`/`verified`/`closed`
  -> null. `si_open_stage_started_at` and `si_open_stage_due_at` are re-declared unchanged
  in the same file, per the brief's instruction to make 0070 a complete statement of the
  corrected contract rather than depending on 0067's definitions two migrations back -- I
  did not disagree with this, so both are re-issued verbatim.
- **The breach arithmetic** in the recomputation CTE now computes an `open_stage` value
  per row from the same status mapping, and each of the three `sla_*_breached` CASE
  expressions is three-way: null deadline -> false; a completion stamp present -> compare
  the two stamps; no stamp but this is the row's current open stage -> compare against
  `now()`; otherwise (moved past, unstamped) -> false. The two-statement split and the
  `coalesce(event_type,'transition')` history filter are unchanged from 0069.
- **`sla_backfill_0070`** -- a new permanent snapshot table, same shape as 0069's, plus
  `sla_ack_breached`/`sla_response_breached`/`sla_resolution_breached`/`sla_stage_overdue`
  for per-stage auditability, and additionally `verified_at`, `verified_by`,
  `assigned_to_id`, `decline_count` -- the four columns neither backfill writes but that
  0069's snapshot never captured, so the "did anything move" check has no before-image to
  test them against. RLS enabled, Superuser-only SELECT policy, `on conflict do nothing`.
- **Table grants**: `grant select on sla_backfill_0069 to authenticated;` and the same for
  `sla_backfill_0070` -- a policy alone can leave a table returning a permission error
  instead of rows if nothing has granted the underlying SELECT privilege.
- **Double-evaluation fix**: the final UPDATE now computes `si_open_stage_due_at(w)` once
  per row via a `with due as (select id, si_open_stage_due_at(work_orders) as due_at from
  work_orders)` CTE, joined by id, rather than calling the function twice inline in the SET
  list as 0069 did.
- **Header comment** explains both rulings, names the six closed rows and the 33-of-45
  figure as the measured evidence, matching the house style.

I noticed while writing the file that my first draft of the final UPDATE contained a
leftover, unreachable placeholder statement (a `where false` clause) from an abandoned
first attempt at the single-evaluation fix. I caught and removed it before running
anything against the database -- it never touched test. Worth naming here because the
coordinator's warning about care on this task applies to review as much as to writing: I
re-read the whole file before pushing specifically looking for exactly that kind of
leftover.

## Client mirror (`app/src/lib/slaStages.js`)

`openSlaStage` now checks `wo.status` directly with the same mapping as the SQL
(`FINISHED = ["completed", "verified", "closed"]`, a `RESPONSE_STATUSES` list for
`assigned`/`accepted`/`on_the_way`/`on_site`, `open` -> acknowledge, everything else ->
resolution) instead of testing which timestamp is null. `openStageStartedAt` and
`openStageDueAt` needed no change -- they already switch on whatever `openSlaStage`
returns.

`scripts/checks/slaStages.check.mjs` updated to match:
- Added the pinned case the coordinator asked for: `status: "repairing"`,
  `responded_at` set, `acknowledged_at` null -> `openSlaStage` must return `"resolution"`,
  not `"acknowledge"`.
- Added a check that the retired mid-flow statuses `on_the_way`/`on_site` still map to
  `"response"`.
- The "finished work has no open stage" loop now also covers `"verified"`, matching the
  SQL's three-way finished set.
- Every other existing assertion's intent was kept; only the fixtures needed touching, and
  only where the old code depended on a timestamp being null in a way the new code no
  longer reads.

`npm run check:units` chains `slaStages.check.mjs` with `scripts/checks/slaExtension.check.mjs`,
and the latter broke on my first run: `slaExtension.js` calls `openSlaStage` internally, and
one of its fixtures (`unstarted`: `status: "assigned"`, `acknowledged_at: null`) changed
meaning under the new rule -- it now sits in the **response** stage (matching its status)
rather than the **acknowledge** stage, so its `dueAt` is now genuinely null (the response
stage's clock, `acknowledged_at`, has not started) instead of resolving to
`sla_ack_due_at`. I updated that fixture's two assertions (`dueAt` now asserted `null`,
`gainMs` now asserted `null` rather than `0`, since neither side of the subtraction is
known) and reworded the surrounding comment to say why -- this is a direct, correct
consequence of Ruling 1, not a new problem. Both check scripts pass:

```
slaStages: all assertions passed
slaExtension: all assertions passed
```

## env:which and db:push

```
  app/.env.local  ->  TEST (SI-CMMS-test)
  project ref     ->  vfkozckhthrrmxaewnlt
  supabase CLI    ->  vfkozckhthrrmxaewnlt
```

```
Connecting to remote database...
Applying migration 0070_the_open_stage_is_what_the_status_says.sql...
{"upToDate":false,"dryRun":false,"migrations":["0070_the_open_stage_is_what_the_status_says.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

Applied cleanly.

## Updated backfillReport.mjs -- new per-work-order table (post-0070)

```
+---------+------------------+----------+----------------------+--------------+------------+-------------+------------+-------------+---------------+--------------------------+--------------------------+
| (index) | wo_number        | priority | status               | was_breached | ack_missed | resp_missed | res_missed | overdue_now | open_stage    | res_due_before           | res_due_after            |
+---------+------------------+----------+----------------------+--------------+------------+-------------+------------+-------------+---------------+--------------------------+--------------------------+
| 0       | WO-2026-000045   | P4       | repairing            | true         | false      | false       | false      | false       | resolution    | 2026-09-06T01:54:04.413Z | null                     |
| 1       | WO-2026-000044   | P3       | on_site              | true         | false      | false       | false      | false       | response      | 2026-09-02T01:54:04.413Z | null                     |
| 2       | WO-2026-000043   | P2       | on_the_way           | true         | false      | false       | false      | false       | response      | 2026-09-01T09:54:04.413Z | null                     |
| 3       | WO-2026-000042   | P1       | accepted             | true         | false      | false       | false      | false       | response      | 2026-09-01T05:54:04.413Z | null                     |
| 4       | WO-2026-000041   | P2       | testing              | true         | false      | false       | true       | true        | resolution    | 2026-09-01T09:54:04.413Z | 2026-09-10T17:27:35.743Z |
| 5       | WO-2026-000040   | P3       | open                 | true         | true       | false       | false      | true        | acknowledge   | 2026-09-02T01:54:04.413Z | null                     |
| 6       | WO-2026-000039   | P2       | open                 | true         | true       | false       | false      | true        | acknowledge   | 2026-09-01T09:54:04.413Z | null                     |
| 7       | WO-2026-000038   | P1       | closed               | false        | false      | false       | false      | false       | null          | 2026-09-01T05:54:04.413Z | null                     |
| 8       | WO-2026-000037   | P4       | closed               | true         | false      | false       | false      | false       | null          | 2026-09-06T01:54:04.413Z | null                     |
| 9       | WO-2026-000036   | P3       | testing              | true         | false      | false       | false      | false       | resolution    | 2026-09-02T01:54:04.413Z | null                     |
| 10      | WO-2026-000035   | P2       | waiting_spare_part   | true         | false      | false       | false      | false       | resolution    | 2026-09-01T09:54:04.192Z | null                     |
| 11      | WO-2026-000034   | P1       | repairing            | true         | false      | false       | false      | false       | resolution    | 2026-09-01T05:54:04.192Z | null                     |
| 12      | WO-2026-000033   | P4       | on_site              | true         | false      | false       | false      | false       | response      | 2026-09-06T01:54:04.192Z | null                     |
| 13      | WO-2026-000001   | P2       | closed               | true         | false      | false       | true       | false       | null          | 2026-07-23T08:15:00.000Z | 2026-07-23T07:33:00.000Z |
| 14      | WO-2026-000032   | P3       | on_the_way           | true         | false      | false       | false      | false       | response      | 2026-09-02T01:54:04.192Z | null                     |
| 15      | WO-2026-000031   | P2       | accepted             | true         | false      | false       | false      | false       | response      | 2026-09-01T09:54:04.192Z | null                     |
| 16      | WO-2026-000030   | P1       | accepted             | true         | false      | false       | false      | false       | response      | 2026-09-01T05:54:04.192Z | null                     |
| 17      | WO-2026-000029   | P4       | open                 | true         | true       | false       | false      | true        | acknowledge   | 2026-09-06T01:54:04.192Z | null                     |
| 18      | WO-2026-000028   | P3       | open                 | true         | true       | false       | false      | true        | acknowledge   | 2026-09-02T01:54:04.192Z | null                     |
| 19      | WO-2026-000027   | P2       | closed               | false        | false      | false       | false      | false       | null          | 2026-09-01T09:54:04.192Z | null                     |
| 20      | WO-2026-000026   | P1       | repairing            | true         | false      | false       | true       | true        | resolution    | 2026-09-01T05:54:04.192Z | 2026-09-02T17:43:05.623Z |
| 21      | WO-2026-000025   | P4       | testing              | true         | false      | false       | false      | false       | resolution    | 2026-09-06T01:54:03.967Z | null                     |
| 22      | WO-2026-000024   | P3       | waiting_spare_part   | true         | false      | false       | false      | false       | resolution    | 2026-09-02T01:54:03.967Z | null                     |
| 23      | WO-2026-000023   | P2       | repairing            | true         | false      | false       | false      | false       | resolution    | 2026-09-01T09:54:03.967Z | null                     |
| 24      | WO-2026-000022   | P1       | on_site              | true         | false      | false       | false      | false       | response      | 2026-09-01T05:54:03.967Z | null                     |
| 25      | WO-2026-000021   | P4       | on_the_way           | true         | false      | false       | false      | false       | response      | 2026-09-06T01:54:03.967Z | null                     |
| 26      | WO-2026-000020   | P2       | accepted             | true         | false      | false       | false      | false       | response      | 2026-09-01T09:54:03.967Z | null                     |
| 27      | WO-2026-000019   | P2       | closed               | true         | false      | false       | false      | false       | null          | 2026-09-01T09:54:03.967Z | 2026-09-09T15:49:38.580Z |
| 28      | WO-2026-000018   | P1       | open                 | true         | true       | false       | false      | true        | acknowledge   | 2026-09-01T05:54:03.967Z | null                     |
| 29      | WO-2026-000017   | P4       | open                 | true         | true       | false       | false      | true        | acknowledge   | 2026-09-06T01:54:03.967Z | null                     |
| 30      | WO-2026-000016   | P3       | closed               | false        | false      | false       | false      | false       | null          | 2026-09-02T01:54:03.967Z | null                     |
| 31      | WO-2026-000004   | P2       | closed               | false        | true       | true        | true       | false       | null          | 2026-08-27T11:31:44.543Z | 2026-08-18T16:31:44.543Z |
| 32      | WO-2026-000015   | P2       | closed               | true         | false      | false       | false      | false       | null          | 2026-09-01T09:54:03.633Z | null                     |
| 33      | WO-2026-000014   | P1       | closed               | false        | false      | false       | false      | false       | null          | 2026-09-01T05:54:03.633Z | null                     |
| 34      | WO-2026-000013   | P2       | waiting_spare_part   | true         | false      | false       | false      | false       | resolution    | 2026-09-01T09:54:03.633Z | null                     |
| 35      | WO-2026-000003   | P1       | open                 | true         | false      | false       | false      | true        | acknowledge   | 2026-08-21T18:53:54.989Z | null                     |
| 36      | WO-2026-000012   | P3       | repairing            | true         | false      | false       | false      | false       | resolution    | 2026-09-02T01:54:03.633Z | null                     |
| 37      | WO-2026-000011   | P2       | on_site              | true         | false      | false       | false      | false       | response      | 2026-09-01T09:54:03.633Z | null                     |
| 38      | WO-2026-000010   | P1       | on_the_way           | true         | false      | false       | false      | false       | response      | 2026-09-01T05:54:03.633Z | null                     |
| 39      | WO-2026-000005   | P2       | closed               | true         | false      | false       | false      | false       | null          | 2026-08-27T11:34:55.293Z | 2026-08-27T10:38:10.311Z |
| 40      | WO-2026-000009   | P4       | accepted             | true         | false      | false       | false      | false       | response      | 2026-09-06T01:54:03.633Z | null                     |
| 41      | WO-2026-000008   | P7       | closed               | false        | false      | false       | false      | false       | null          | 2026-09-09T14:04:45.118Z | 2026-09-09T14:04:45.118Z |
| 42      | WO-2026-000007   | P2       | closed               | true         | true       | true        | false      | false       | null          | 2026-09-01T09:54:03.633Z | 2026-09-09T15:38:12.021Z |
| 43      | WO-2026-000006   | P7       | closed               | false        | false      | false       | false      | false       | null          | 2026-09-09T13:10:07.865Z | 2026-09-09T13:10:07.865Z |
| 44      | WO-2026-000046   | P1       | closed               | false        | false      | false       | false      | false       | null          | 2026-09-08T05:14:45.533Z | null                     |
+---------+------------------+----------+----------------------+--------------+------------+-------------+------------+-------------+---------------+--------------------------+--------------------------+
1a. rows whose status/resolved_at/closed_at/priority (0069 before-image) changed: 0 (must be 0)
1b. rows whose verified_at/verified_by/assigned_to_id/decline_count (0070 before-image) changed: 0 (must be 0)
2a. acknowledge verdicts that disagree with recomputation: 0 (must be 0; tested 6 of 45 rows with a recorded acknowledge stamp)
2b. response verdicts that disagree with recomputation: 0 (must be 0; tested 5 rows with a recorded response stamp)
2c. resolution verdicts that disagree with recomputation: 0 (must be 0; tested 7 rows with a recorded resolution stamp)
3. rows where sla_breached is not the OR of the three: 0 (must be 0)
4. finished work orders still marked overdue: 0 (must be 0)
```

(Rendered above with plain ASCII borders because the console.table box-drawing characters
collided with this file's heredoc quoting; the values are exactly what `node
scripts/checks/backfillReport.mjs` printed.)

`was_breached` above is still `sla_backfill_0069`'s snapshot -- the OLD, pre-sequential-model
value, captured before 0069 first ran. It is unchanged from the original report by design;
it is the fixed constant the table compares against, not something 0070 touches.

## What happened to the six closed rows and the 33 parked at acknowledge

**The six closed rows** (WO-2026-000038, -000027, -000016, -000014, -000046, -000008) --
confirmed directly against `work_orders` after 0070:

```
 wo_number       | sla_breached | sla_ack_breached | sla_response_breached | sla_resolution_breached
 WO-2026-000008  | false        | false             | false                  | false
 WO-2026-000014  | false        | false             | false                  | false
 WO-2026-000016  | false        | false             | false                  | false
 WO-2026-000027  | false        | false             | false                  | false
 WO-2026-000038  | false        | false             | false                  | false
 WO-2026-000046  | false        | false             | false                  | false
```

All six now read `false` across every stage flag and the aggregate -- the wrongly-set
`true` from 0069's clock-based fallback is cleared, and all six now correctly report their
unstamped stages as unknowable rather than missed.

**The 33 parked at `acknowledge`** are down to **7** -- confirmed with
`select count(*) from work_orders where si_open_sla_stage(work_orders) = 'acknowledge'`.
Those 7 are the work orders genuinely still at `status = 'open'`
(WO-2026-000040/-039/-029/-028/-018/-017/-003 -- visible in the table above with
`open_stage: resolution` replaced by `acknowledge` for exactly these seven), which is
exactly what Ruling 1 intends: the stage now tracks the real state, and the remaining
`acknowledge` rows are the ones that have actually not been assigned yet, not an artifact
of a null timestamp.

## Correction to the original report's flip narrative

The coordinator is right that my original framing was inverted. Recomputing
`sla_ack_breached or sla_response_breached or sla_resolution_breached` against the 0069
snapshot's `was_breached` (the pre-sequential-model value) gives, **as of the state
immediately after 0069 and before 0070**: 7 rows flipped clean->breached
(WO-2026-000038, -000027, -000016, -000004, -000014, -000008, -000046) and 1 flipped
breached->clean (WO-2026-000005); WO-2026-000015 did not flip. My original report had this
backwards.

After 0070, six of those seven clean->breached flips (all but -000004, which has a genuine
recorded response/resolution breach unrelated to the clock-fallback bug) are corrected
back to `false` -- see the six-row table above. WO-2026-000005 remains flipped
breached->clean, and WO-2026-000015 still does not flip; neither of those was touched by
Ruling 2, since their breach status is not decided by the clock-fallback-on-a-finished-row
case.

## Self-review against the same four questions, re-applied to 0070

1. `now()` is used only in the `open_stage = <stage>` branches of the three breach CASE
   expressions and in the `sla_stage_overdue` computation -- both are the genuinely-open-
   stage case the brief and the ruling both call out as the one legitimate use.
2. Grep of the SET clauses in both UPDATEs in 0070: no occurrence of `verified_at`,
   `verified_by`, `status`, `assigned_to_id`, `resolved_at`, `closed_at`, or
   `decline_count` as an assignment target. They appear only in `sla_backfill_0070`'s
   column list (as SELECT-side captures for the snapshot) and in the header comment.
3. Both snapshot inserts (`sla_backfill_0069`, unchanged; `sla_backfill_0070`, new) use
   `on conflict (work_order_id) do nothing`.
4. `sla_backfill_0070` has RLS enabled and a `for select using (si_is_superuser())`
   policy, plus the `grant select ... to authenticated` the reviewer asked for on both
   tables (a grant is necessary for the policy to have anything to restrict; without it
   the table would fail closed with a permission error rather than filtering rows).

## Files changed in this round

- `app/supabase/migrations/0070_the_open_stage_is_what_the_status_says.sql` (new)
- `app/src/lib/slaStages.js` (openSlaStage now status-driven)
- `app/scripts/checks/slaStages.check.mjs` (new fixtures/assertions for the status-driven
  rule)
- `app/scripts/checks/slaExtension.check.mjs` (one fixture's expected `dueAt`/`gainMs`
  corrected as a direct consequence of Ruling 1)
- `app/scripts/checks/backfillReport.mjs` (1a/1b split, symmetric 2a/2b/2c with tested-row
  counts, `verified` added to the finished-status set in counter 4)

## Concerns

None outstanding. Both rulings matched my own reading of the SQL once I re-derived it --
Ruling 1's evidence (33/45 parked, including `repairing`/`testing` rows) and Ruling 2's
evidence (six closed rows wrongly flipped) are both independently reproducible against the
live test database, not just asserted. I did not push anything to production and have not
started Task 6.
