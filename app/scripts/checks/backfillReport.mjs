/**
 * The 0069 review gate: what the backfill did to every work order.
 *
 * Prints one row per work order — before and after — and then runs the four
 * assertions the spec requires. Read the table; the assertions only prove the
 * things that can be proved mechanically.
 *
 * Run: node scripts/checks/backfillReport.mjs
 *
 * Connection: this worktree has no SUPABASE_DB_URL in app/.env.local. The
 * working route on this machine (same one Tasks 3 and 4 used) is the pooler
 * host/user/db from app/supabase/.temp/pooler-url plus SUPABASE_DB_PASSWORD
 * from app/.env.local.
 */
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
  if (!password) {
    throw new Error(
      "Neither SUPABASE_DB_URL nor SUPABASE_DB_PASSWORD is in app/.env.local — take the pooler string from Supabase → Settings → Database → Connection pooling."
    );
  }
  // poolerBase is postgresql://<user>@host:port/db — splice the password in
  // right after the user, before the @.
  url = poolerBase.replace(
    /^postgresql:\/\/([^@]+)@/,
    (_, user) => `postgresql://${user}:${encodeURIComponent(password)}@`
  );
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(`
  select w.wo_number, w.priority, w.status,
         b.sla_breached            as was_breached,
         w.sla_ack_breached        as ack_missed,
         w.sla_response_breached   as resp_missed,
         w.sla_resolution_breached as res_missed,
         w.sla_stage_overdue       as overdue_now,
         si_open_sla_stage(w)      as open_stage,
         b.sla_resolution_due_at   as res_due_before,
         w.sla_resolution_due_at   as res_due_after
    from work_orders w
    join sla_backfill_0069 b on b.work_order_id = w.id
   order by w.created_at
`);
console.table(rows);

// 1. Nothing outside the SLA columns moved.
const { rows: [moved] } = await c.query(`
  select count(*) as n
    from work_orders w
    join sla_backfill_0069 b on b.work_order_id = w.id
   where w.status      is distinct from b.status
      or w.resolved_at is distinct from b.resolved_at
      or w.closed_at   is distinct from b.closed_at
      or w.priority    is distinct from b.priority
`);
console.log("rows whose status/resolved_at/closed_at/priority changed:", moved.n, "(must be 0)");

// 2. Every finished work order's verdict is a comparison of two stamps, so it
//    cannot move again. Proved by re-running the arithmetic and diffing.
const { rows: [drift] } = await c.query(`
  with hist as (
    select work_order_id,
           min(created_at) filter (where to_status = 'assigned') as first_assigned
      from work_order_history
     where coalesce(event_type,'transition') = 'transition'
     group by work_order_id
  )
  select count(*) as n
    from work_orders w
    left join hist h on h.work_order_id = w.id
    cross join lateral si_sla_targets(w.priority) t
   where coalesce(w.acknowledged_at, h.first_assigned) is not null
     and w.sla_ack_breached
         is distinct from (coalesce(w.acknowledged_at, h.first_assigned)
                           > w.created_at + make_interval(mins => t.ack))
`);
console.log("acknowledge verdicts that disagree with recomputation:", drift.n, "(must be 0)");

// 3. sla_breached is exactly the OR of the three.
const { rows: [orRule] } = await c.query(`
  select count(*) as n from work_orders
   where sla_breached is distinct from (sla_ack_breached or sla_response_breached or sla_resolution_breached)
`);
console.log("rows where sla_breached is not the OR of the three:", orRule.n, "(must be 0)");

// 4. Nothing finished is flagged as currently overdue.
const { rows: [ghost] } = await c.query(`
  select count(*) as n from work_orders
   where sla_stage_overdue and status in ('completed','closed')
`);
console.log("finished work orders still marked overdue:", ghost.n, "(must be 0)");

await c.end();
