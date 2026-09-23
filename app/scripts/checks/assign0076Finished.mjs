/**
 * Migration 0076 exercised against the live TEST project, inside one
 * transaction that is always rolled back.
 *
 * Run: node scripts/checks/assign0076Finished.mjs
 *
 * Reads .env.test.local directly rather than .env.local, and refuses to run
 * unless it names the test project — production has no DB password on this
 * machine anyway, but the check should not depend on that.
 *
 * It first proves the hole exists WITHOUT 0076 (an Administrator reassigning a
 * closed work order succeeds), then applies 0076's own SQL and proves it is
 * closed, and that the moves which must keep working still do.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";

const TEST_REF = "vfkozckhthrrmxaewnlt";
const env = Object.fromEntries(
  readFileSync(new URL("../../.env.test.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
if (env.SI_PROJECT_REF !== TEST_REF) throw new Error("Not the test project — refusing.");

const url = `postgresql://postgres.${TEST_REF}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const migration = readFileSync(
  new URL("../../supabase/migrations/0076_a_finished_work_order_keeps_its_technician.sql", import.meta.url),
  "utf8"
);

async function as(uid, roles) {
  await c.query("set local role authenticated");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: "authenticated", user_roles: roles, user_role: roles.at(-1) }),
  ]);
}
const asPostgres = () => c.query("reset role");

/** Runs fn inside a savepoint; returns the error message, or null on success. Always rolls the savepoint back. */
async function attempt(fn) {
  await c.query("savepoint s");
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message;
  } finally {
    await c.query("rollback to savepoint s");
    await asPostgres();
  }
}

const reassign = (woId, status, tech) =>
  c.query(`select si_transition_work_order($1, $2::si_wo_status, $3::jsonb, 'check')`, [
    woId,
    status,
    JSON.stringify({ assigned_to_id: tech.id, assigned_to_name: tech.name }),
  ]);

const ok = [];
try {
  await c.query("begin");

  const admin = (await c.query(
    `select id, name from users where 'admin' = any(roles) and status = 'active' order by is_protected limit 1`
  )).rows[0];
  const wo = (await c.query(
    `select id, wo_number, assigned_to_id from work_orders where status = 'closed' and assigned_to_id is not null limit 1`
  )).rows[0];
  const other = (await c.query(
    `select id, name from users where 'technician' = any(roles) and status = 'active'
       and id <> $1 and id <> $2 limit 1`,
    [wo.assigned_to_id, admin.id]
  )).rows[0];
  assert.ok(admin && wo && other, "fixtures missing on test");
  console.log(`fixtures: ${wo.wo_number}, admin ${admin.name}, other tech ${other.name}`);

  // 1. Baseline: without 0076 the Administrator bypass lets it through.
  let err = await attempt(async () => {
    await as(admin.id, ["admin"]);
    await reassign(wo.id, "closed", other);
  });
  assert.equal(err, null, `expected the hole to exist before 0076, got: ${err}`);
  ok.push("before 0076: an Administrator CAN reassign a closed work order (the hole)");

  await c.query(migration);

  // 2. The same call is refused now.
  err = await attempt(async () => {
    await as(admin.id, ["admin"]);
    await reassign(wo.id, "closed", other);
  });
  assert.match(err ?? "", /finished, so its technician can no longer be changed/);
  ok.push("after 0076: Administrator reassign via the RPC is refused");

  // 3. A direct PATCH-shaped UPDATE from the Administrator's token is refused.
  err = await attempt(async () => {
    await as(admin.id, ["admin"]);
    await c.query(`update work_orders set assigned_to_id = $2 where id = $1`, [wo.id, other.id]);
  });
  assert.match(err ?? "", /finished/);
  ok.push("after 0076: direct UPDATE of assigned_to_id by an Administrator is refused");

  // 4. Clearing the assignee is refused too.
  err = await attempt(async () => {
    await as(admin.id, ["admin"]);
    await c.query(`update work_orders set assigned_to_id = null where id = $1`, [wo.id]);
  });
  assert.match(err ?? "", /finished/);
  ok.push("after 0076: clearing the assignee on a closed work order is refused");

  // 5. No null-uid exemption: a script / SQL-as-postgres write is refused too.
  err = await attempt(async () => {
    await c.query(`update work_orders set assigned_to_id = $2 where id = $1`, [wo.id, other.id]);
  });
  assert.match(err ?? "", /finished/);
  ok.push("after 0076: a write with no signed-in user is refused too");

  // 6. Rework keeps working, and reassigning once back at repairing is allowed.
  err = await attempt(async () => {
    await as(admin.id, ["admin"]);
    await c.query(
      `select si_transition_work_order($1, 'repairing', '{"reopen_reason":"check 0076"}'::jsonb, 'check')`,
      [wo.id]
    );
    await reassign(wo.id, "repairing", other);
    const r = (await c.query(`select status, assigned_to_id from work_orders where id = $1`, [wo.id])).rows[0];
    assert.equal(r.status, "repairing");
    assert.equal(r.assigned_to_id, other.id);
  });
  assert.equal(err, null, `rework then reassign failed: ${err}`);
  ok.push("after 0076: rework (closed -> repairing) then reassign at repairing still works");

  // 7. Finishing still auto-closes (the auto-close UPDATE moves no assignee).
  err = await attempt(async () => {
    await as(admin.id, ["admin"]);
    await c.query(
      `select si_transition_work_order($1, 'repairing', '{"reopen_reason":"check 0076"}'::jsonb, 'check')`,
      [wo.id]
    );
    await c.query(`select si_transition_work_order($1, 'testing', '{}'::jsonb, 'check')`, [wo.id]);
    await c.query(
      `select si_transition_work_order($1, 'completed', '{"resolution_notes":"check 0076"}'::jsonb, 'check')`,
      [wo.id]
    );
    const r = (await c.query(`select status, assigned_to_id from work_orders where id = $1`, [wo.id])).rows[0];
    assert.equal(r.status, "closed");
    assert.equal(r.assigned_to_id, wo.assigned_to_id);
  });
  assert.equal(err, null, `complete -> auto-close failed: ${err}`);
  ok.push("after 0076: marking completed still auto-closes, assignee unchanged");

  // 8. A live work order can still be reassigned.
  const live = (await c.query(
    `select id, status, assigned_to_id from work_orders
      where status in ('assigned','accepted','repairing') and assigned_to_id is not null
        and assigned_to_id <> $1 limit 1`,
    [other.id]
  )).rows[0];
  if (live) {
    err = await attempt(async () => {
      await as(admin.id, ["admin"]);
      await reassign(live.id, live.status, other);
    });
    assert.equal(err, null, `live reassign failed: ${err}`);
    ok.push(`after 0076: a live work order at ${live.status} can still be reassigned`);
  }
} finally {
  await c.query("rollback");
  await c.end();
}
ok.forEach((m) => console.log("PASS", m));
console.log(`${ok.length} passed, rolled back`);
