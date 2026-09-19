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

const { rows: [dept] } = await c.query(`select id from departments limit 1`);
const { rows: [plant] } = await c.query(`select id from plants where status = 'active' limit 1`);
const { rows: [asset] } = await c.query(`select id from assets where plant_id = $1 limit 1`, [plant.id]);
const { rows: [requesterUser] } = await c.query(
  `select id from users where 'requester' = any(roles) and status = 'active' limit 1`
);

// ===========================================================================
// CHECK 4 — raise a P8, confirm derivation and SLA due dates
// ===========================================================================
console.log("=== CHECK 4: raise a P8 (impact = scheduled) ===");
await c.query("begin");
try {
  const { rows: [wo] } = await c.query(
    `insert into work_orders
       (wo_number, description, status, priority, impact, department_id, plant_id, asset_id, requester_id, requester_name)
     values
       ('WO-CHECK4-P8', 'Scheduled long-run maintenance', 'open', 'P1', 'scheduled', $1, $2, $3, $4, 'Fixture Requester')
     returning *`,
    [dept.id, plant.id, asset.id, requesterUser.id]
  );

  console.log("derived priority:", wo.priority, "(expect P8)");
  console.log("impact:", wo.impact);
  console.log("sla_ack_due_at:", wo.sla_ack_due_at, "created_at:", wo.created_at);
  const ackDays = (new Date(wo.sla_ack_due_at) - new Date(wo.created_at)) / (1000 * 60 * 60 * 24);
  console.log("ack due, days from creation:", ackDays, "(expect 5)");
  console.log("sla_response_due_at:", wo.sla_response_due_at, "(expect null)");
  console.log("sla_resolution_due_at:", wo.sla_resolution_due_at, "(expect null)");

  const pass = wo.priority === "P8" && Math.abs(ackDays - 5) < 0.01 && wo.sla_response_due_at === null && wo.sla_resolution_due_at === null;
  console.log("CHECK 4a RESULT:", pass ? "PASS" : "FAIL");

  console.log("\n=== CHECK 4b: dashboard card arithmetic ===");
  await c.query(`select si_compute_dashboard_stats()`);
  const { rows: [statsRow] } = await c.query(`select data from stats where id = 'dashboard_cards'`);
  const d = statsRow.data;
  console.log("p1_critical:", d.p1_critical);
  console.log("p2_high:", d.p2_high);
  console.log("p3_medium:", d.p3_medium);
  console.log("p4_low:", d.p4_low);
  console.log("p7_long_term:", d.p7_long_term);
  console.log("p8_scheduled:", d.p8_scheduled);
  console.log("total_open:", d.total_open);
  const sum = d.p1_critical + d.p2_high + d.p3_medium + d.p4_low + d.p7_long_term + d.p8_scheduled;
  console.log("sum of seven priority bands:", sum, "vs total_open:", d.total_open, sum === d.total_open ? "MATCH" : "MISMATCH");

  // ===========================================================================
  // CHECK 5 — the Overdue cross-check
  // ===========================================================================
  console.log("\n=== CHECK 5: overdue cross-check ===");
  const { rows: [overdueCount] } = await c.query(
    `select count(*) as n from work_orders where status = any (si_open_statuses()) and sla_stage_overdue`
  );
  console.log("live count of open+overdue work orders:", overdueCount.n);
  console.log("stats.data->>'overdue':", d.overdue);
  console.log(
    Number(overdueCount.n) === Number(d.overdue) ? "MATCH" : "DIFFER (may be legitimate if cron sweep hasn't run since an advance)"
  );
} finally {
  await c.query("rollback");
  console.log("\n(transaction rolled back)");
}

await c.end();
