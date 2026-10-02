# Extend SLA by a Priority's Amount — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend SLA becomes one list — add any priority's full total to the open stage, absorbing overdue time, never moving the priority.

**Architecture:** One additive migration (0078) adds a column and a new RPC `si_extend_sla_stage`, leaving 0075's `si_extend_work_order_sla` untouched so the live site keeps working. The client's pure helper, write function and dialog switch to the new RPC; the export gains one column.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), Next.js 14 static export, React, `pg` for check scripts, Node `assert` for pure checks.

**Spec:** `docs/superpowers/specs/2026-10-02-extend-sla-by-priority-design.md`

## Global Constraints

- All commands run from `app/`. There is no test runner: pure checks are `node scripts/checks/*.check.mjs`; DB checks are `node scripts/checks/<name>.mjs` against the **test** project inside a rolled-back transaction.
- `npm run env:which` must report **test** before any DB command. Never point anything at production. Never run `supabase config push`.
- Never run `npm run build` while `npm run dev` is running.
- Do **not** run `npm run db:types` (it drops production-only functions); hand-edit `src/lib/database.types.ts`.
- Migration 0078 must be **purely additive and re-runnable**: `add column if not exists`, `create or replace`, `revoke`/`grant`. It must not drop, rename or alter `si_extend_work_order_sla`.
- Every new `public` function: `security definer`, `set search_path = public` in the header, explicit `revoke all ... from public, anon`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prose in comments matches the repo: explain *why*, cite migration numbers.

---

### Task 1: Migration 0078 and its database check

**Model:** opus (SQL + security boundary)

**Files:**
- Create: `app/supabase/migrations/0078_extend_sla_by_a_priority.sql`
- Create: `app/scripts/checks/sla0078ExtendByPriority.mjs`

**Interfaces:**
- Produces: column `work_orders.sla_overdue_absorbed_mins int not null default 0`; RPC `si_extend_sla_stage(p_work_order_id uuid, p_by_priority si_priority) returns void`; helper `si_fmt_minutes_approx(int) returns text`.

- [ ] **Step 1: Write the check script** (it applies the migration file inside `BEGIN … ROLLBACK`, so it fails until the file exists).

Create `app/scripts/checks/sla0078ExtendByPriority.mjs`:

```js
/**
 * Migration 0078 exercised against the live TEST project, inside one
 * transaction that is always rolled back.
 *
 * Run: node scripts/checks/sla0078ExtendByPriority.mjs
 *
 * Applies 0078's own SQL first, so it checks the file rather than a database
 * somebody has changed by hand. A plpgsql body is not parsed until it is
 * called, so these assertions are the only evidence the function works.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const ref = readFileSync(new URL("../../supabase/.temp/project-ref", import.meta.url), "utf8").trim();
assert.equal(ref, "vfkozckhthrrmxaewnlt", "this check runs against SI-CMMS-test only");

let url = env.SUPABASE_DB_URL;
if (!url) {
  const poolerBase = readFileSync(new URL("../../supabase/.temp/pooler-url", import.meta.url), "utf8").trim();
  url = poolerBase.replace(
    /^postgresql:\/\/([^@]+)@/,
    (_, user) => `postgresql://${user}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@`
  );
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

async function setClaims(uid, roles) {
  await c.query(`set local role authenticated`);
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: "authenticated", user_roles: roles, user_role: roles[roles.length - 1], is_protected: false }),
  ]);
}
const asPostgres = () => c.query("reset role");

const ok = [];
const pass = (m) => ok.push(m);
const MIN = 60000;
const near = (a, b, label, tol = 2 * MIN) =>
  assert.ok(Math.abs(new Date(a).getTime() - b) <= tol, `${label}: got ${a}, expected ~${new Date(b).toISOString()}`);

async function refuses(label, fn, fragment) {
  await c.query("savepoint s");
  try {
    await fn();
    throw new Error(`EXPECTED REFUSAL: ${label}`);
  } catch (e) {
    if (e.message.startsWith("EXPECTED REFUSAL")) throw e;
    assert.ok(e.message.includes(fragment), `${label}: expected ${JSON.stringify(fragment)}, got ${JSON.stringify(e.message)}`);
    pass(label);
  } finally {
    await c.query("rollback to savepoint s");
  }
}

const { rows: users } = await c.query(`select id, roles::text[] as roles from users where status = 'active'`);
const admin = users.find((u) => u.roles.includes("admin"));
const technician = users.find((u) => u.roles.includes("technician") && !u.roles.includes("admin"));
const requester = users.find((u) => u.roles.includes("requester") && !u.roles.includes("admin"));
assert.ok(admin && technician && requester, "test project needs an admin, a technician and a requester");

