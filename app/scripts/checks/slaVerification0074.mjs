import { readFileSync } from "node:fs";
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
  const password = env.SUPABASE_DB_PASSWORD;
  url = poolerBase.replace(
    /^postgresql:\/\/([^@]+)@/,
    (_, user) => `postgresql://${user}:${encodeURIComponent(password)}@`
  );
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

function log(...args) {
  console.log(...args);
}

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

// ---------------------------------------------------------------------------
// Find an admin and superuser account, and a technician/supervisor for the walk.
// ---------------------------------------------------------------------------
const { rows: users } = await c.query(`
  select id, name, roles::text[] as roles, is_protected from users where status = 'active'
`);
function findUser(pred) {
  return users.find(pred);
}
const admin = findUser((u) => u.roles.includes("admin"));
const superuser = findUser((u) => u.is_protected) || admin;
const technician = findUser((u) => u.roles.includes("technician"));
const supervisor = findUser((u) => u.roles.includes("supervisor"));
const requesterUser = findUser((u) => u.roles.includes("requester")) || technician;

log("admin:", admin?.name, admin?.id);
log("superuser:", superuser?.name, superuser?.id, "is_protected:", superuser?.is_protected);
log("technician:", technician?.name, technician?.id);
log("supervisor:", supervisor?.name, supervisor?.id);

// ===========================================================================
// CHECK 1a — si_override_work_order_priority: sla_breached must survive
// ===========================================================================
log("\n=== CHECK 1a: si_override_work_order_priority ===");
{
  await c.query("begin");
  try {
    // Construct a work order missed at ack, not yet responded.
    const { rows: [dept] } = await c.query(`select id from departments limit 1`);
    const { rows: [plant] } = await c.query(`select id from plants where status = 'active' limit 1`);
    const { rows: [asset] } = await c.query(`select id from assets where plant_id = $1 limit 1`, [plant.id]);
    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24); // 1 day ago
    const ackDue = new Date(createdAt.getTime() + 15 * 60 * 1000); // P2 ack target 15m
    const ackedAt = new Date(createdAt.getTime() + 60 * 60 * 1000); // acked 1h later -> breached

    const { rows: [wo] } = await c.query(
      `insert into work_orders
         (wo_number, description, status, priority, impact, department_id, plant_id, asset_id,
          requester_id, requester_name, assigned_to_id, assigned_to_name,
          created_at, sla_ack_due_at, acknowledged_at,
          sla_ack_breached, sla_response_breached, sla_resolution_breached, sla_breached, sla_stage_overdue)
       values
         ('WO-CHECK1A', 'Missed ack, not started', 'assigned', 'P2', 'reduced_capacity',
          $1, $2, $3, $4, 'Fixture Requester', $5, 'Fixture Tech',
          $6, $7, $8,
          true, false, false, true, true)
       returning *`,
      [dept.id, plant.id, asset.id, requesterUser.id, technician.id, createdAt, ackDue, ackedAt]
    );

    log("before override:", {
      status: wo.status,
      sla_ack_breached: wo.sla_ack_breached,
      sla_response_breached: wo.sla_response_breached,
      sla_resolution_breached: wo.sla_resolution_breached,
      sla_breached: wo.sla_breached,
      responded_at: wo.responded_at,
      sla_resolution_due_at: wo.sla_resolution_due_at,
      assigned_to_id: wo.assigned_to_id,
      acknowledged_at: wo.acknowledged_at,
    });

    await setClaims(c, admin.id, ["admin"], true);
    await c.query(`select si_override_work_order_priority($1, 'P3', $2)`, [
      wo.id,
      "Reclassifying after review of the fault report",
    ]);

    await c.query(`reset role`);
    const { rows: [after] } = await c.query(`select * from work_orders where id = $1`, [wo.id]);
    log("after override:", {
      status: after.status,
      priority: after.priority,
      priority_override: after.priority_override,
      sla_ack_breached: after.sla_ack_breached,
      sla_response_breached: after.sla_response_breached,
      sla_resolution_breached: after.sla_resolution_breached,
      sla_breached: after.sla_breached,
      sla_stage_overdue: after.sla_stage_overdue,
      assigned_to_id: after.assigned_to_id,
      acknowledged_at: after.acknowledged_at?.toISOString?.() ?? after.acknowledged_at,
      responded_at: after.responded_at,
    });

    const pass =
      after.sla_breached === true &&
      after.sla_ack_breached === true &&
      after.status === wo.status &&
      String(after.assigned_to_id) === String(wo.assigned_to_id) &&
      +new Date(after.acknowledged_at) === +new Date(wo.acknowledged_at) &&
      after.responded_at === null;
    log("CHECK 1a RESULT:", pass ? "PASS" : "FAIL");
  } finally {
    await c.query("rollback");
  }
}

