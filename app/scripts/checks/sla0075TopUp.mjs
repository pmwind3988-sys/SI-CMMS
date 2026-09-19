/**
 * Migration 0075 exercised against the live TEST project, inside one
 * transaction that is always rolled back.
 *
 * Run: node scripts/checks/sla0075TopUp.mjs
 *
 * It applies 0075's own SQL first, so it is a check on the migration file
 * rather than on a database somebody has already changed by hand — and because
 * a plpgsql body is not parsed until it is called, every assertion below is
 * also the only evidence that the function compiles at all. A successful
 * `db push` is not that evidence; this file's header in the repo says so and
 * 0036 learnt it the hard way.
 *
 * Nothing is left behind: the whole run is BEGIN ... ROLLBACK, the fixture work
 * order included.
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

let url = env.SUPABASE_DB_URL;
if (!url) {
  const poolerBase = readFileSync(
    new URL("../../supabase/.temp/pooler-url", import.meta.url),
    "utf8"
  ).trim();
  url = poolerBase.replace(
    /^postgresql:\/\/([^@]+)@/,
    (_, user) => `postgresql://${user}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@`
  );
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

async function setClaims(client, uid, roles, isProtected = false) {
  await client.query(`set local role authenticated`);
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({
      sub: uid,
      role: "authenticated",
      user_roles: roles,
      user_role: roles[roles.length - 1],
      is_protected: isProtected,
    }),
  ]);
}
const asPostgres = () => c.query("reset role");

const ok = [];
const pass = (m) => ok.push(m);

async function refuses(label, fn, fragment) {
  try {
    await fn();
    throw new Error(`EXPECTED REFUSAL: ${label}`);
  } catch (e) {
    if (e.message.startsWith("EXPECTED REFUSAL")) throw e;
    assert.ok(
      e.message.includes(fragment),
      `${label}: expected a message containing ${JSON.stringify(fragment)}, got ${JSON.stringify(e.message)}`
    );
    /* A refusal aborts the transaction, so every one of these runs inside its
       own savepoint. Without it the first refusal poisons everything after it
       and the remaining assertions "pass" by never running. */
    pass(label);
  }
}

const { rows: users } = await c.query(
  `select id, name, roles::text[] as roles from users where status = 'active'`
);
const admin = users.find((u) => u.roles.includes("admin"));
const technician = users.find((u) => u.roles.includes("technician") && !u.roles.includes("admin"));
const requester = users.find((u) => u.roles.includes("requester") && !u.roles.includes("admin"));
assert.ok(admin && technician && requester, "test project must have an admin, a technician and a requester");

