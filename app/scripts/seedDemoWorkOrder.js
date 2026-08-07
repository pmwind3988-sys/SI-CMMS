/**
 * SI — Service Inside · Work Order Module
 *
 * Seeds ONE demo work order reproducing this exact reported timeline,
 * against the current snake_case schema (work_orders + top-level
 * work_order_history — not a subcollection):
 *
 *   08:15  Requester submitted work order.
 *   08:17  Supervisor assigned Technician A.
 *   08:24  Technician accepted.
 *   08:33  Technician arrived.
 *   09:10  Repair completed.
 *   09:15  Requester verified.
 *   09:16  Work order closed.
 *
 * Our status flow has intermediate states this narrative doesn't call out
 * on its own (on_the_way, repairing-start, testing) — folded into the
 * nearest adjacent timestamp rather than inventing precision the report
 * never gave; see the inline comments on each history entry below.
 *
 * Target selection goes through scripts/_firebaseAdmin.js like every other
 * script here: the EMULATOR unless SI_TARGET=live.
 *
 * Emulator (default):
 *   npm run seed:demo
 *
 * Live:
 *   $env:SI_TARGET="live"
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"
 *   npm run seed:demo
 */
const { Timestamp } = require("firebase-admin/firestore");
const { connect, targetLabel } = require("./_firebaseAdmin");

const { db } = connect();

const DEMO_DATE = "2026-07-23";
const t = (hhmm) => Timestamp.fromDate(new Date(`${DEMO_DATE}T${hhmm}:00`));

const DEPARTMENT_ID = "DEPT-MACHINING";
const REQUESTER = { id: "demo-requester", name: "Ravi Kumar" };
const SUPERVISOR = { id: "demo-supervisor", name: "Priya Nair" };
const TECHNICIAN = { id: "tech-arun", name: "Technician A" }; // matches AssignPanel's TECHNICIANS roster

async function seed() {
  console.log(`Target: ${targetLabel()}\n`);
  const woRef = db.collection("work_orders").doc();
  const workOrderId = woRef.id;

  await woRef.set({
    wo_number: "WO-2026-000001",
    department_id: DEPARTMENT_ID,
    asset_id: "AST-0412",
    asset_name: "CNC Lathe #04",
    type: "breakdown",
    priority: "P2",
    status: "closed",
    impact: "reduced_capacity",
    est_downtime_value: 1,
    est_downtime_unit: "hours",
    description: "Reported at 08:15 — demo trace of a clean, on-time repair from submission to closure.",
    safety_risk: { flag: false, severity: null },
    environmental_risk: { flag: false },
    permit_required: false,
    requester_id: REQUESTER.id,
    requester_name: REQUESTER.name,
    requester_phone: "98450 11223",
    assigned_to_id: TECHNICIAN.id,
    assigned_to_name: TECHNICIAN.name,
    created_at: t("08:15"),
    updated_at: t("09:16"),
    sla_ack_due_at: t("08:30"), // P2 ack target: 15 min after 08:15
    sla_resolution_due_at: t("16:15"), // P2 resolution target: 8 hrs after 08:15
    sla_breached: false, // closed at 09:16 — well inside the 8hr SLA
    decline_count: 0,
    resolution_notes: "Spindle bearing reseated and lubricated; ran under load with no further vibration.",
    resolved_at: t("09:10"),
    verified_by: REQUESTER.id,
    verified_at: t("09:15"),
    closed_at: t("09:16"),
    client_uuid: "demo-seed-1",
  });

  const events = [
    { to_status: "open", actor: REQUESTER, role: "requester", time: "08:15", remarks: "Work order raised" },
    { to_status: "assigned", actor: SUPERVISOR, role: "supervisor", time: "08:17", remarks: "Assigned to Technician A" },
    { to_status: "accepted", actor: TECHNICIAN, role: "technician", time: "08:24", remarks: "Accepted by technician" },
    // Folded in — no separate travel timestamp was reported.
    { to_status: "on_the_way", actor: TECHNICIAN, role: "technician", time: "08:24", remarks: "Technician en route" },
    { to_status: "on_site", actor: TECHNICIAN, role: "technician", time: "08:33", remarks: "Arrived on site" },
    // Folded in — no separate diagnosis-start timestamp was reported.
    { to_status: "repairing", actor: TECHNICIAN, role: "technician", time: "08:33", remarks: "Started repair" },
    // Folded in, one minute before completion, so it stays a distinct
    // ordered event rather than colliding with "completed" at the same minute.
    { to_status: "testing", actor: TECHNICIAN, role: "technician", time: "09:09", remarks: "Repair complete — testing" },
    { to_status: "completed", actor: TECHNICIAN, role: "technician", time: "09:10", remarks: "Test passed — awaiting requester verification" },
    { to_status: "verified", actor: REQUESTER, role: "requester", time: "09:15", remarks: "Confirmed fixed by requester" },
    { to_status: "closed", actor: REQUESTER, role: "requester", time: "09:16", remarks: null },
  ];

  let prevStatus = null;
  for (const e of events) {
    await db.collection("work_order_history").add({
      work_order_id: workOrderId,
      from_status: prevStatus,
      to_status: e.to_status,
      actor_id: e.actor.id,
      actor_name: e.actor.name,
      actor_role: e.role,
      remarks: e.remarks,
      created_at: t(e.time),
    });
    prevStatus = e.to_status;
  }

  // One comment, matching a plausible mid-repair update — demonstrates the
  // Comments tab against this same demo work order.
  await db.collection("comments").add({
    entity_type: "work_order",
    entity_id: workOrderId,
    author_id: TECHNICIAN.id,
    author_name: TECHNICIAN.name,
    author_role: "technician",
    text: "Diagnosed worn spindle bearing causing vibration; no spare part needed, reseating in place.",
    created_at: t("08:50"),
    edited_at: null,
  });

  console.log(`Seeded demo work order ${workOrderId} (WO-2026-000001) — Open 08:15 through Closed 09:16.`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