await c.query("begin");
try {
  await c.query(readFileSync(new URL("../../supabase/migrations/0078_extend_sla_by_a_priority.sql", import.meta.url), "utf8"));
  pass("0078 applies cleanly");
  await c.query(readFileSync(new URL("../../supabase/migrations/0078_extend_sla_by_a_priority.sql", import.meta.url), "utf8"));
  pass("0078 applies a second time (SQL Editor re-run is safe)");

  const { rows: [f] } = await c.query(
    `select si_fmt_minutes_approx(45) a, si_fmt_minutes_approx(150) b, si_fmt_minutes_approx(1440) c,
            si_fmt_minutes_approx(14523) d, si_fmt_minutes_approx(null) e`
  );
  assert.deepEqual([f.a, f.b, f.c, f.d, f.e], ["45 mins", "2 hrs 30 mins", "1 day", "10 days 2 hrs", null]);
  pass("si_fmt_minutes_approx reads like a sentence");

  // Fixture: a P7 in an overdue RESOLUTION stage (started 16 days ago, due 9 days ago).
  const { rows: [dept] } = await c.query(`select id from departments limit 1`);
  const { rows: [plant] } = await c.query(`select id from plants where status = 'active' limit 1`);
  const { rows: [asset] } = await c.query(`select id from assets where plant_id = $1 limit 1`, [plant.id]);
  await asPostgres();
  const { rows: [ins] } = await c.query(
    `insert into work_orders (wo_number, description, status, priority, impact, department_id, plant_id, asset_id,
                              requester_id, requester_name, assigned_to_id)
     values ('WO-CHK0078', '0078 fixture', 'testing', 'P7', 'long_term', $1, $2, $3, $4, 'Fixture Requester', $5)
     returning id`,
    [dept.id, plant.id, asset.id, requester.id, technician.id]
  );
  const { rows: [wo0] } = await c.query(
    `update work_orders
        set created_at = now() - interval '20 days', acknowledged_at = now() - interval '18 days',
            responded_at = now() - interval '16 days', sla_ack_due_at = now() - interval '15 days',
            sla_response_due_at = now() - interval '13 days', sla_resolution_due_at = now() - interval '9 days',
            sla_resolution_breached = true, sla_stage_overdue = true, sla_breached = true
      where id = $1 returning *`,
    [ins.id]
  );
  const { rows: [{ s: stage }] } = await c.query(`select si_open_sla_stage(w) s from work_orders w where id = $1`, [wo0.id]);
  assert.equal(stage, "resolution");
  const resDue0 = new Date(wo0.sla_resolution_due_at).getTime();

  // --- Extend by the work order's own priority, P7 = 15 days total, while 9 days overdue.
  await setClaims(admin.id, admin.roles);
  const { rows: [{ now: nowTs }] } = await c.query(`select now()`);
  const now = new Date(nowTs).getTime();
  await c.query(`select si_extend_sla_stage($1, 'P7')`, [wo0.id]);
  await asPostgres();
  const { rows: [t1] } = await c.query(`select * from work_orders where id = $1`, [wo0.id]);

  assert.equal(t1.priority, "P7", "priority never moves");
  assert.equal(t1.priority_override, null, "and nothing is filed as an override");
  assert.equal(t1.impact, "long_term");
  assert.equal(t1.status, "testing", "status unchanged");
  assert.equal(t1.assigned_to_id, technician.id, "assignee unchanged");
  pass("extending moves no priority, impact, status or assignee");

  near(t1.sla_resolution_due_at, now + 15 * 1440 * MIN, "overdue absorbed: due = now + 15 days");
  const absorbed = t1.sla_overdue_absorbed_mins;
  assert.ok(Math.abs(absorbed - 9 * 1440) <= 2, `absorbed ~9 days, got ${absorbed} mins`);
  assert.equal(t1.sla_resolution_extra_mins, absorbed + 15 * 1440, "extra = absorbed + amount");
  assert.equal(t1.sla_ack_extra_mins, 0, "other stages untouched");
  assert.equal(t1.sla_response_extra_mins, 0);
  near(t1.sla_ack_due_at, new Date(wo0.sla_ack_due_at).getTime(), "ack deadline untouched", 1000);
  near(t1.sla_resolution_due_at, resDue0 + (absorbed + 15 * 1440) * MIN, "due = old due + absorbed + amount", 1000);
  pass("an overdue stage gets the full amount from now, and only that stage moves");

  assert.equal(t1.sla_stage_overdue, false, "no longer overdue");
  assert.equal(t1.sla_resolution_breached, true, "a stage that was missed stays missed");
  assert.equal(t1.sla_breached, true);
  assert.equal(t1.sla_top_up_count, 1);
  assert.equal(t1.sla_extension_count, 1);
  pass("sticky breach survives; counts increment");

  const { rows: [h1] } = await c.query(
    `select * from work_order_history where work_order_id = $1 order by created_at desc limit 1`, [wo0.id]);
  assert.equal(h1.event_type, "sla_extension");
  assert.equal(h1.from_status, h1.to_status);
  assert.match(h1.remarks, /Resolution stage was 9 days( \d+ hrs?)? overdue; extended by .*\(P7\), 15 days\. Now due /);
  assert.match(h1.remarks, /Priority unchanged at .*\(P7\)\./);
  pass("timeline remark names the overdue absorbed, the amount and the new deadline");

  const { rows: notes } = await c.query(
    `select recipient_id from notifications where reference_id = $1 and type = 'priority_changed'`, [wo0.id]);
  assert.deepEqual(new Set(notes.map((n) => n.recipient_id)), new Set([technician.id, requester.id]));
  pass("technician and requester are notified");

  // --- Not at risk any more: refused.
  await refuses("refused while most of the stage is left", async () => {
    await setClaims(admin.id, admin.roles);
    await c.query(`select si_extend_sla_stage($1, 'P8')`, [wo0.id]);
  }, "still has most of its");

  // --- In its last quarter, not overdue: amount is added on top, nothing absorbed.
  await asPostgres();
  await c.query(`update work_orders set sla_resolution_due_at = now() + interval '1 day' where id = $1`, [wo0.id]);
  const { rows: [pre] } = await c.query(`select * from work_orders where id = $1`, [wo0.id]);
  await setClaims(admin.id, admin.roles);
  await c.query(`select si_extend_sla_stage($1, 'P8')`, [wo0.id]);
  await asPostgres();
  const { rows: [t2] } = await c.query(`select * from work_orders where id = $1`, [wo0.id]);
  near(t2.sla_resolution_due_at, new Date(pre.sla_resolution_due_at).getTime() + 30 * 1440 * MIN, "not overdue: due = old due + 30 days", 1000);
  assert.equal(t2.sla_overdue_absorbed_mins, absorbed, "nothing more absorbed");
  assert.equal(t2.priority, "P7", "extending BY P8 does not make it P8");
  assert.equal(t2.sla_top_up_count, 2);
  pass("a stage not yet overdue gets the amount on top of what is left");

  // --- Refusals.
  await c.query(`update work_orders set sla_resolution_due_at = now() - interval '1 day' where id = $1`, [wo0.id]);
  await refuses("a technician cannot extend", async () => {
    await setClaims(technician.id, technician.roles);
    await c.query(`select si_extend_sla_stage($1, 'P7')`, [wo0.id]);
  }, "Only an Administrator");
  await refuses("a priority must be chosen", async () => {
    await setClaims(admin.id, admin.roles);
    await c.query(`select si_extend_sla_stage($1, null)`, [wo0.id]);
  }, "Choose how much time");
  await refuses("the absorbed minutes cannot be PATCHed directly", async () => {
    await setClaims(admin.id, admin.roles);
    await c.query(`update work_orders set sla_overdue_absorbed_mins = 0 where id = $1`, [wo0.id]);
  }, "Priority can only be changed");
  await refuses("anon cannot call it", async () => {
    await c.query(`set local role anon`);
    await c.query(`select si_extend_sla_stage($1, 'P7')`, [wo0.id]);
  }, "permission denied");

  // --- The old RPC still works: the live site is not broken by this migration.
  await asPostgres();
  await setClaims(admin.id, admin.roles);
  await c.query(`select si_extend_work_order_sla($1, null, true)`, [wo0.id]);
  pass("si_extend_work_order_sla (0075) is untouched and still callable");

  // --- A later Change priority preserves the extension (the extras are terms in its arithmetic).
  await asPostgres();
  const { rows: [beforeRegrade] } = await c.query(`select * from work_orders where id = $1`, [wo0.id]);
  await setClaims(admin.id, admin.roles);
  await c.query(`select si_override_work_order_priority($1, 'P7', 'check: same priority re-grade')`, [wo0.id]);
  await asPostgres();
  const { rows: [t3] } = await c.query(`select * from work_orders where id = $1`, [wo0.id]);
  assert.equal(t3.sla_resolution_extra_mins, beforeRegrade.sla_resolution_extra_mins, "extras survive a re-grade");
  pass("Change priority preserves granted time");

  await asPostgres();
  console.log("\n" + ok.map((m) => "  PASS  " + m).join("\n"));
  console.log(`\n0078: ${ok.length} assertions passed. Rolling back — nothing is left on test.`);
} finally {
  await c.query("rollback");
  await c.end();
}
```

Before relying on the Change-priority assertion, confirm the signature: `grep -n "create or replace function si_override_work_order_priority" -A5 supabase/migrations/0075_topping_up_a_stage_in_place.sql` and adjust the call's argument order/names to match. Confirm the notifications column names with `grep -n "insert into notifications" -A3 supabase/migrations/0056_*.sql` (adjust `reference_id`/`type` if they differ).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run env:which` (must say test), then `node scripts/checks/sla0078ExtendByPriority.mjs`
Expected: FAIL — `ENOENT` on `0078_extend_sla_by_a_priority.sql`.

