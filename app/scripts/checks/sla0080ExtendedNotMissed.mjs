/**
 * Migration 0080 exercised against the live TEST project, inside one
 * transaction that is always rolled back.
 *
 * Run: node scripts/checks/sla0080ExtendedNotMissed.mjs
 *
 * Applies 0080's own SQL first, so it checks the file rather than a database
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

const MIG = new URL("../../supabase/migrations/0080_an_extended_stage_is_judged_by_its_new_deadline.sql", import.meta.url);

await c.query("begin");
try {
  const { rows: [dept] } = await c.query(`select id from departments limit 1`);
  const { rows: [plant] } = await c.query(`select id from plants where status = 'active' limit 1`);
  const { rows: [asset] } = await c.query(`select id from assets where plant_id = $1 limit 1`, [plant.id]);

  async function fixture(num, set) {
    await asPostgres();
    const { rows: [ins] } = await c.query(
      `insert into work_orders (wo_number, description, status, priority, impact, department_id, plant_id, asset_id,
                                requester_id, requester_name, assigned_to_id)
       values ($1, '0080 fixture', 'testing', 'P7', 'long_term', $2, $3, $4, $5, 'Fixture Requester', $6)
       returning id`,
      [num, dept.id, plant.id, asset.id, requester.id, technician.id]
    );
    const { rows: [wo] } = await c.query(
      `update work_orders
          set created_at = now() - interval '20 days', acknowledged_at = now() - interval '18 days',
              responded_at = now() - interval '16 days', sla_ack_due_at = now() - interval '15 days',
              sla_response_due_at = now() - interval '13 days' ${set}
        where id = $1 returning *`,
      [ins.id]
    );
    return wo;
  }
  const get = async (id) => (await c.query(`select * from work_orders where id = $1`, [id])).rows[0];

  // A: overdue resolution, breached, never extended (the main flow).
  const A = await fixture("WO-CHK0080A", `, sla_resolution_due_at = now() - interval '9 days',
              sla_resolution_breached = true, sla_stage_overdue = true, sla_breached = true`);
  // B: looks like a pre-0080 extension - flag still true, extra > 0, due in the future.
  const B = await fixture("WO-CHK0080B", `, sla_resolution_due_at = now() + interval '10 days',
              sla_resolution_extra_mins = 21600, sla_extension_count = 1, sla_top_up_count = 1,
              sla_resolution_breached = true, sla_stage_overdue = false, sla_breached = true`);
  // C: breached, never extended, still overdue - must stay breached.
  const C = await fixture("WO-CHK0080C", `, sla_resolution_due_at = now() - interval '2 days',
              sla_resolution_breached = true, sla_stage_overdue = true, sla_breached = true`);

  const histCount = async (id) =>
    (await c.query(`select count(*)::int n from work_order_history where work_order_id = $1`, [id])).rows[0].n;
  const hBefore = await histCount(B.id);
  const { rows: [{ n: notesBefore }] } = await c.query(`select count(*)::int n from notifications where entity_id = $1`, [B.id]);
  await c.query(readFileSync(MIG, "utf8"));
  pass("0080 applies cleanly");
  await c.query(readFileSync(MIG, "utf8"));
  pass("0080 applies a second time (SQL Editor re-run is safe)");

  const B1 = await get(B.id), C1 = await get(C.id);
  assert.equal(B1.sla_resolution_breached, false, "backfill clears an extended stage still within its deadline");
  assert.equal(B1.sla_breached, false, "sla_breached recomputed as the OR");
  assert.equal(B1.sla_resolution_extra_mins, 21600, "extra minutes untouched");
  assert.equal(B1.sla_extension_count, 1, "counts untouched");
  assert.equal(B1.status, "testing");
  assert.equal(await histCount(B.id), hBefore, "the backfill writes no history row");
  const { rows: [{ n: notesAfter }] } = await c.query(`select count(*)::int n from notifications where entity_id = $1`, [B.id]);
  assert.equal(notesAfter, notesBefore, "and no notification");
  assert.equal(C1.sla_resolution_breached, true, "an unextended breach stays breached");
  assert.equal(C1.sla_breached, true);
  pass("backfill clears the extended one and leaves the unextended one alone");

  // --- Extend A by P7 while 9 days overdue.
  await setClaims(admin.id, admin.roles);
  const { rows: [{ now: nowTs }] } = await c.query(`select now()`);
  const now = new Date(nowTs).getTime();
  await c.query(`select si_extend_sla_stage($1, 'P7')`, [A.id]);
  await asPostgres();
  const t1 = await get(A.id);
  assert.equal(t1.sla_resolution_breached, false, "the extended stage is judged afresh");
  assert.equal(t1.sla_breached, false, "sla_breached = OR of the other two (false here)");
  assert.equal(t1.sla_ack_breached, A.sla_ack_breached, "ack flag unchanged");
  assert.equal(t1.sla_response_breached, A.sla_response_breached, "response flag unchanged");
  near(t1.sla_resolution_due_at, now + 15 * 1440 * MIN, "due = now + 15 days");
  assert.equal(t1.sla_stage_overdue, false);
  assert.equal(t1.priority, "P7");
  assert.equal(t1.status, "testing");
  pass("extending clears only the open stage's flag and moves the deadline");

  const { rows: [h1] } = await c.query(
    `select remarks from work_order_history where work_order_id = $1 and event_type = 'sla_extension' order by created_at desc limit 1`, [A.id]);
  assert.match(h1.remarks, /^Extended 15 days by .+ \(Long-term, P7\)\. Resolution stage was .+ overdue\. Now due .+\. Priority unchanged at .+ \(P7\)\.$/);
  assert.ok(!/#\d/.test(h1.remarks), "no (#n) count");
  pass("remark leads with how much and who");

  // --- The new deadline passes: the sweep breaches it as usual.
  await c.query(`update work_orders set sla_resolution_due_at = now() - interval '1 minute' where id = $1`, [A.id]);
  const { rows: [{ n: before }] } = await c.query(
    `select count(*)::int n from notifications where entity_id = $1 and type = 'sla_breach'`, [A.id]);
  await c.query(`select si_sla_breach_sweep()`);
  const t2 = await get(A.id);
  assert.equal(t2.sla_resolution_breached, true, "sweep re-breaches the stage");
  assert.equal(t2.sla_breached, true);
  assert.equal(t2.sla_stage_overdue, true);
  const { rows: [{ n: after }] } = await c.query(
    `select count(*)::int n from notifications where entity_id = $1 and type = 'sla_breach'`, [A.id]);
  assert.ok(after > before, `breach notification written (${before} -> ${after})`);
  await c.query(`select si_sla_breach_sweep()`);
  const { rows: [{ n: after2 }] } = await c.query(
    `select count(*)::int n from notifications where entity_id = $1 and type = 'sla_breach'`, [A.id]);
  assert.equal(after2, after, "and only once");
  pass(`new deadline passing breaches as usual: flag, overdue, ${after - before} notification row(s), once`);

  // --- Extend again (repeatable).
  await setClaims(admin.id, admin.roles);
  await c.query(`select si_extend_sla_stage($1, 'P7')`, [A.id]);
  await asPostgres();
  const t3 = await get(A.id);
  assert.equal(t3.sla_resolution_breached, false);
  assert.equal(t3.sla_extension_count, 2);
  assert.equal(t3.sla_stage_overdue, false);
  pass("extending again works and clears the flag again");

  console.log("\n" + ok.map((m) => "  PASS  " + m).join("\n"));
  console.log(`\n0080: ${ok.length} assertions passed. Rolling back - nothing is left on test.`);
} finally {
  await c.query("rollback");
  await c.end();
}