await c.query("begin");
try {
  // -------------------------------------------------------------------------
  // 0. Apply the migration under test.
  // -------------------------------------------------------------------------
  const sql = readFileSync(
    new URL("../../supabase/migrations/0075_topping_up_a_stage_in_place.sql", import.meta.url),
    "utf8"
  );
  await c.query(sql);
  pass("0075 applies cleanly");

  // si_fmt_minutes is called from inside the RPC, so a bad body there is a
  // runtime error in a function that created fine. Exercise every branch.
  const { rows: [fmt] } = await c.query(
    `select si_fmt_minutes(10080) d, si_fmt_minutes(1440) d1, si_fmt_minutes(240) h,
            si_fmt_minutes(60) h1, si_fmt_minutes(45) m, si_fmt_minutes(1) m1,
            si_fmt_minutes(0) z, si_fmt_minutes(null) n`
  );
  assert.deepEqual(
    [fmt.d, fmt.d1, fmt.h, fmt.h1, fmt.m, fmt.m1, fmt.z, fmt.n],
    ["7 days", "1 day", "4 hrs", "1 hr", "45 mins", "1 min", "0 mins", null]
  );
  pass("si_fmt_minutes reads like a sentence in every branch");

  // -------------------------------------------------------------------------
  // 1. A P7 sitting in an overdue RESOLUTION stage — the case that motivated
  //    this migration. P7 resolution is 10080 minutes (7 days), sequential.
  // -------------------------------------------------------------------------
  const { rows: [dept] } = await c.query(`select id from departments limit 1`);
  const { rows: [plant] } = await c.query(`select id from plants where status = 'active' limit 1`);
  const { rows: [asset] } = await c.query(`select id from assets where plant_id = $1 limit 1`, [plant.id]);

  await asPostgres();
  const { rows: [inserted] } = await c.query(
    `insert into work_orders
       (wo_number, description, status, priority, impact, department_id, plant_id, asset_id,
        requester_id, requester_name, assigned_to_id)
     values
       ('WO-CHK0075', '0075 top-up fixture', 'repairing', 'P7', 'long_term',
        $1, $2, $3, $4, 'Fixture Requester', $5)
     returning id`,
    [dept.id, plant.id, asset.id, requester.id, technician.id]
  );
  /* The stage moments and deadlines are set in a SEPARATE update, because
     before_work_order_insert (0003) computes the deadlines from the priority
     and overwrites whatever the insert supplied. An update that moves no
     status hits si_stamp_work_order's opening early return, so these values
     survive it — the same property 0051 and 0064 rely on. */
  const { rows: [wo0] } = await c.query(
    `update work_orders
        set created_at = now() - interval '20 days',
            acknowledged_at = now() - interval '18 days',
            responded_at = now() - interval '16 days',
            sla_ack_due_at = now() - interval '15 days',
            sla_response_due_at = now() - interval '13 days',
            sla_resolution_due_at = now() - interval '9 days',
            sla_resolution_breached = true,
            sla_stage_overdue = true,
            sla_breached = true
      where id = $1
      returning *`,
    [inserted.id]
  );
  assert.equal(wo0.priority, "P7");
  assert.equal(await (async () => (await c.query(`select si_open_sla_stage(w) s from work_orders w where id = $1`, [wo0.id])).rows[0].s)(), "resolution", "the fixture is sitting in its resolution stage");
  assert.ok(wo0.sla_resolution_due_at, "and that stage has a deadline to extend");
  assert.equal(wo0.sla_top_up_count, 0);
  const respondedAt = new Date(wo0.responded_at).getTime();

  // -------------------------------------------------------------------------
  // 2. The first top-up.
  // -------------------------------------------------------------------------
  await setClaims(c, admin.id, admin.roles);
  await c.query(`select si_extend_work_order_sla($1, null, true)`, [wo0.id]);
  await asPostgres();
  const { rows: [t1] } = await c.query(`select * from work_orders where id = $1`, [wo0.id]);

  assert.equal(t1.priority, "P7", "a top-up moves no priority");
  assert.equal(t1.priority_override, null, "and files itself as no kind of priority override");
  assert.equal(t1.impact, "long_term", "nor any impact");
  assert.equal(t1.status, wo0.status, "nor the status");
  assert.equal(t1.assigned_to_id, wo0.assigned_to_id, "nor the assignee");
  assert.equal(t1.sla_resolution_extra_mins, 10080, "one more of P7's own 7-day resolution window");
  assert.equal(t1.sla_ack_extra_mins, 0, "and nothing on a stage it is not sitting in");
  assert.equal(t1.sla_response_extra_mins, 0);
  assert.equal(t1.sla_top_up_count, 1);
  assert.equal(t1.sla_extension_count, 1, "a top-up is an extension too");
  pass("top-up #1 grants the stage its own window and moves nothing else");

  /* The deadline is the recorded stage moment plus target plus granted — never
     now(). Asserted to the minute against responded_at, which is what makes
     "added to the old deadline, not to the clock" a measurement rather than a
     claim. */
  const expected1 = respondedAt + (10080 + 10080) * 60000;
  assert.ok(
    Math.abs(new Date(t1.sla_resolution_due_at).getTime() - expected1) < 60000,
    `resolution due should be responded_at + 14 days, got ${t1.sla_resolution_due_at}`
  );
  pass("the new deadline is measured from the stage's own start, not from now()");

  assert.equal(t1.sla_resolution_breached, true, "a stage that was missed stays missed");
  assert.equal(t1.sla_breached, true, "and the permanent record with it");
  /* Still overdue, and that is the model rather than a failure: the stage
     started 16 days ago and has now been granted 14, so one top-up does not
     reach today. The dialog says "still overdue" on exactly this option before
     it is chosen. The second top-up below is what clears it. */
  assert.equal(t1.sla_stage_overdue, true, "16 days in, 14 days granted — still late");
  pass("sticky breach survives, and a single top-up does not pretend to catch up");

  const { rows: [hist1] } = await c.query(
    `select * from work_order_history where work_order_id = $1 order by created_at desc limit 1`,
    [wo0.id]
  );
  assert.equal(hist1.event_type, "sla_extension");
  assert.equal(hist1.from_status, hist1.to_status, "a top-up moves no status");
  assert.ok(hist1.remarks.includes("7 days"), "the remark names the time granted in words");
  assert.ok(hist1.remarks.includes("#1"), "and which top-up this was");
  pass("it lands on the timeline as sla_extension, naming the grant");

  // -------------------------------------------------------------------------
  // 3. A second top-up stacks, which is the whole point of uncapping it.
  // -------------------------------------------------------------------------
  await setClaims(c, admin.id, admin.roles);
  await c.query(`select si_extend_work_order_sla($1, null, true)`, [wo0.id]);
  await asPostgres();
  const { rows: [t2] } = await c.query(`select * from work_orders where id = $1`, [wo0.id]);
  assert.equal(t2.sla_resolution_extra_mins, 20160, "two windows now");
  assert.equal(t2.sla_top_up_count, 2);
  assert.ok(
    Math.abs(new Date(t2.sla_resolution_due_at).getTime() - (respondedAt + (10080 + 20160) * 60000)) < 60000
  );
  /* 16 days in, 21 granted — now genuinely ahead of the clock, so the TRANSIENT
     flag clears while the sticky one does not. This pair is the whole of 0067's
     distinction, exercised on a live row. */
  assert.equal(t2.sla_stage_overdue, false, "21 days granted finally reaches past today");
  assert.equal(t2.sla_resolution_breached, true, "but the stage it missed stays missed");
  assert.equal(t2.sla_breached, true);
  pass("top-up #2 stacks, clears the transient overdue, leaves the sticky breach");

  // -------------------------------------------------------------------------
  // 4. The interaction 0075 note 1 exists for: a later re-grade must PRESERVE
  //    the granted minutes. This is the assertion that would have caught the
  //    obvious implementation.
  // -------------------------------------------------------------------------
  await setClaims(c, admin.id, admin.roles);
  await c.query(`select si_override_work_order_priority($1, 'P8', $2)`, [
    wo0.id,
    "Re-grading after two top-ups, to check the granted time survives",
  ]);
  await asPostgres();
  const { rows: [rg] } = await c.query(`select * from work_orders where id = $1`, [wo0.id]);
  assert.equal(rg.priority, "P8");
  assert.equal(rg.sla_resolution_extra_mins, 20160, "the granted minutes survive a re-grade");
  assert.equal(rg.sla_top_up_count, 2, "and so does the count");
  // P8 resolution is 28800 minutes; the extras ride on top of it.
  assert.ok(
    Math.abs(new Date(rg.sla_resolution_due_at).getTime() - (respondedAt + (28800 + 20160) * 60000)) < 60000,
    `re-graded deadline should be P8's window plus the 14 days granted, got ${rg.sla_resolution_due_at}`
  );
  pass("a re-grade keeps every minute a top-up granted");

  // -------------------------------------------------------------------------
  // 5. Every refusal, each in its own savepoint.
  // -------------------------------------------------------------------------
  await c.query("savepoint s");
  await refuses(
    "a technician cannot top up",
    async () => {
      await setClaims(c, technician.id, technician.roles);
      await c.query(`select si_extend_work_order_sla($1, null, true)`, [wo0.id]);
    },
    "Only an Administrator"
  );
  await c.query("rollback to savepoint s");

  await refuses(
    "naming a priority AND a top-up is refused rather than resolved",
    async () => {
      await setClaims(c, admin.id, admin.roles);
      await c.query(`select si_extend_work_order_sla($1, 'P8', true)`, [wo0.id]);
    },
    "Topping up keeps this work order at its own priority"
  );
  await c.query("rollback to savepoint s");

  await refuses(
    "a direct PATCH of the granted minutes is refused at any rank",
    async () => {
      await setClaims(c, admin.id, admin.roles);
      await c.query(`update work_orders set sla_resolution_extra_mins = 99999 where id = $1`, [wo0.id]);
    },
    "Priority can only be changed by an Administrator"
  );
  await c.query("rollback to savepoint s");

  await refuses(
    "and so is a direct PATCH of the top-up count",
    async () => {
      await setClaims(c, admin.id, admin.roles);
      await c.query(`update work_orders set sla_top_up_count = 0 where id = $1`, [wo0.id]);
    },
    "Priority can only be changed by an Administrator"
  );
  await c.query("rollback to savepoint s");

  // A work order comfortably inside its window is not "running out of time".
  await asPostgres();
  const { rows: [fresh] } = await c.query(
    `insert into work_orders
       (wo_number, description, status, priority, impact, department_id, plant_id, asset_id,
        requester_id, requester_name, created_at, sla_ack_due_at)
     values ('WO-CHK0075B', 'not at risk', 'open', 'P7', 'long_term', $1, $2, $3, $4, 'Fixture',
             now(), now() + interval '5 days')
     returning id`,
    [dept.id, plant.id, asset.id, requester.id]
  );
  await refuses(
    "a stage with most of its time left cannot be topped up",
    async () => {
      await setClaims(c, admin.id, admin.roles);
      await c.query(`select si_extend_work_order_sla($1, null, true)`, [fresh.id]);
    },
    "still has most of its"
  );
  await c.query("rollback to savepoint s");

  // A finished work order's SLA is part of the record.
  await asPostgres();
  await c.query(`update work_orders set status = 'closed' where id = $1`, [wo0.id]);
  await refuses(
    "a closed work order cannot be topped up",
    async () => {
      await setClaims(c, admin.id, admin.roles);
      await c.query(`select si_extend_work_order_sla($1, null, true)`, [wo0.id]);
    },
    "is finished"
  );
  await c.query("rollback to savepoint s");

  // The re-grade mode still behaves exactly as 0072/0073 left it.
  await refuses(
    "re-grading upward is still refused",
    async () => {
      await setClaims(c, admin.id, admin.roles);
      await c.query(`select si_extend_work_order_sla($1, 'P1')`, [wo0.id]);
    },
    "can only move a work order to a lower priority"
  );
  await c.query("rollback to savepoint s");

  await asPostgres();
  console.log("\n" + ok.map((m) => "  PASS  " + m).join("\n"));
  console.log(`\n0075: ${ok.length} assertions passed. Rolling back — nothing is left on test.`);
} finally {
  await c.query("rollback");
  await c.end();
}