- [ ] **Step 3: Write the migration**

Create `app/supabase/migrations/0078_extend_sla_by_a_priority.sql`. The guard in section 2 is 0075's `si_guard_priority_override` reproduced **in full** with one line added to each branch — copy the body from `supabase/migrations/0075_topping_up_a_stage_in_place.sql` (section 3) and add the `sla_overdue_absorbed_mins` lines shown.

```sql
-- ---------------------------------------------------------------------------
-- 0078 — Extend SLA adds a priority's time, and never moves the priority
-- ---------------------------------------------------------------------------
-- Extend SLA had two modes (0072 re-grade, 0075 top-up) beside Change priority
-- (0051), and the re-grade mode was Change priority by a second door. This
-- migration adds the one mode the dialog offers from now on: give the OPEN
-- stage any priority's full total (ack + response + resolution), keep the work
-- order's own priority, and — if the stage is already overdue — count the
-- amount from now rather than from the missed deadline.
--
--   absorbed = max(0, now - due)            (whole minutes, rounded up)
--   extra'   = extra + absorbed + amount    (0075 note 1: the extras survive
--   due'     = due + absorbed + amount       a later re-grade's recompute)
--            = max(now, due) + amount
--
-- PURELY ADDITIVE, and that is the release plan rather than tidiness. The live
-- site calls si_extend_work_order_sla(p_work_order_id, p_priority, p_top_up);
-- PostgREST resolves an RPC by argument-name set, so changing that function
-- would break every open tab the moment this is applied (measured 2026-09-19:
-- PGRST202). It is left exactly as 0075 wrote it. The new client calls
-- si_extend_sla_stage instead; retiring the old function is a later migration.
--
-- Every statement is re-runnable: production migrations go in through the SQL
-- Editor, and the next real db push re-runs the file.
-- ---------------------------------------------------------------------------


-- 1. Where the absorbed overdue time is recorded --------------------------
alter table work_orders add column if not exists sla_overdue_absorbed_mins int not null default 0;

comment on column work_orders.sla_overdue_absorbed_mins is
  'Total minutes of overdue time absorbed by si_extend_sla_stage across every extension: when a stage is extended while overdue, the amount counts from now and the gap is recorded here. Already included in sla_*_extra_mins; reported separately so a report can tell lateness from planned time. Written only by that RPC.';


-- 2. The guard protects the new column ------------------------------------
-- 0075's si_guard_priority_override reproduced in full (create or replace
-- replaces the whole body); the only change is sla_overdue_absorbed_mins in
-- both branches, so a direct PATCH of it is refused like the extras are.
create or replace function si_guard_priority_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
begin
  if auth.uid() is null then return new; end if;
  if si_priority_override() then return new; end if;

  if tg_op = 'INSERT' then
    v_changed := new.priority_override        is not null
              or new.priority_override_reason is not null
              or new.priority_overridden_by   is not null
              or new.priority_overridden_at   is not null
              or coalesce(new.sla_extension_count, 0)       <> 0
              or coalesce(new.sla_top_up_count, 0)          <> 0
              or coalesce(new.sla_ack_extra_mins, 0)        <> 0
              or coalesce(new.sla_response_extra_mins, 0)   <> 0
              or coalesce(new.sla_resolution_extra_mins, 0) <> 0
              or coalesce(new.sla_overdue_absorbed_mins, 0) <> 0;
  else
    v_changed := new.priority_override         is distinct from old.priority_override
              or new.priority_override_reason  is distinct from old.priority_override_reason
              or new.priority_overridden_by    is distinct from old.priority_overridden_by
              or new.priority_overridden_at    is distinct from old.priority_overridden_at
              or new.sla_extension_count       is distinct from old.sla_extension_count
              or new.sla_top_up_count          is distinct from old.sla_top_up_count
              or new.sla_ack_extra_mins        is distinct from old.sla_ack_extra_mins
              or new.sla_response_extra_mins   is distinct from old.sla_response_extra_mins
              or new.sla_resolution_extra_mins is distinct from old.sla_resolution_extra_mins
              or new.sla_overdue_absorbed_mins is distinct from old.sla_overdue_absorbed_mins;
  end if;

  if v_changed then
    raise exception 'Priority can only be changed by an Administrator, with a reason. Use Change priority or Extend SLA on the work order.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_priority_override() from public, anon, authenticated;


-- 3. si_fmt_minutes_approx — "10 days 2 hrs", "2 hrs 30 mins" -------------
-- si_fmt_minutes (0075) only prints exact units, which suits a priority's
-- authored targets and not an overdue gap: 14523 minutes would print as
-- "14523 mins". Two units, the larger first, the remainder below that dropped.
create or replace function si_fmt_minutes_approx(p_mins int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_mins is null then null
    when p_mins < 60 then p_mins::text || ' min' || case when p_mins = 1 then '' else 's' end
    when p_mins < 1440 then
      (p_mins / 60)::text || ' hr' || case when p_mins / 60 = 1 then '' else 's' end ||
      case when p_mins % 60 > 0
           then ' ' || (p_mins % 60)::text || ' min' || case when p_mins % 60 = 1 then '' else 's' end
           else '' end
    else
      (p_mins / 1440)::text || ' day' || case when p_mins / 1440 = 1 then '' else 's' end ||
      case when (p_mins % 1440) / 60 > 0
           then ' ' || ((p_mins % 1440) / 60)::text || ' hr' || case when (p_mins % 1440) / 60 = 1 then '' else 's' end
           else '' end
  end;
$$;

revoke all on function si_fmt_minutes_approx(int) from public, anon;
grant execute on function si_fmt_minutes_approx(int) to authenticated;


-- 4. si_extend_sla_stage --------------------------------------------------
create or replace function si_extend_sla_stage(
  p_work_order_id uuid,
  p_by_priority   si_priority
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w            work_orders;
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_stage      text;
  v_started    timestamptz;
  v_due        timestamptz;
  v_own_label  text;
  v_by_label   text;
  v_ack        int;
  v_resp       int;
  v_res        int;
  v_amount     int;
  v_absorbed   int;
  v_add        int;
  v_new_due    timestamptz;
  v_nth        int;
  v_remark     text;
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- Administrators are system-wide on work orders, so there is no narrower
  -- visibility to restate here (same as 0075).
  if not si_is_admin() then
    raise exception 'Only an Administrator can extend a work order''s SLA.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_by_priority is null then
    raise exception 'Choose how much time to add.' using errcode = 'check_violation';
  end if;

  select * into w from work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'That work order no longer exists.' using errcode = 'no_data_found';
  end if;

  if w.status in ('completed', 'verified', 'closed') then
    raise exception 'This work order is finished, so its SLA is part of the record now and cannot be extended.'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from priorities where id = p_by_priority and is_active) then
    raise exception 'That priority is not in use. Pick another one.' using errcode = 'check_violation';
  end if;

  v_stage   := si_open_sla_stage(w);
  v_started := si_open_stage_started_at(w);
  v_due     := si_open_stage_due_at(w);

  if v_stage is null then
    raise exception 'This work order has no SLA stage running, so there is nothing to extend.'
      using errcode = 'check_violation';
  end if;
  if v_due is null then
    raise exception 'This work order''s % stage has no deadline yet, so there is nothing to extend.', v_stage
      using errcode = 'check_violation';
  end if;

  -- The at-risk gate canExtendSla() mirrors: overdue, or in the last quarter
  -- of the stage's own window (si_sla_warning_sweep's threshold).
  if v_due > now() and (v_started is null or (v_due - now()) > (v_due - v_started) * 0.25) then
    raise exception 'This work order still has most of its % time left. An SLA is extended when it is running out, not before.', v_stage
      using errcode = 'check_violation';
  end if;

  -- The amount is the chosen priority's FULL total — "P8 is a month" — not one
  -- stage's window. Any active priority may be chosen; every choice only adds.
  select ack, response, resolution into v_ack, v_resp, v_res from si_sla_targets(p_by_priority);
  v_amount := coalesce(v_ack, 0) + coalesce(v_resp, 0) + coalesce(v_res, 0);
  if v_amount <= 0 then
    raise exception '% has no SLA targets set, so it cannot be used to extend.', p_by_priority
      using errcode = 'check_violation';
  end if;

  -- Rounded UP to the minute so the new deadline is never short of now + amount.
  v_absorbed := greatest(0, ceil(extract(epoch from (now() - v_due)) / 60.0))::int;
  v_add      := v_absorbed + v_amount;
  v_new_due  := v_due + make_interval(mins => v_add);

  select label into v_own_label from priorities where id = w.priority;
  select label into v_by_label  from priorities where id = p_by_priority;
  select name  into v_actor_name from users where id = v_actor;
  v_nth := coalesce(w.sla_top_up_count, 0) + 1;

  v_remark := 'SLA extended (#' || v_nth || ' for this work order): ' || initcap(v_stage) || ' stage ' ||
              case when v_absorbed > 0
                   then 'was ' || si_fmt_minutes_approx(v_absorbed) || ' overdue; extended by '
                   else 'extended by ' end ||
              coalesce(v_by_label, p_by_priority::text) || ' (' || p_by_priority || '), ' ||
              si_fmt_minutes_approx(v_amount) || '. Now due ' ||
              to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI') ||
              '. Priority unchanged at ' || coalesce(v_own_label, w.priority::text) ||
              ' (' || w.priority || ').';

  perform set_config('si.allow_priority_override', 'on', true);

  /* status and the assignee are deliberately NOT named (0051 note 5), the
     priority_override columns are not touched (this overrides no priority),
     and the sticky breach flags are not reset: a stage that was missed was
     missed. */
  update work_orders
     set sla_extension_count       = coalesce(sla_extension_count, 0) + 1,
         sla_top_up_count          = coalesce(sla_top_up_count, 0) + 1,
         sla_overdue_absorbed_mins = coalesce(sla_overdue_absorbed_mins, 0) + v_absorbed,
         sla_ack_extra_mins        = coalesce(sla_ack_extra_mins, 0)        + case when v_stage = 'acknowledge' then v_add else 0 end,
         sla_response_extra_mins   = coalesce(sla_response_extra_mins, 0)   + case when v_stage = 'response'    then v_add else 0 end,
         sla_resolution_extra_mins = coalesce(sla_resolution_extra_mins, 0) + case when v_stage = 'resolution'  then v_add else 0 end,
         sla_ack_due_at            = case when v_stage = 'acknowledge' then v_new_due else sla_ack_due_at end,
         sla_response_due_at       = case when v_stage = 'response'    then v_new_due else sla_response_due_at end,
         sla_resolution_due_at     = case when v_stage = 'resolution'  then v_new_due else sla_resolution_due_at end,
         sla_stage_overdue         = (v_new_due < now()),
         sla_warning_sent          = case when v_new_due > now() then false else sla_warning_sent end
   where id = p_work_order_id;

  perform set_config('si.allow_priority_override', 'off', true);

  insert into work_order_history
    (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks, event_type)
  values
    (p_work_order_id, w.status, w.status, v_actor, v_actor_name, 'admin', v_remark, 'sla_extension');

  -- Same two recipients as 0075, neither of them if they did it themselves.
  perform si_notify(r.id, r.role, p_work_order_id, coalesce(w.wo_number, 'Work order'),
                    'priority_changed',
                    'More time on ' || v_stage,
                    coalesce(w.wo_number, 'A work order') || ' has been given ' ||
                      si_fmt_minutes_approx(v_amount) || ' more on its ' || v_stage ||
                      ' stage. It stays ' || coalesce(v_own_label, w.priority::text) || ' (' || w.priority ||
                      '). Now due ' || to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI') || '.',
                    w.status)
    from (select w.assigned_to_id as id, 'technician'::si_role as role
           where w.assigned_to_id is not null
             and w.assigned_to_id is distinct from v_actor
             and w.assigned_to_id is distinct from w.requester_id
          union all
          select w.requester_id, 'requester'::si_role
           where w.requester_id is distinct from v_actor) r;
end;
$$;

revoke all on function si_extend_sla_stage(uuid, si_priority) from public, anon;
grant execute on function si_extend_sla_stage(uuid, si_priority) to authenticated;
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `node scripts/checks/sla0078ExtendByPriority.mjs`
Expected: every line `PASS`, final line `0078: N assertions passed. Rolling back — nothing is left on test.` If an assertion fails, fix the migration (not the assertion) unless the assertion contradicts the spec.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0078_extend_sla_by_a_priority.sql scripts/checks/sla0078ExtendByPriority.mjs
git commit -m "0078: Extend SLA adds a priority's time, never moves the priority"
```

