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
    `select * from work_order_history where work_order_id = $1 and event_type = 'sla_extension' order by created_at desc limit 1`, [wo0.id]);
  assert.equal(h1.event_type, "sla_extension");
  assert.equal(h1.from_status, h1.to_status);
  assert.match(h1.remarks, /Resolution stage was 9 days( \d+ hrs?)? overdue; extended by .*\(P7\), 15 days\. Now due /);
  assert.match(h1.remarks, /Priority unchanged at .*\(P7\)\./);
  pass("timeline remark names the overdue absorbed, the amount and the new deadline");

  const { rows: notes } = await c.query(
    `select recipient_id from notifications where entity_id = $1 and type = 'priority_changed'`, [wo0.id]);
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
