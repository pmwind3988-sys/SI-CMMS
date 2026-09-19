# Release runbook — sequential SLA stages, P8, and Extend SLA

Branch `claude/sleepy-sammet-126237`. Nine migrations reach production: **0042**, then
**0067–0074**.

**Database first, web second.** The new pages read columns that do not exist until the
migrations land, so deploying the web half first gives every user an error page. There is no
ordering in which the reverse is bad: the old pages simply ignore the new columns.

**The backfill is irreversible.** 0069 and 0070 rewrite the SLA columns of *every* work order,
closed ones included. They snapshot the before-image into `sla_backfill_0069` and
`sla_backfill_0070` first, so the old values survive — but nothing puts them back
automatically. Step 4 is where you decide whether you believe the result, and it is the only
gate that matters.

Set aside 30–45 minutes. Do not do this while people are raising work orders if you can avoid it.

---

## Step 0 — before you touch anything

Run in the **production** SQL editor:

```sql
select version from supabase_migrations.schema_migrations order by version desc limit 5;
select count(*) as work_orders from work_orders;
select count(*) filter (where sla_breached) as breached_now from work_orders;
```

Write down those three answers. The last two are what you will compare against afterwards.

Expected: the newest version is `0066`. **If it is anything else, stop** — the plan below was
built against a production that is complete through 0066 and missing 0042, and something has
changed since that was measured.

---

## Step 1 — apply the migrations

### The route to try first

```bash
cd app
npm run env:prod
npm run env:which          # must say PROD (SI-CMMS)
npm run db:push
```

`db:push` applies the nine files in order **and records them in the migration ledger**, which
matters more than it sounds — see the fallback below.

It will list what it is about to apply. **Read that list before confirming.** It should be
exactly `0042`, `0067`, `0068`, `0069`, `0070`, `0071`, `0072`, `0073`, `0074` and nothing else.

Then put the tooling back where it was, so nothing later points at production by accident:

```bash
npm run env:test
npm run env:which          # must say TEST
```

### If `db:push` fails

It has failed on this machine before with a `TransportError`. The fallback is the Supabase SQL
editor: open each file under `app/supabase/migrations/` **in the order listed above**, paste its
whole contents, run it, and confirm success before starting the next.

**If you use the SQL editor, you must also record each version yourself.** The editor does not
touch the ledger, so without this a later `db:push` tries to apply all nine again:

```sql
insert into supabase_migrations.schema_migrations (version)
values ('0042'),('0067'),('0068'),('0069'),('0070'),
       ('0071'),('0072'),('0073'),('0074')
on conflict do nothing;
```

Run that **only after every file has succeeded**, never before.

---

## Step 2 — confirm the schema landed

```sql
-- All nine, newest last.
select version from supabase_migrations.schema_migrations
 where version >= '0067' or version = '0042' order by version;

-- Every priority is sequential, and the three stages sum to the old promise.
select priority_id,
       ack_target_minutes  as ack,
       response_target_minutes as response,
       resolution_target_minutes as resolution,
       ack_target_minutes + response_target_minutes + resolution_target_minutes as total,
       targets_are_sequential as sequential
  from sla order by priority_id;
```

Expected totals: P1 **240**, P2 **480**, P3 **1440**, P4 **7200**, P7 **21600**, P8 **43200** —
and `sequential` true on every row. Those totals are each priority's promise unchanged since
migration 0006; if one is off, the conversion is wrong and you should stop.

---

## Step 3 — the numbers before and after

```sql
select count(*)                                   as work_orders,
       count(*) filter (where sla_breached)        as ever_missed,
       count(*) filter (where sla_stage_overdue)   as late_right_now,
       count(*) filter (where sla_ack_breached)        as missed_ack,
       count(*) filter (where sla_response_breached)   as missed_response,
       count(*) filter (where sla_resolution_breached) as missed_resolution
  from work_orders;
```

**Expect `ever_missed` to fall, possibly a lot.** On test it went from 37 to 11 out of 45. That
is the change working: jobs previously judged late for the *repair* were actually late getting
*started*, and that now shows as a missed early stage instead. `late_right_now` will be much
smaller than the old breach count, because it only counts work that is late *at this moment*.

Sanity checks that must hold:

