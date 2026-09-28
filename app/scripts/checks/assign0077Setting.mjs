/**
 * Migration 0077 exercised against the live TEST project, inside one
 * transaction that is always rolled back.
 *
 * Run: node scripts/checks/assign0077Setting.mjs
 *
 * Proves that before 0077 an HOD cannot assign and a Supervisor can, then
 * applies 0077's own SQL and proves the shipped defaults (HOD + Admin), that a
 * Superuser can widen and narrow the grant and the matrix follows, that nobody
 * can switch Administrator off, that an ordinary Administrator cannot change the
 * grants at all, that a granted HOD can read the roster, and that the
 * "needs assigning" fan-out follows the grant.
 *
 * Role claims are set per statement, so an HOD is simulated by giving a real
 * account's uid the `hod` claim — the guard, RLS and the helper all read the
 * token, not users.roles.
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
  new URL("../../supabase/migrations/0077_who_may_assign_is_a_setting.sql", import.meta.url),
  "utf8"
);

async function as(uid, roles, extra = {}) {
  await c.query("set local role authenticated");
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: uid, role: "authenticated", user_roles: roles, user_role: roles.at(-1), ...extra }),
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

const assign = (woId, tech) =>
  c.query(`select si_transition_work_order($1, 'assigned', $2::jsonb, 'check 0077')`, [
    woId,
    JSON.stringify({ assigned_to_id: tech.id, assigned_to_name: tech.name }),
  ]);

const assignmentRoles = async () =>
  (await c.query(
    `select distinct roles::text[] as roles from wo_status_transitions where 'assigned_to_id' = any(requires)`
  )).rows.map((r) => r.roles.join(","));

const ok = [];
try {
  await c.query("begin");

  const superuser = (await c.query(
    `select id from users where 'admin' = any(roles) and is_protected and status = 'active' limit 1`
  )).rows[0];
  const admin = (await c.query(
    `select id from users where 'admin' = any(roles) and status = 'active' order by is_protected limit 1`
  )).rows[0];
  const wo = (await c.query(
    `select id, wo_number, department_id from work_orders where status = 'open' and assigned_to_id is null limit 1`
  )).rows[0];
  const tech = (await c.query(
    `select id, name from users where 'technician' = any(roles) and status = 'active' limit 1`
  )).rows[0];
  // An ordinary Administrator is the admin account WITHOUT the is_protected
  // claim: si_is_superuser() reads only the token. Test has one admin, protected.
  // Somebody who is not the technician, to wear the HOD / Supervisor / Manager claim.
  const actor = (await c.query(
    `select id from users where id <> $1 and status = 'active' and not ('technician' = any(roles)) limit 1`,
    [tech.id]
  )).rows[0];
  assert.ok(superuser && admin && wo && tech && actor, "fixtures missing on test");
  console.log(`fixtures: ${wo.wo_number}, tech ${tech.name}`);

  // 1. Baseline.
  let err = await attempt(async () => { await as(actor.id, ["hod"]); await assign(wo.id, tech); });
  assert.match(err ?? "", /may not perform/, `HOD should be refused before 0077, got: ${err}`);
  err = await attempt(async () => { await as(actor.id, ["supervisor"]); await assign(wo.id, tech); });
  assert.equal(err, null, `Supervisor should assign before 0077, got: ${err}`);
  ok.push("before 0077: HOD refused, Supervisor allowed");

  await c.query(migration);

  // 2. Defaults and the matrix.
  const perms = Object.fromEntries(
    (await c.query(`select role::text, can_assign_technicians from role_permissions`)).rows.map((r) => [
      r.role, r.can_assign_technicians,
    ])
  );
  assert.deepEqual(perms, {
    requester: false, technician: false, supervisor: false, hod: true, manager: false, admin: true,
  });
  ok.push("defaults: HOD and Admin allowed, every other role not (HOD row now exists)");
  const n = (await c.query(`select count(*)::int n from wo_status_transitions where 'assigned_to_id' = any(requires)`)).rows[0].n;
  assert.deepEqual(await assignmentRoles(), ["hod,admin"]);
  ok.push(`matrix: all ${n} assignment rows now name {hod,admin}`);

  // 3. Who can assign now.
  err = await attempt(async () => {
    await as(actor.id, ["hod"]);
    await assign(wo.id, tech);
    const h = (await c.query(
      `select actor_role::text from work_order_history where work_order_id = $1 order by created_at desc limit 1`, [wo.id]
    )).rows[0];
    assert.equal(h.actor_role, "hod");
  });
  assert.equal(err, null, `HOD assign failed: ${err}`);
  ok.push("HOD can assign, and the history row records actor_role hod");

  for (const role of ["supervisor", "manager"]) {
    err = await attempt(async () => { await as(actor.id, [role]); await assign(wo.id, tech); });
    assert.match(err ?? "", /may not perform/, `${role} should be refused, got: ${err}`);
  }
  ok.push("Supervisor and Manager are refused by the database");

  err = await attempt(async () => { await as(admin.id, ["admin"]); await assign(wo.id, tech); });
  assert.equal(err, null, `Admin assign failed: ${err}`);
  ok.push("Administrator can still assign");

  // 4. The roster is readable by a granted HOD.
  err = await attempt(async () => {
    await as(actor.id, ["hod"]);
    const r = (await c.query(
      `select count(*)::int n from technicians t join users u on u.id = t.user_id
        where 'technician' = any(u.roles) and u.status = 'active'`
    )).rows[0];
    assert.ok(r.n > 0, "HOD sees an empty roster");
  });
  assert.equal(err, null, err);
  ok.push("HOD can read the technician roster");

  // 5. The grants: who may change them.
  err = await attempt(async () => {
    await as(admin.id, ["admin"]);
    const r = await c.query(`update role_permissions set can_assign_technicians = true where role = 'manager'`);
    assert.equal(r.rowCount, 0, "an ordinary Administrator changed a grant");
  });
  assert.equal(err, null, err);
  ok.push("an ordinary Administrator cannot change the grant (0 rows)");

  err = await attempt(async () => {
    await as(superuser.id, ["admin"], { is_protected: true });
    await c.query(`update role_permissions set can_assign_technicians = false where role = 'admin'`);
  });
  assert.match(err ?? "", /Administrators can always assign technicians/);
  ok.push("nobody can switch Administrator off, Superuser included");

  err = await attempt(async () => {
    await as(superuser.id, ["admin"], { is_protected: true });
    const r = await c.query(`update role_permissions set can_assign_technicians = true where role = 'supervisor'`);
    assert.equal(r.rowCount, 1);
    await asPostgres();
    assert.deepEqual(await assignmentRoles(), ["supervisor,hod,admin"]);
    await as(actor.id, ["supervisor"]);
    await assign(wo.id, tech);
  });
  assert.equal(err, null, `Superuser widening failed: ${err}`);
  ok.push("Superuser grants Supervisor -> matrix follows -> Supervisor can assign");

  err = await attempt(async () => {
    await as(superuser.id, ["admin"], { is_protected: true });
    await c.query(`update role_permissions set can_assign_technicians = false where role = 'hod'`);
    await asPostgres();
    assert.deepEqual(await assignmentRoles(), ["admin"]);
    await as(actor.id, ["hod"]);
    await assign(wo.id, tech);
  });
  assert.match(err ?? "", /may not perform/, `HOD should be refused once switched off, got: ${err}`);
  ok.push("Superuser switches HOD off -> matrix is {admin} -> HOD refused");

  // 6. The fan-out follows the grant.
  err = await attempt(async () => {
    const before = (await c.query(`select coalesce(max(created_at), '-infinity') t from notifications`)).rows[0].t;
    await c.query(
      `select si_notify_assigners($1, $2, $3, 'needs_assignment', 'check 0077', 'check 0077')`,
      [wo.department_id, wo.id, wo.wo_number]
    );
    const roles = (await c.query(
      `select distinct recipient_role::text r from notifications
        where entity_id = $1 and title = 'check 0077'`, [wo.id]
    )).rows.map((r) => r.r).sort();
    assert.ok(roles.length > 0, "fan-out wrote nothing");
    for (const r of roles) assert.ok(["hod", "admin"].includes(r), `fan-out reached ${r}`);
    console.log(`  fan-out recipient roles: ${roles.join(", ")} (before ${before})`);
  });
  assert.equal(err, null, err);
  ok.push("needs-assignment fan-out reaches only HOD and Admin holders");

  // 7. Self-assignment wording.
  err = await attempt(async () => { await as(tech.id, ["hod", "technician"]); await assign(wo.id, tech); });
  assert.match(err ?? "", /Ask someone else who can assign technicians/);
  ok.push("self-assignment refusal no longer names Supervisor/Manager");
} finally {
  await c.query("rollback");
  await c.end();
}
ok.forEach((m) => console.log("PASS", m));
console.log(`${ok.length} passed, rolled back`);