---

### Task 2: Pure option builder (`slaExtension.js`)

**Model:** sonnet

**Files:**
- Modify (rewrite): `app/src/lib/slaExtension.js`
- Modify (rewrite): `app/scripts/checks/slaExtension.check.mjs`

**Interfaces:**
- Consumes: `openSlaStage(wo)`, `openStageDueAt(wo)` from `./slaStages.js`.
- Produces:
  - `stageGrantedMs(wo, stage) → number` (unchanged)
  - `priorityTotalMinutes(sla) → number | null` — sum of `ack_target_minutes + response_target_minutes + resolution_target_minutes`; null when ≤ 0 or `sla` falsy.
  - `extensionOptions(wo, priorities, slaFor, now = Date.now()) → Array<{ key, id, label, rank, own, grantMs, absorbedMs, dueAt, gainMs }>` — one per active priority with targets, rank ascending; `[]` when no open stage or no deadline.
  - `suggestExtension(wo, priorities, slaFor, now) → { stage, options, suggested, absorbedMs }` — `suggested` is the work order's own priority's option, else the first option, else null.

- [ ] **Step 1: Rewrite the check**

Replace `app/scripts/checks/slaExtension.check.mjs` with:

```js
/**
 * Node assertions for lib/slaExtension.js (migration 0078 semantics).
 * Run: node scripts/checks/slaExtension.check.mjs
 */
import assert from "node:assert/strict";
import { extensionOptions, suggestExtension, priorityTotalMinutes, stageGrantedMs } from "../../src/lib/slaExtension.js";

const T0 = Date.parse("2026-09-19T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;
const DAY = 1440 * MIN;

const PRIORITIES = [
  { id: "P8", label: "Scheduled", rank: 8, is_active: true },
  { id: "P1", label: "Critical", rank: 1, is_active: true },
  { id: "P2", label: "High", rank: 2, is_active: true },
  { id: "P3", label: "Medium", rank: 3, is_active: true },
  { id: "P4", label: "Low", rank: 4, is_active: false },
  { id: "P7", label: "Long-term", rank: 7, is_active: true },
];
const TARGETS = {
  P1: [5, 10, 225], P2: [15, 45, 420], P3: [30, 210, 1200],
  P4: [120, 1320, 5760], P7: [7200, 4320, 10080], P8: [7200, 7200, 28800],
};
const slaFor = (id) =>
  TARGETS[id]
    ? { ack_target_minutes: TARGETS[id][0], response_target_minutes: TARGETS[id][1], resolution_target_minutes: TARGETS[id][2] }
    : null;

assert.equal(priorityTotalMinutes(slaFor("P7")), 21600, "P7 total is 15 days");
assert.equal(priorityTotalMinutes(slaFor("P8")), 43200, "P8 total is 30 days");
assert.equal(priorityTotalMinutes(null), null);
assert.equal(priorityTotalMinutes({ ack_target_minutes: 0 }), null);

// A P7 in testing (resolution stage), due 9 days ago; now = T0.
const overdue = {
  priority: "P7", status: "testing",
  created_at: iso(T0 - 20 * DAY), acknowledged_at: iso(T0 - 18 * DAY), responded_at: iso(T0 - 16 * DAY),
  sla_ack_due_at: iso(T0 - 15 * DAY), sla_response_due_at: iso(T0 - 13 * DAY), sla_resolution_due_at: iso(T0 - 9 * DAY),
  sla_resolution_extra_mins: 0,
};

const opts = extensionOptions(overdue, PRIORITIES, slaFor, T0);
assert.deepEqual(opts.map((o) => o.id), ["P1", "P2", "P3", "P7", "P8"], "active priorities in rank order; retired P4 excluded");
const p7 = opts.find((o) => o.id === "P7");
assert.equal(p7.own, true);
assert.equal(p7.grantMs, 15 * DAY);
assert.equal(p7.absorbedMs, 9 * DAY, "overdue time is absorbed");
assert.equal(p7.dueAt, T0 + 15 * DAY, "overdue: due = now + amount");
assert.equal(p7.gainMs, 24 * DAY);
assert.equal(opts.find((o) => o.id === "P8").dueAt, T0 + 30 * DAY);

const s = suggestExtension(overdue, PRIORITIES, slaFor, T0);
assert.equal(s.stage, "resolution");
assert.equal(s.suggested.id, "P7", "the work order's own priority is pre-selected");
assert.equal(s.absorbedMs, 9 * DAY);

// Absorbed time is rounded UP to the minute, matching the server.
const fractional = extensionOptions(overdue, PRIORITIES, slaFor, T0 + 30_000)[0];
assert.equal(fractional.absorbedMs, 9 * DAY + MIN);

// Not overdue (1 day left): amount added on top, nothing absorbed.
const atRisk = { ...overdue, sla_resolution_due_at: iso(T0 + DAY) };
const r = extensionOptions(atRisk, PRIORITIES, slaFor, T0).find((o) => o.id === "P8");
assert.equal(r.absorbedMs, 0);
assert.equal(r.dueAt, T0 + DAY + 30 * DAY);

// No deadline yet, or no open stage → nothing to offer.
assert.deepEqual(extensionOptions({ ...overdue, sla_resolution_due_at: null }, PRIORITIES, slaFor, T0), []);
assert.deepEqual(extensionOptions({ ...overdue, status: "closed" }, PRIORITIES, slaFor, T0), []);
assert.equal(suggestExtension({ ...overdue, status: "closed" }, PRIORITIES, slaFor, T0).suggested, null);

// Own priority missing from the list → first option suggested.
assert.equal(suggestExtension({ ...overdue, priority: "P4" }, PRIORITIES, slaFor, T0).suggested.id, "P1");

assert.equal(stageGrantedMs({ sla_resolution_extra_mins: 60 }, "resolution"), 60 * MIN);
assert.equal(stageGrantedMs({}, "resolution"), 0);

console.log("slaExtension: all assertions passed");
```