```sql
-- sla_breached must be exactly the OR of the three. Expect 0.
select count(*) from work_orders
 where sla_breached is distinct from
       (sla_ack_breached or sla_response_breached or sla_resolution_breached);

-- Nothing finished should be flagged as currently overdue. Expect 0.
select count(*) from work_orders
 where sla_stage_overdue and status in ('completed','closed');
```

---

## Step 4 — the gate: read the before/after table

This is the one step not to skim. It is the same review you did on test.

```sql
select w.wo_number, w.priority, w.status,
       b.sla_breached            as was_breached,
       w.sla_ack_breached        as missed_ack,
       w.sla_response_breached   as missed_response,
       w.sla_resolution_breached as missed_resolution,
       w.sla_stage_overdue       as late_now,
       si_open_sla_stage(w)      as open_stage
  from work_orders w
  join sla_backfill_0069 b on b.work_order_id = w.id
 order by w.created_at desc
 limit 100;
```

Read a dozen rows you recognise and ask of each: *does this verdict match what actually
happened to that job?* You know the history; the database only knows the timestamps.

The worked example from test — including what the counters should say — is in
[`docs/superpowers/evidence/2026-09-19-sla-backfill-on-test.md`](../superpowers/evidence/2026-09-19-sla-backfill-on-test.md).

**If a row looks wrong, stop here and say so.** The web app is not deployed yet, so at this
point the only thing that has changed is data nobody is looking at, and `sla_backfill_0069`
still holds every original value.

---

## Step 5 — decide about the per-minute job

0042 installed web push, which production has never had. It is asleep — it looks for
credentials, finds none, does nothing — but a background job now runs once a minute.

```sql
select jobname, schedule, active from cron.job where jobname = 'si-push-retry';
```

If you do not want it running:

```sql
select cron.unschedule('si-push-retry');
```

Nothing breaks either way. The line at the foot of `0042_web_push.sql` re-creates it on the day
web push is actually set up.

---

## Step 6 — deploy the web app

Only once steps 2–4 look right.

```bash
git checkout main
git pull
git merge claude/sleepy-sammet-126237
git push origin main
```

Vercel builds `si-cmms.vercel.app` from `main` with the production environment variables. Watch
the deploy finish before testing.

---

## Step 7 — check it in the browser

Sign in as an Administrator on the live site:

- **The dashboard's Overdue card** reads a plausible number, and clicking it lists jobs whose
  *current* stage is late.
- **The work order list** shows a live countdown in the SLA column for jobs that have not
  started yet. Before this change they would have shown "—".
- **Open a work order.** Its SLA panel shows three stages, each marked Missed or Running where
  appropriate.
- **Raise a work order** and check the priority previews correctly. "Scheduled work
  (month-scale)" should come out as a teal **P8**.
- **On an overdue work order**, an **Extend SLA** button appears for an Administrator. It should
  not appear on a job with plenty of time left.

Then confirm the server and the screen agree:

```sql
select count(*) from work_orders
 where status = any (si_open_statuses()) and sla_stage_overdue;
```

That should match the Overdue card, within one five-minute sweep.

---

## Tell people what changed

Whoever reads the dashboard daily will notice the Overdue number move, in both directions, on
day one. Worth saying before they ask:

> Overdue now means "late at the step it is on right now", and it clears when the job moves on.
> A job's own page still shows, permanently, which steps it missed. And a repair's clock now
> starts when the repair starts, so time spent finding a technician no longer comes out of the
> technician's window.

---

## If something goes wrong

**Before step 6** — nothing user-facing has changed. The old app reads the new columns fine.

**After step 6** — the fastest fix is to put the web app back while leaving the database alone:

```bash
git revert -m 1 <the merge commit>
git push origin main
```

The old pages ignore the new columns, so that is safe.

**Restoring the old SLA values** is a hand-written UPDATE from `sla_backfill_0069`, not a script,
and it would undo a correction rather than a mistake — ask before reaching for it. The
before-image is a permanent table and is not going anywhere.

---

## What this does not cover

- **The security advisor has not been run** against 0067–0074. Run it after the release. Four new
  functions are granted to signed-in users; `si_extend_work_order_sla` will be reported under
  *Signed-In Users Can Execute SECURITY DEFINER Function*, which is correct and deliberate —
  the browser calls it and it re-checks the caller in its own body.
- **Production has no backups on the free plan.** `sla_backfill_0069` is the only before-image of
  the SLA columns, and it only covers those columns.
