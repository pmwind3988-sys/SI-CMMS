/**
 * SI — Service Inside · Work Order Module
 *
 * Seeds ONE demo work order reproducing this exact reported timeline:
 *
 *   08:15  Requester submitted work order.
 *   08:17  Supervisor assigned Technician A.
 *   08:24  Technician accepted.
 *   08:33  Technician arrived.
 *   09:10  Repair completed.
 *   09:15  Requester verified.
 *   09:16  Work order closed.
 *
 * Our status flow has intermediate states this narrative doesn't call out on its
 * own (on_the_way, repairing-start, testing) — folded into the nearest adjacent
 * timestamp rather than inventing precision the report never gave; see the
 * inline comments on each history entry below.
 *
 * TWO THINGS DIFFER from the Firebase version, both forced by real constraints
 * rather than preference:
 *
 *   1. The actors are looked up from public.users by email instead of being
 *      hardcoded ("demo-requester", "tech-arun"). requester_id, assigned_to_id
 *      and actor_id are uuid foreign keys onto users(id) now, so invented string
 *      ids cannot be inserted at all. Run bootstrap:users first.
 *
 *   2. Inserting the work order fires si_before_work_order_insert, which
 *      allocates a real wo_number from the counters table. The row is inserted
 *      and then walked forward through its statuses via the same UPDATE path the
 *      app uses, so this demo exercises the actual transition trigger instead of
 *      writing a fabricated end state. The seeded timestamps are then corrected
 *      to the reported clock times.
 *
 * Usage:
 *   npm run bootstrap:users     (once, creates the accounts this needs)
 *   npm run seed:demo
 */
const { admin, projectLabel, guardProductionWrite } = require("./_supabaseAdmin");

const db = admin();

const DEMO_DATE = "2026-07-23";
const t = (hhmm) => new Date(`${DEMO_DATE}T${hhmm}:00`).toISOString();

const DEPARTMENT_ID = "DEPT-MACHINING";

async function userByEmail(email) {
  const { data, error } = await db
    .from("users")
    // No `role`: migration 0021 dropped users.role, and PostgREST answers a
    // select naming a column that does not exist with an error rather than a
    // null — so this script had been failing on its first lookup since 0021 was
    // applied. Nothing here ever read it: actor_role on the history rows comes
    // from the hardcoded events list below, not from the account.
    .select("id, name, phone")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`lookup ${email}: ${error.message}`);
  if (!data) {
    throw new Error(
      `No users row for ${email}. Run "npm run bootstrap:users" first — the demo ` +
        `work order references real accounts by uuid and cannot invent them.`
    );
  }
  return data;
}