Before running, confirm `openSlaStage` returns null for `status: "closed"`: `sed -n 198,260p src/lib/slaStages.js`. If it keys on something else, change that fixture to whatever makes `openSlaStage` return null.

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/checks/slaExtension.check.mjs`
Expected: FAIL — `priorityTotalMinutes` is not exported.

- [ ] **Step 3: Rewrite `src/lib/slaExtension.js`**

```js
/**
 * SI — Service Inside · What extending a work order's SLA would buy it
 * (migration 0078; earlier modes from 0072/0075 are no longer offered)
 *
 * Extending gives the stage a work order is sitting in a chosen priority's
 * FULL total — "P8 is a month" — and never moves the priority. When the stage
 * is already overdue, the overdue time is absorbed and the amount counts from
 * now, so the Administrator never does overdue arithmetic:
 *
 *   dueAt = max(now, currentDue) + amount
 *
 * **Advisory only.** si_extend_sla_stage re-checks the Administrator, the
 * status and the at-risk gate in its own body and computes the real deadline;
 * the worst a wrong answer here can do is show a date a minute off.
 *
 * Pure — no React, no Supabase — so every boundary is exercised in Node.
 */
import { openSlaStage, openStageDueAt } from "./slaStages.js";

const MIN = 60000;

const at = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** Minutes already granted to each stage by earlier extensions (0075, 0078). */
const STAGE_EXTRA_KEY = {
  acknowledge: "sla_ack_extra_mins",
  response: "sla_response_extra_mins",
  resolution: "sla_resolution_extra_mins",
};

