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

const { rows: users } = await c.query(
  `select id, name, roles::text[] as roles, is_protected from users where status = 'active'`
);
function findUser(pred) {
  return users.find(pred);
}
const admin = findUser((u) => u.roles.includes("admin"));
const supervisor = findUser((u) => u.roles.includes("supervisor"));
const technician = findUser((u) => u.roles.includes("technician"));
const requesterUser = findUser((u) => u.roles.includes("requester"));

console.log("supervisor:", supervisor.name, "technician:", technician.name, "requester:", requesterUser.name);

const table = [];

await c.query("begin");
try {
  const { rows: [dept] } = await c.query(`select id from departments limit 1`);
  const { rows: [plant] } = await c.query(`select id from plants where status = 'active' limit 1`);
  const { rows: [asset] } = await c.query(`select id from assets where plant_id = $1 limit 1`, [plant.id]);

  // Raise as the requester (P2, reduced_capacity impact)
  await setClaims(c, requesterUser.id, requesterUser.roles);
  const { rows: [wo] } = await c.query(
    `insert into work_orders
       (wo_number, description, status, priority, impact, department_id, plant_id, asset_id,
        requester_id, requester_name)
     values
       ('WO-WALK0074', 'End-to-end status walk fixture', 'open', 'P2', 'reduced_capacity',
        $1, $2, $3, $4, 'Fixture Requester')
     returning *`,
    [dept.id, plant.id, asset.id, requesterUser.id]
  );

  function record(label) {
    return c.query(
      `select status, si_open_sla_stage(w) as open_stage, sla_stage_overdue,
              sla_ack_breached, sla_response_breached, sla_resolution_breached, sla_breached
         from work_orders w where id = $1`,
      [wo.id]
    ).then(({ rows: [r] }) => {
      table.push({ step: label, ...r });
    });
  }

  await record("raised (open)");

  // Backdate created_at (and sla_ack_due_at with it) so the acknowledge stage
  // is already overdue, to exercise sla_stage_overdue going true and then
  // clearing when the work order advances past that stage.
  // sla_stage_overdue itself is only recomputed by si_stamp_work_order on a
  // status-changing UPDATE, or by the 5-minute sweep (0068) — set it here to
  // simulate what that sweep would have flagged in the interim.
  await c.query(
    `update work_orders
        set created_at = now() - interval '1 hour',
            sla_ack_due_at = now() - interval '55 minutes',
            sla_stage_overdue = true
      where id = $1`,
    [wo.id]
  );
  await record("backdated: ack now overdue");

  // open -> assigned (supervisor)
  await setClaims(c, supervisor.id, supervisor.roles);
  await c.query(`select si_transition_work_order($1, 'assigned', $2::jsonb)`, [
    wo.id,
    JSON.stringify({ assigned_to_id: technician.id }),
  ]);
  await record("open -> assigned");

  // assigned -> accepted (technician)
  await setClaims(c, technician.id, technician.roles);
  await c.query(`select si_transition_work_order($1, 'accepted')`, [wo.id]);
  await record("assigned -> accepted");

  // accepted -> repairing (technician)
  await c.query(`select si_transition_work_order($1, 'repairing')`, [wo.id]);
  await record("accepted -> repairing");

  // repairing -> testing (technician)
  await c.query(`select si_transition_work_order($1, 'testing')`, [wo.id]);
  await record("repairing -> testing");

  // testing -> completed (technician, requires resolution_notes)
  await c.query(`select si_transition_work_order($1, 'completed', $2::jsonb)`, [
    wo.id,
    JSON.stringify({ resolution_notes: "Fixed the fault; replaced worn part." }),
  ]);
  await record("testing -> completed (auto-closes)");

  await c.query(`reset role`);

  console.log("\n=== End-to-end walk ===");
  console.table(table);

  // Extra: confirm auto-close happened and final state
  const { rows: [final] } = await c.query(`select status, closed_at, verified_at from work_orders where id = $1`, [wo.id]);
  console.log("final row status/closed_at/verified_at:", final);

  // Checks
  const stickyOnlyForward = (() => {
    let prevAck = false, prevResp = false, prevRes = false;
    for (const row of table) {
      if ((prevAck && !row.sla_ack_breached) || (prevResp && !row.sla_response_breached) || (prevRes && !row.sla_resolution_breached)) {
        return false;
      }
      prevAck = row.sla_ack_breached;
      prevResp = row.sla_response_breached;
      prevRes = row.sla_resolution_breached;
    }
    return true;
  })();
  console.log("Sticky flags only ever go false->true:", stickyOnlyForward ? "PASS" : "FAIL");

  const lastRow = table[table.length - 1];
  console.log("Completed/closed row has no open stage:", lastRow.open_stage === null ? "PASS" : "FAIL (" + lastRow.open_stage + ")");
} finally {
  await c.query("rollback");
  console.log("\n(transaction rolled back)");
}

await c.end();