// ===========================================================================
// CHECK 1b — si_correct_work_order_timeline, under-way path
// ===========================================================================
log("\n=== CHECK 1b: si_correct_work_order_timeline (under-way path) ===");
{
  await c.query("begin");
  try {
    const { rows: [dept] } = await c.query(`select id from departments limit 1`);
    const { rows: [plant] } = await c.query(`select id from plants where status = 'active' limit 1`);
    const { rows: [asset] } = await c.query(`select id from assets where plant_id = $1 limit 1`, [plant.id]);

    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10); // 10 days ago
    const ackedAt = new Date(createdAt.getTime() + 5 * 60 * 1000);
    const respondedAt = new Date(ackedAt.getTime() + 10 * 60 * 1000);
    const resDue = new Date(respondedAt.getTime() + 60 * 60 * 1000); // P2 resolution 420m normally but keep small window for test clarity
    // completedAt BEFORE resDue -> should read on-time
    const completedAt = new Date(resDue.getTime() - 30 * 60 * 1000);

    const { rows: [wo] } = await c.query(
      `insert into work_orders
         (wo_number, description, status, priority, impact, department_id, plant_id, asset_id,
          requester_id, requester_name, assigned_to_id, assigned_to_name,
          created_at, acknowledged_at, responded_at, sla_ack_due_at, sla_response_due_at, sla_resolution_due_at,
          sla_ack_breached, sla_response_breached, sla_resolution_breached, sla_breached, sla_stage_overdue)
       values
         ('WO-CHECK1B', 'Stuck in repairing, past due', 'repairing', 'P2', 'reduced_capacity',
          $1, $2, $3, $4, 'Fixture Requester', $5, 'Fixture Tech',
          $6, $7, $8, $9, $10, $11,
          false, false, true, true, true)
       returning *`,
      [dept.id, plant.id, asset.id, requesterUser.id, technician.id, createdAt, ackedAt, respondedAt, ackedAt, respondedAt, resDue]
    );

    log("before correction:", {
      status: wo.status,
      sla_ack_breached: wo.sla_ack_breached,
      sla_response_breached: wo.sla_response_breached,
      sla_resolution_breached: wo.sla_resolution_breached,
      sla_breached: wo.sla_breached,
      sla_resolution_due_at: wo.sla_resolution_due_at,
    });

    await setClaims(c, superuser.id, superuser.roles, true);
    await c.query(`select si_correct_work_order_timeline($1, $2::timestamptz, $3)`, [
      wo.id,
      completedAt.toISOString(),
      "Backdating: job was actually finished before the deadline, confirmed with technician",
    ]);

    await c.query(`reset role`);
    const { rows: [after] } = await c.query(`select * from work_orders where id = $1`, [wo.id]);
    log("after correction:", {
      status: after.status,
      resolved_at: after.resolved_at,
      closed_at: after.closed_at,
      sla_ack_breached: after.sla_ack_breached,
      sla_response_breached: after.sla_response_breached,
      sla_resolution_breached: after.sla_resolution_breached,
      sla_breached: after.sla_breached,
    });

    const pass =
      after.sla_resolution_breached === false &&
      after.sla_breached === false &&
      after.sla_ack_breached === false &&
      after.sla_response_breached === false;
    log("CHECK 1b (under-way) RESULT:", pass ? "PASS" : "FAIL");
  } finally {
    await c.query("rollback");
  }
}

// ===========================================================================
// CHECK 1c — si_correct_work_order_timeline, finished path
// ===========================================================================
log("\n=== CHECK 1c: si_correct_work_order_timeline (finished path) ===");
{
  await c.query("begin");
  try {
    const { rows: [dept] } = await c.query(`select id from departments limit 1`);
    const { rows: [plant] } = await c.query(`select id from plants where status = 'active' limit 1`);
    const { rows: [asset] } = await c.query(`select id from assets where plant_id = $1 limit 1`, [plant.id]);

    const createdAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10);
    const ackedAt = new Date(createdAt.getTime() + 5 * 60 * 1000);
    const respondedAt = new Date(ackedAt.getTime() + 10 * 60 * 1000);
    const resDue = new Date(respondedAt.getTime() + 60 * 60 * 1000);
    const closedAt = new Date(resDue.getTime() + 60 * 60 * 1000); // originally recorded AFTER due -> breached
    const correctedCompletedAt = new Date(resDue.getTime() - 30 * 60 * 1000); // corrected to BEFORE due

    const { rows: [wo] } = await c.query(
      `insert into work_orders
         (wo_number, description, status, priority, impact, department_id, plant_id, asset_id,
          requester_id, requester_name, assigned_to_id, assigned_to_name,
          created_at, acknowledged_at, responded_at, resolved_at, closed_at,
          sla_ack_due_at, sla_response_due_at, sla_resolution_due_at,
          sla_ack_breached, sla_response_breached, sla_resolution_breached, sla_breached, sla_stage_overdue)
       values
         ('WO-CHECK1C', 'Closed, wrongly recorded as late', 'closed', 'P2', 'reduced_capacity',
          $1, $2, $3, $4, 'Fixture Requester', $5, 'Fixture Tech',
          $6, $7, $8, $9, $9,
          $7, $8, $10,
          false, false, true, true, false)
       returning *`,
      [dept.id, plant.id, asset.id, requesterUser.id, technician.id, createdAt, ackedAt, respondedAt, closedAt, resDue]
    );

    log("before correction (finished):", {
      status: wo.status,
      sla_resolution_breached: wo.sla_resolution_breached,
      sla_breached: wo.sla_breached,
    });

    await setClaims(c, superuser.id, superuser.roles, true);
    await c.query(`select si_correct_work_order_timeline($1, $2::timestamptz, $3)`, [
      wo.id,
      correctedCompletedAt.toISOString(),
      "Backdating a closed record: found the real completion time in the log book",
    ]);

    await c.query(`reset role`);
    const { rows: [after] } = await c.query(`select * from work_orders where id = $1`, [wo.id]);
    log("after correction (finished):", {
      status: after.status,
      resolved_at: after.resolved_at,
      closed_at: after.closed_at,
      sla_resolution_breached: after.sla_resolution_breached,
      sla_breached: after.sla_breached,
    });

    const pass = after.sla_resolution_breached === false && after.sla_breached === false;
    log("CHECK 1c (finished) RESULT:", pass ? "PASS" : "FAIL");
  } finally {
    await c.query("rollback");
  }
}

await c.end();