/** How much time earlier extensions have added to `stage`, in milliseconds. */
export function stageGrantedMs(wo, stage) {
  return (Number(wo?.[STAGE_EXTRA_KEY[stage]]) || 0) * MIN;
}

/** A priority's full total in minutes — acknowledge + response + resolution —
 *  which is the amount extending "by" it adds. Null when it has no targets. */
export function priorityTotalMinutes(sla) {
  if (!sla) return null;
  const total =
    (Number(sla.ack_target_minutes) || 0) +
    (Number(sla.response_target_minutes) || 0) +
    (Number(sla.resolution_target_minutes) || 0);
  return total > 0 ? total : null;
}

/**
 * One option per active priority, rank ascending, each naming the deadline the
 * open stage would end up with. Empty when no stage is running or the running
 * stage has no deadline yet — the server refuses both.
 */
export function extensionOptions(wo, priorities, slaFor, now = Date.now()) {
  const stage = openSlaStage(wo);
  if (!stage || !Array.isArray(priorities) || typeof slaFor !== "function") return [];
  const due = at(openStageDueAt(wo));
  if (due == null) return [];

  /* Rounded UP to the minute, as the server does, so the deadline shown is
     never earlier than the one that will be stored. */
  const absorbedMs = Math.max(0, Math.ceil((now - due) / MIN) * MIN);

  return priorities
    .filter((p) => p.is_active !== false && p.rank != null)
    .sort((a, b) => a.rank - b.rank)
    .map((p) => {
      const mins = priorityTotalMinutes(slaFor(p.id));
      if (mins == null) return null;
      const grantMs = mins * MIN;
      return {
        key: p.id,
        id: p.id,
        label: p.label ?? p.id,
        rank: p.rank,
        own: p.id === wo.priority,
        grantMs,
        absorbedMs,
        dueAt: due + absorbedMs + grantMs,
        gainMs: absorbedMs + grantMs,
      };
    })
    .filter(Boolean);
}

/** The options plus the one to pre-select: the work order's own priority. */
export function suggestExtension(wo, priorities, slaFor, now = Date.now()) {
  const stage = openSlaStage(wo);
  const options = extensionOptions(wo, priorities, slaFor, now);
  return {
    stage,
    options,
    suggested: options.find((o) => o.own) || options[0] || null,
    absorbedMs: options[0]?.absorbedMs ?? 0,
  };
}
```

- [ ] **Step 4: Run both pure checks**

Run: `npm run check:units`
Expected: `slaStages` passes unchanged, then `slaExtension: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slaExtension.js scripts/checks/slaExtension.check.mjs
git commit -m "slaExtension: one option per priority, overdue absorbed (0078)"
```

---

### Task 3: Write function and the dialog

**Model:** sonnet

**Files:**
- Modify: `app/src/lib/workOrders.js` (the `extendWorkOrderSla` block, ~lines 742-789)
- Modify (rewrite): `app/src/components/workorders/ExtendSlaDialog.jsx`

**Interfaces:**
- Consumes: `suggestExtension` from Task 2; RPC `si_extend_sla_stage(p_work_order_id, p_by_priority)` from Task 1.
- Produces: `extendSlaStage(woId: string, byPriority: string) → Promise<void>` (throws the Supabase error).

- [ ] **Step 1: Confirm nothing else calls the old function**

Run: `grep -rn "extendWorkOrderSla\|suggestExtension\|extensionOptions\|anyClears" src`
Expected: only `src/lib/workOrders.js`, `src/lib/slaExtension.js` and `ExtendSlaDialog.jsx`. If anything else appears, update it in this task too.

- [ ] **Step 2: Replace `extendWorkOrderSla` in `src/lib/workOrders.js`**

Replace the whole doc comment and function (from `/**\n * Give a work order's open SLA stage more time` through the closing `}` of `extendWorkOrderSla`) with:

```js
/**
 * Give a work order's open SLA stage a chosen priority's full total
 * (migration 0078). The priority never moves — that is Change priority's job.
 *
 * If the stage is overdue the overdue time is absorbed and the amount counts
 * from now; otherwise it is added on top of the time left. The server
 * computes the deadline, writes the timeline remark (no reason is passed) and
 * notifies the technician and the requester.
 *
 * The 0072/0075 RPC si_extend_work_order_sla still exists on the database so
 * tabs opened before this release keep working; nothing here calls it.
 */