async function seed() {
  console.log(`Project: ${projectLabel()}\n`);
  guardProductionWrite("seed:demo");

  const requester = await userByEmail("requester@example.com");
  const supervisor = await userByEmail("supervisor@example.com");
  const technician = await userByEmail("tech.arun@example.com");

  const { data: inserted, error: insertError } = await db
    .from("work_orders")
    .insert({
      department_id: DEPARTMENT_ID,
      asset_id: "AST-0412",
      asset_name: "CNC Lathe #04",
      plant_id: "PLT001",
      type: "breakdown",
      priority: "P2",
      status: "open",
      impact: "reduced_capacity",
      est_downtime_value: 1,
      est_downtime_unit: "hours",
      description:
        "Reported at 08:15 — demo trace of a clean, on-time repair from submission to closure.",
      safety_risk: { flag: false, severity: null },
      environmental_risk: { flag: false },
      permit_required: false,
      requester_id: requester.id,
      requester_name: requester.name,
      requester_phone: requester.phone || "98450 11223",
      client_uuid: `demo-seed-${Date.now()}`,
    })
    .select("id, wo_number")
    .single();
  if (insertError) throw new Error(`insert work order: ${insertError.message}`);

  const woId = inserted.id;

  // Walk the real transition path. Each UPDATE goes through
  // si_guard_work_order_transition, so if the matrix and this narrative ever
  // disagree, this script fails loudly instead of writing an impossible history.
  const steps = [
    { status: "assigned",   fields: { assigned_to_id: technician.id, assigned_to_name: technician.name } },
    { status: "accepted",   fields: {} },
    { status: "on_the_way", fields: {} },
    { status: "on_site",    fields: {} },
    { status: "repairing",  fields: {} },
    { status: "testing",    fields: {} },
    {
      status: "completed",
      fields: {
        resolution_notes:
          "Spindle bearing reseated and lubricated; ran under load with no further vibration.",
      },
    },
    { status: "closed", fields: { verified_by: requester.id } },
  ];

  for (const step of steps) {
    const { error } = await db
      .from("work_orders")
      .update({ status: step.status, ...step.fields })
      .eq("id", woId);
    if (error) throw new Error(`transition -> ${step.status}: ${error.message}`);
  }

  // The triggers wrote history and notifications with now() timestamps. Replace
  // the work order's own clock and rewrite history to the reported times.
  const { error: woTimeError } = await db
    .from("work_orders")
    .update({
      created_at: t("08:15"),
      updated_at: t("09:16"),
      sla_ack_due_at: t("08:30"),        // P2 ack target: 15 min after 08:15
      sla_resolution_due_at: t("16:15"), // P2 resolution target: 8 hrs after 08:15
      sla_breached: false,               // closed at 09:16, well inside the 8hr SLA
      sla_warning_sent: false,
      resolved_at: t("09:10"),
      verified_at: t("09:15"),
      closed_at: t("09:16"),
    })
    .eq("id", woId);
  if (woTimeError) throw new Error(`backdate work order: ${woTimeError.message}`);

  await db.from("work_order_history").delete().eq("work_order_id", woId);

  const events = [
    { to_status: "open",       actor: requester,  role: "requester",  time: "08:15", remarks: "Work order raised" },
    { to_status: "assigned",   actor: supervisor, role: "supervisor", time: "08:17", remarks: "Assigned to " + technician.name },
    { to_status: "accepted",   actor: technician, role: "technician", time: "08:24", remarks: "Accepted by technician" },
    // Folded in — no separate travel timestamp was reported.
    { to_status: "on_the_way", actor: technician, role: "technician", time: "08:24", remarks: "Technician en route" },
    { to_status: "on_site",    actor: technician, role: "technician", time: "08:33", remarks: "Arrived on site" },
    // Folded in — no separate diagnosis-start timestamp was reported.
    { to_status: "repairing",  actor: technician, role: "technician", time: "08:33", remarks: "Started repair" },
    // Folded in one minute before completion, so it stays a distinct ordered
    // event rather than colliding with "completed" at the same minute.
    { to_status: "testing",    actor: technician, role: "technician", time: "09:09", remarks: "Repair complete — testing" },
    { to_status: "completed",  actor: technician, role: "technician", time: "09:10", remarks: "Test passed — awaiting requester verification" },
    { to_status: "verified",   actor: requester,  role: "requester",  time: "09:15", remarks: "Confirmed fixed by requester" },
    { to_status: "closed",     actor: requester,  role: "requester",  time: "09:16", remarks: null },
  ];

  let prevStatus = null;
  const rows = events.map((e) => {
    const row = {
      work_order_id: woId,
      from_status: prevStatus,
      to_status: e.to_status,
      actor_id: e.actor.id,
      actor_name: e.actor.name,
      actor_role: e.role,
      remarks: e.remarks,
      created_at: t(e.time),
    };
    prevStatus = e.to_status;
    return row;
  });

  const { error: historyError } = await db.from("work_order_history").insert(rows);
  if (historyError) throw new Error(`insert history: ${historyError.message}`);

  // One comment, matching a plausible mid-repair update — demonstrates the
  // Comments tab against this same demo work order.
  const { error: commentError } = await db.from("comments").insert({
    entity_type: "work_order",
    entity_id: woId,
    author_id: technician.id,
    author_name: technician.name,
    author_role: "technician",
    text:
      "Diagnosed worn spindle bearing causing vibration; no spare part needed, reseating in place.",
    created_at: t("08:50"),
    edited_at: null,
  });
  if (commentError) throw new Error(`insert comment: ${commentError.message}`);

  // The walk above generated real notifications at real times; drop them so the
  // demo does not leave eight unread bells from a 2026-07-23 job.
  await db.from("notifications").delete().eq("entity_id", woId);

  const { error: statsError } = await db.rpc("si_compute_dashboard_stats");
  if (statsError) console.warn(`  ! dashboard stats refresh: ${statsError.message}`);

  console.log(
    `Seeded demo work order ${woId} (${inserted.wo_number}) — Open 08:15 through Closed 09:16.`
  );
}

seed().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
