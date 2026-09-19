/**
 * The 0069/0070 review gate: what the two backfills did to every work order.
 *
 * Prints one row per work order — before and after — and then runs the
 * assertions. Read the table; the assertions only prove the things that can
 * be proved mechanically.
 *
 * Run: node scripts/checks/backfillReport.mjs
 *
 * Connection: this worktree has no SUPABASE_DB_URL in app/.env.local. The
 * working route on this machine (same one Tasks 3 and 4 used) is the pooler
 * host/user/db from app/supabase/.temp/pooler-url plus SUPABASE_DB_PASSWORD
 * from app/.env.local.
 *
 * Fix round 1 (0070) note: `sla_backfill_0069`'s before-image does not carry
 * `verified_at`/`verified_by`/`assigned_to_id`/`decline_count` — 0069 was
 * written before those four were in scope, and chasing them retroactively
 * against a snapshot that never captured them would test nothing. They are
 * checked instead against `sla_backfill_0070`, which does capture them.
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

// 1a. Nothing outside the SLA columns moved — checked against what 0069's
//     before-image actually holds: status, resolved_at, closed_at, priority.
const { rows: [moved] } = await c.query(`
  select count(*) as n
    from work_orders w
    join sla_backfill_0069 b on b.work_order_id = w.id
   where w.status      is distinct from b.status
      or w.resolved_at is distinct from b.resolved_at
      or w.closed_at   is distinct from b.closed_at
      or w.priority    is distinct from b.priority
`);
console.log(
  "1a. rows whose status/resolved_at/closed_at/priority (0069 before-image) changed:",
  moved.n,
  "(must be 0)"
);

// 1b. The four columns 0069's before-image never captured, checked against
//     0070's own before-image, which does.
const { rows: [movedExtra] } = await c.query(`
  select count(*) as n
    from work_orders w
    join sla_backfill_0070 b on b.work_order_id = w.id
   where w.verified_at    is distinct from b.verified_at
      or w.verified_by    is distinct from b.verified_by
      or w.assigned_to_id is distinct from b.assigned_to_id
      or w.decline_count  is distinct from b.decline_count
`);
console.log(
  "1b. rows whose verified_at/verified_by/assigned_to_id/decline_count (0070 before-image) changed:",
  movedExtra.n,
  "(must be 0)"
);

// 2. Every finished work order's verdict is a comparison of two stamps, so it
//    cannot move again. Proved by re-running the arithmetic and diffing, for
//    all three stages — not only acknowledge, which is the stage every row
//    reaches, unlike response and resolution. Each prints how many rows the
//    check actually covers alongside the disagreement count, since a check
//    over a handful of rows is a different claim from one over the whole
//    table.
const { rows: [ackDrift] } = await c.query(`
  with hist as (
    select work_order_id,
           min(created_at) filter (where to_status = 'assigned') as first_assigned
      from work_order_history
     where coalesce(event_type,'transition') = 'transition'
     group by work_order_id
  )
  select count(*) as tested,
         count(*) filter (
           where w.sla_ack_breached
                 is distinct from (coalesce(w.acknowledged_at, h.first_assigned)
                                   > w.created_at + make_interval(mins => t.ack))
         ) as disagree
    from work_orders w
    left join hist h on h.work_order_id = w.id
    cross join lateral si_sla_targets(w.priority) t
   where coalesce(w.acknowledged_at, h.first_assigned) is not null
`);
console.log(
  "2a. acknowledge verdicts that disagree with recomputation:",
  ackDrift.disagree,
  `(must be 0; tested ${ackDrift.tested} of 45 rows with a recorded acknowledge stamp)`
);

const { rows: [respDrift] } = await c.query(`
  with hist as (
    select work_order_id,
           min(created_at) filter (where to_status = 'repairing') as first_repairing
      from work_order_history
     where coalesce(event_type,'transition') = 'transition'
     group by work_order_id
  )
  select count(*) as tested,
         count(*) filter (
           where w.sla_response_breached
                 is distinct from (coalesce(w.responded_at, h.first_repairing)
                                   > w.acknowledged_at + make_interval(mins => t.response))
         ) as disagree
    from work_orders w
    left join hist h on h.work_order_id = w.id
    cross join lateral si_sla_targets(w.priority) t
   where coalesce(w.responded_at, h.first_repairing) is not null
     and w.acknowledged_at is not null
`);
console.log(
  "2b. response verdicts that disagree with recomputation:",
  respDrift.disagree,
  `(must be 0; tested ${respDrift.tested} rows with a recorded response stamp)`
);

const { rows: [resDrift] } = await c.query(`
  select count(*) as tested,
         count(*) filter (
           where w.sla_resolution_breached
                 is distinct from (coalesce(w.resolved_at, w.closed_at)
                                   > w.responded_at + make_interval(mins => t.resolution))
         ) as disagree
    from work_orders w
    cross join lateral si_sla_targets(w.priority) t
   where coalesce(w.resolved_at, w.closed_at) is not null
     and w.responded_at is not null
`);
console.log(
  "2c. resolution verdicts that disagree with recomputation:",
  resDrift.disagree,
  `(must be 0; tested ${resDrift.tested} rows with a recorded resolution stamp)`
);

// 3. sla_breached is exactly the OR of the three.
const { rows: [orRule] } = await c.query(`
  select count(*) as n from work_orders
   where sla_breached is distinct from (sla_ack_breached or sla_response_breached or sla_resolution_breached)
`);
console.log("3. rows where sla_breached is not the OR of the three:", orRule.n, "(must be 0)");

// 4. Nothing finished is flagged as currently overdue.
const { rows: [ghost] } = await c.query(`
  select count(*) as n from work_orders
   where sla_stage_overdue and status in ('completed','verified','closed')
`);
console.log("4. finished work orders still marked overdue:", ghost.n, "(must be 0)");

// 5. The exact regression 0070 corrected: 0069's arithmetic read
//    `else now() > due` whenever a stage's own completion stamp was null,
//    which is right for a stage the work order is still running and wrong
//    for one it has moved past — a finished work order with no way to ever
//    clear the flag again. 0070's rule is that an unstamped stage on a
//    finished work order is unknowable, not missed, so none of the three
//    sticky flags should be true where the stage's own stamp never landed.
const { rows: [unstamped] } = await c.query(`
  select count(*) as tested,
         count(*) filter (
           where (sla_ack_breached and acknowledged_at is null)
              or (sla_response_breached and responded_at is null)
              or (sla_resolution_breached and resolved_at is null and closed_at is null)
         ) as disagree
    from work_orders
   where status in ('completed', 'verified', 'closed')
`);
console.log(
  "5. finished work orders with a stage flagged breached but no completion stamp for that stage:",
  unstamped.disagree,
  `(must be 0; tested ${unstamped.tested} finished rows)`
);

await c.end();