export async function extendSlaStage(woId, byPriority) {
  const { error } = await supabase.rpc("si_extend_sla_stage", {
    p_work_order_id: woId,
    p_by_priority: byPriority,
  });
  if (error) throw error;
}
```

- [ ] **Step 3: Rewrite `src/components/workorders/ExtendSlaDialog.jsx`**

```jsx
"use client";

/**
 * SI — Service Inside · Extending a work order's SLA (migration 0078)
 *
 * One list: pick how much time to add, named by priority — "P8 · 30 days" —
 * with the work order's own priority pre-selected. The priority itself never
 * moves; re-grading is Change priority's job, and offering it here too was
 * the confusion this dialog replaced.
 *
 *  - **No reason field.** The server writes the timeline remark itself, naming
 *    the overdue time absorbed, the amount and the new deadline.
 *  - **Overdue is absorbed.** The amount counts from now when the stage is
 *    already late, so every option's deadline is at least that far ahead.
 *  - **Repeat use says which time it is, in red, above the button**, because
 *    extending is uncapped and that sentence is the only friction.
 */
import { useMemo, useState } from "react";
import { X, Clock, AlertTriangle } from "lucide-react";
import { Card, ErrorBanner, ModalOverlay } from "../ui/Surfaces";
import Button from "../ui/Button";
import { useReferenceData } from "../../lib/referenceData";
import { extendSlaStage } from "../../lib/workOrders";
import { describeError } from "../../lib/errors";
import { suggestExtension, stageGrantedMs } from "../../lib/slaExtension";
import { STAGE_LABELS, openStageDueAt, openStageRemainMs, fmtElapsed } from "../../lib/slaStages";
import { fmtDue } from "../../lib/constants";
import { fmtDateTimeMY } from "../../lib/datetime";

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th. */
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
}

