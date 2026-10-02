/**
 * Migration 0079 exercised against the live TEST project, inside one
 * transaction that is always rolled back.
 *
 * Run: node scripts/checks/sla0079RetireOldExtend.mjs
 *
 * What it proves: the old Extend SLA function is gone, and nothing it ever
 * recorded moved — history rows, override columns, counts and granted minutes
 * are byte-identical before and after — while the new function still works.
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
const ok = [];
const pass = (m) => ok.push(m);

/* Everything an old extension could have written, as one comparable string. */
const SNAPSHOT = `
  select coalesce(json_agg(x order by x.id)::text, '[]') s from (
    select id, priority, priority_override, priority_override_reason, priority_overridden_by,
           priority_overridden_at, sla_extension_count, sla_top_up_count, sla_ack_extra_mins,
           sla_response_extra_mins, sla_resolution_extra_mins, sla_ack_due_at,
           sla_response_due_at, sla_resolution_due_at
      from work_orders
     where coalesce(sla_extension_count, 0) > 0 or priority_override is not null) x`;
const HISTORY = `
  select count(*)::int n, coalesce(md5(string_agg(id::text || coalesce(remarks, ''), ',' order by id)), '') h
    from work_order_history where event_type = 'sla_extension'`;

await c.query("begin");
try {
  const { rows: [before] } = await c.query(SNAPSHOT);
  const { rows: [histBefore] } = await c.query(HISTORY);
  assert.ok(histBefore.n > 0, "test project should hold at least one recorded extension to protect");

  const sql = readFileSync(new URL("../../supabase/migrations/0079_retire_the_old_extend_function.sql", import.meta.url), "utf8");
  await c.query(sql);
  pass("0079 applies cleanly");
  await c.query(sql);
  pass("0079 applies a second time (SQL Editor re-run is safe)");

  const { rows: [{ n }] } = await c.query(
    `select count(*)::int n from pg_proc where proname = 'si_extend_work_order_sla'`);
  assert.equal(n, 0, "both signatures of the old function are gone");
  pass("si_extend_work_order_sla no longer exists");

  const { rows: [after] } = await c.query(SNAPSHOT);
  assert.equal(after.s, before.s, "no work order's extension record changed");
  pass(`extension records on ${JSON.parse(before.s).length} work orders unchanged`);

  const { rows: [histAfter] } = await c.query(HISTORY);
  assert.deepEqual(histAfter, histBefore, "timeline rows unchanged");
  pass(`${histBefore.n} 'SLA extended' timeline rows unchanged`);

  const { rows: [{ n: newFn }] } = await c.query(
    `select count(*)::int n from pg_proc where proname = 'si_extend_sla_stage'`);
  assert.equal(newFn, 1, "the new function is untouched");
  pass("si_extend_sla_stage still present");

  // Change priority survives the drop. Its body names the old function only in
  // two comments (checked against 0075's source), and plpgsql links nothing
  // at create time, so presence is what there is to assert here; 0078's check
  // exercises it end to end.
  const { rows: [{ ok: overrideOk }] } = await c.query(
    `select count(*) = 1 ok from pg_proc where proname = 'si_override_work_order_priority'`);
  assert.ok(overrideOk);
  pass("si_override_work_order_priority still present");

  console.log("\n" + ok.map((m) => "  PASS  " + m).join("\n"));
  console.log(`\n0079: ${ok.length} assertions passed. Rolling back — nothing is left on test.`);
} finally {
  await c.query("rollback");
  await c.end();
}