export function ExtendSlaDialog({ wo, onClose }) {
  const { priorities, priorityLabel, slaForPriority } = useReferenceData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /* Computed once on open: `now` moving between renders would shift every
     deadline under the reader's finger. */
  const plan = useMemo(
    () => suggestExtension(wo, priorities, slaForPriority, Date.now()),
    [wo, priorities, slaForPriority]
  );

  const [choice, setChoice] = useState(plan.suggested?.key ?? "");
  const selected = plan.options.find((o) => o.key === choice) ?? null;

  const stageLabel = plan.stage ? STAGE_LABELS[plan.stage] : null;
  const currentDue = openStageDueAt(wo);
  const remain = openStageRemainMs(wo);
  const nth = (Number(wo?.sla_top_up_count) || 0) + 1;
  const grantedSoFarMs = stageGrantedMs(wo, plan.stage);

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await extendSlaStage(wo.id, selected.id);
      onClose();
    } catch (err) {
      setError(describeError(err, "Couldn't extend the SLA."));
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose} label="Extend SLA" className="p-4">
      <Card className="rise max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">
            Extend SLA{stageLabel && <> · {stageLabel} stage</>}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        <p className="mb-3.5 text-[12.5px] leading-relaxed text-ink-soft">
          <strong className="font-mono text-ink">{wo.wo_number || "This work order"}</strong> is{" "}
          <strong className="text-ink">
            {priorityLabel(wo.priority)} ({wo.priority})
          </strong>
          {stageLabel && (
            <>
              , and its <strong className="text-ink">{stageLabel.toLowerCase()}</strong> stage{" "}
              {remain != null && remain < 0 ? (
                <>
                  was due <strong className="text-danger">{fmtDateTimeMY(currentDue)}</strong> —{" "}
                  <strong className="text-danger">{fmtElapsed(Math.abs(remain))} overdue</strong>. The
                  time you add counts from now.
                </>
              ) : (
                <>
                  is due <strong className="text-ink">{fmtDateTimeMY(currentDue)}</strong>, in{" "}
                  {fmtDue(remain)}. The time you add goes on top.
                </>
              )}
            </>
          )}
        </p>

        {plan.options.length === 0 ? (
          <p className="mb-4 text-[12.5px] text-ink-soft">
            This work order has no SLA stage running, so there is no deadline to extend.
          </p>
        ) : (
          <form onSubmit={submit}>
            <fieldset className="mb-4">
              <legend className="mb-1.5 text-[12.5px] font-semibold text-ink">How much time to add</legend>
              <div className="flex flex-col gap-1">
                {plan.options.map((o) => (
                  <label
                    key={o.key}
                    className="flex items-start gap-2.5 rounded px-2 py-2 text-[13px] text-ink hover:bg-canvas"
                  >
                    <input
                      type="radio"
                      name="extend-by"
                      value={o.key}
                      checked={choice === o.key}
                      onChange={() => setChoice(o.key)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">
                        {o.id} · {fmtElapsed(o.grantMs)}
                      </span>
                      <span className="ml-1.5 text-ink-soft">{o.label}</span>
                      {o.own && (
                        <span className="ml-1.5 rounded bg-navy/[0.08] px-1.5 py-0.5 text-[10.5px] font-semibold text-navy">
                          This work order&apos;s priority
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        New deadline {fmtDateTimeMY(new Date(o.dueAt).toISOString())}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {selected && (
              <p className="mb-3 text-[12px] text-ink">
                Priority stays{" "}
                <strong>
                  {priorityLabel(wo.priority)} ({wo.priority})
                </strong>
                . Only the {stageLabel ? stageLabel.toLowerCase() : "current"} stage moves.
              </p>
            )}

            {nth > 1 && (
              <div className="mb-4 rounded border border-danger/40 bg-danger/[0.06] px-2.5 py-2 text-[12px] leading-relaxed text-danger">
                <AlertTriangle size={13} className="mr-1 inline align-[-2px]" />
                <strong className="font-semibold">
                  This would be the {ordinal(nth)} time this work order&apos;s SLA has been extended.
                </strong>{" "}
                {grantedSoFarMs > 0 && (
                  <>
                    Its {stageLabel ? stageLabel.toLowerCase() : "current"} stage has already been given{" "}
                    {fmtElapsed(grantedSoFarMs)} beyond its original target.{" "}
                  </>
                )}
                If the work keeps outrunning its deadline, the priority or the plan is likely the thing
                to change.
              </div>
            )}

            <div className="mb-4 rounded border border-border bg-canvas px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft">
              <Clock size={12} className="mr-1 inline align-[-1px]" />
              This is recorded on the work order&apos;s timeline with your name and the time, and the
              assigned technician and the person who raised it are both notified. Stages already
              missed stay on its record.
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={!selected}>
                {selected ? `Extend by ${fmtElapsed(selected.grantMs)}` : "Extend"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </ModalOverlay>
  );
}

export default ExtendSlaDialog;
```

Check `fmtElapsed(15 * 86400000)` reads well ("15d" or similar): `node -e "import('./src/lib/slaStages.js').then(m=>console.log(m.fmtElapsed(15*864e5), m.fmtElapsed(864e5*30), m.fmtElapsed(4*36e5)))"`. Use it as-is; do not add a formatter.

- [ ] **Step 4: Compile check**

Confirm no dev server is running (`npm run dev` must not be live), then run: `npm run build`
Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workOrders.js src/components/workorders/ExtendSlaDialog.jsx
git commit -m "Extend SLA dialog: one list of priorities, priority never moves"
```

---

### Task 4: Export column, types, CLAUDE.md

**Model:** haiku

**Files:**
- Modify: `app/src/lib/exportWorkOrders.js` (after the `SLA Time Added (hrs)` column, ~line 322)
- Modify: `app/src/lib/database.types.ts` (`work_orders` Row/Insert/Update; Functions)
- Modify: `CLAUDE.md` (repo root)

- [ ] **Step 1: Export column.** Directly after the closing `},` of the `"SLA Time Added (hrs)"` column object, insert:

```js
    /* Migration 0078. Included in "SLA Time Added (hrs)" above, reported on its
       own so a report can tell an extension that was mostly lateness from one
       that was planned time. */
    {
      header: "SLA Overdue Absorbed (hrs)",
      width: 24,
      cell: (w) => numCell(Math.round(((w.sla_overdue_absorbed_mins ?? 0) / 60) * 100) / 100),
    },
```

- [ ] **Step 2: Types.** In `src/lib/database.types.ts`, inside `work_orders`, add next to `sla_resolution_extra_mins` in each block:
  - Row: `sla_overdue_absorbed_mins: number`
  - Insert: `sla_overdue_absorbed_mins?: number`
  - Update: `sla_overdue_absorbed_mins?: number`

  In `Functions`, alphabetically next to `si_extend_work_order_sla`, add:

```ts
      si_extend_sla_stage: {
        Args: {
          p_by_priority: Database["public"]["Enums"]["si_priority"]
          p_work_order_id: string
        }
        Returns: undefined
      }
```
  and next to `si_fmt_minutes`: `si_fmt_minutes_approx: { Args: { p_mins: number }; Returns: string }`

- [ ] **Step 3: CLAUDE.md.** Insert this section immediately before the heading `### Extending no longer has to move the priority (migration 0075)`:

```markdown
### Extend SLA adds a priority's time, and never moves the priority (migration 0078)

**Two buttons, one job each.** Change priority (0051) is "this job was graded wrong";
Extend SLA is "the grading is right, this stage needs more time". The dialog is one
list — one row per active priority labelled with its **full total** (P7 · 15 days,
P8 · 30 days), the work order's own pre-selected — and `si_extend_sla_stage` adds that
amount to the open stage. 0072's re-grade mode and 0075's own-window top-up are no
longer offered: re-grading is Change priority's job, and choosing your own priority
from the list is what the top-up was.

**Overdue time is absorbed.** `due' = max(now, due) + amount`, stored the 0075 way — the
whole addition goes into the stage's `sla_*_extra_mins`, so a later Change priority
preserves it — and the overdue part is also summed into `sla_overdue_absorbed_mins`,
which the export reports as **SLA Overdue Absorbed (hrs)** (already inside "SLA Time
Added"). That reverses 0075 note 3's "never from now" on purpose: the Administrator
should get the amount they chose, not have to subtract the lateness first. What keeps the
record honest is unchanged — the sticky breach flags are never reset, the timeline remark
names the overdue time absorbed, and `sla_top_up_count` drives the "Nth time" warning.

**`si_extend_work_order_sla` (0075) is deliberately still on the database.** PostgREST
resolves an RPC by argument-name set, so altering it would have broken every tab open
during the release (the 2026-09-19 `PGRST202`). Nothing in the client calls it any more;
dropping it is a later migration, once no old tab can be open.

`scripts/checks/sla0078ExtendByPriority.mjs` applies the migration twice on test inside
one transaction, asserts and rolls back.
```

- [ ] **Step 4: Compile check**

Confirm no dev server is running, then: `npm run build`
Expected: completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exportWorkOrders.js src/lib/database.types.ts ../CLAUDE.md
git commit -m "Export SLA overdue absorbed; types and CLAUDE.md for 0078"
```

---

### Task 5: Apply to test and verify in the browser (controller, not a subagent)

- [ ] **Step 1:** `npm run env:which` → must report test. Then `npm run db:push`. Expected: applies `0078_extend_sla_by_a_priority.sql` only.
- [ ] **Step 2:** Re-run `node scripts/checks/sla0078ExtendByPriority.mjs` (still passes after the real apply — it re-runs the file, proving re-runnability on a project that already has it).
- [ ] **Step 3:** Start the dev server via `preview_start`, have the user sign in as an Administrator on test, open an overdue or at-risk work order, open Extend SLA: confirm the list, the pre-selected own priority, the deadlines, and that extending updates the countdown and adds the timeline entry with the priority unchanged. Screenshot as proof.

### Task 6: Production release (user + controller) — schema first

- [ ] **Step 1:** The user pastes the whole of `app/supabase/migrations/0078_extend_sla_by_a_priority.sql` into `https://supabase.com/dashboard/project/iclphobvhjwdinxnqexw/sql/new` and runs it. The live site is unaffected (additive only).
- [ ] **Step 2:** Controller probes production with the anon key from `app/.env.prod.local`: `rpc('si_extend_sla_stage', {p_work_order_id: <zero uuid>, p_by_priority: 'P7'})` must return `42501`, with a fake function name returning `PGRST202` as control.
- [ ] **Step 3:** Only then merge to `main` and push → Vercel production deploy. Verify by grepping the live JS chunks (several routes, regex allowing slashes) for `How much time to add`.
- [ ] **Step 4:** Update the `production-is-behind-test` memory with 0078's state.
