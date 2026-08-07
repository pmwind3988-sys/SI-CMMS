/**
 * SI — Service Inside · Cloud Functions
 *
 * Backs the Authentication, Work Order, and Dashboard modules against the
 * approved enterprise schema: snake_case fields, top-level work_order_history
 * (not a subcollection), top-level comments/attachments (entity_type +
 * entity_id, polymorphic), and the 5-role model (requester, technician,
 * supervisor, manager, admin — department_id-scoped for supervisor).
 *
 * These functions are the only writers of /counters, /notifications, the
 * SLA timestamp fields on /work_orders, and /stats — the security rules
 * deliberately block clients from writing those directly (see firestore.rules).
 */
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

/* ============================================================================
   SHARED CONSTANTS — mirror src/lib/constants.js. Kept in sync manually;
   in a larger system this would live in a shared package imported by both.
============================================================================ */
const SLA_RESOLUTION_MS = { P1: 4 * 3600e3, P2: 8 * 3600e3, P3: 24 * 3600e3, P4: 5 * 24 * 3600e3 };
const SLA_ACK_MS = { P1: 5 * 60e3, P2: 15 * 60e3, P3: 30 * 60e3, P4: 2 * 3600e3 };
const ALLOWED_ROLES = ["requester", "technician", "supervisor", "manager", "admin"];

async function notify({ recipientId, recipientRole, entityType, entityId, entityLabel, type, title, body }) {
  await db.collection("notifications").add({
    recipient_id: recipientId,
    recipient_role: recipientRole || null,
    entity_type: entityType,
    entity_id: entityId,
    entity_label: entityLabel,
    type,
    title,
    body,
    status: "sent",
    created_at: FieldValue.serverTimestamp(),
  });
}

/** Supervisors scoped to a specific department — the primary triage owners
    who get notified about that department's work orders. Manager/Admin see
    everything via the Dashboard module instead of a per-work-order notice,
    so they are deliberately not included here. */
async function getDepartmentSupervisors(departmentId) {
  const snap = await db.collection("users").where("role", "==", "supervisor").where("department_id", "==", departmentId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Every Manager, system-wide — used only for the escalation cases where a
    Manager genuinely needs to know (P1 SLA warning/breach), not for every
    routine work order. Deliberately not department-scoped, unlike Supervisor. */
async function getManagers() {
  const snap = await db.collection("users").where("role", "==", "manager").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ============================================================================
   WORK ORDER MODULE
============================================================================ */

/**
 * onWorkOrderCreate
 * Assigns the human-readable wo_number via a transactional counter
 * (format: WO-{year}-{6-digit sequence}, one global sequence per year —
 * not per department/plant), computes SLA due timestamps, writes the
 * initial work_order_history entry, and notifies the department's
 * Supervisors.
 */
exports.onWorkOrderCreate = onDocumentCreated("work_orders/{workOrderId}", async (event) => {
  const snap = event.data;
  const wo = snap.data();
  const workOrderId = event.params.workOrderId;
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc(`WO-${year}`);

  const woNumber = await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const next = (counterSnap.exists ? counterSnap.data().last_value : 0) + 1;
    tx.set(counterRef, { last_value: next }, { merge: true });
    return `WO-${year}-${String(next).padStart(6, "0")}`;
  });

  const now = Date.now();
  const priority = wo.priority || "P3";
  const slaAckDueAt = Timestamp.fromMillis(now + (SLA_ACK_MS[priority] || SLA_ACK_MS.P3));
  const slaResolutionDueAt = Timestamp.fromMillis(now + (SLA_RESOLUTION_MS[priority] || SLA_RESOLUTION_MS.P3));

  await snap.ref.update({
    wo_number: woNumber,
    sla_ack_due_at: slaAckDueAt,
    sla_resolution_due_at: slaResolutionDueAt,
    sla_breached: false,
    sla_warning_sent: false,
    decline_count: 0,
    updated_at: FieldValue.serverTimestamp(),
  });

  await db.collection("work_order_history").add({
    work_order_id: workOrderId,
    from_status: null,
    to_status: "open",
    actor_id: wo.requester_id,
    actor_name: wo.requester_name,
    actor_role: "requester",
    remarks: "Work order raised",
    created_at: FieldValue.serverTimestamp(),
  });

  // Confirmation to the Requester — "New Work Order" is one of the two
  // triggers that notifies both sides of the same event: the Supervisor
  // needs to act on it, the Requester just needs to know it was received.
  await notify({
    recipientId: wo.requester_id,
    recipientRole: "requester",
    entityType: "work_order",
    entityId: workOrderId,
    entityLabel: woNumber,
    type: "submitted",
    title: "Work order submitted",
    body: `${woNumber} — ${wo.asset_name || "equipment"} has been received and will be triaged shortly.`,
  });

  const supervisors = await getDepartmentSupervisors(wo.department_id);
  await Promise.all(
    supervisors.map((s) =>
      notify({
        recipientId: s.id,
        recipientRole: "supervisor",
        entityType: "work_order",
        entityId: workOrderId,
        entityLabel: woNumber,
        type: "needs_assignment",
        title: "New work order needs a technician",
        body: `${woNumber} — ${wo.asset_name || "equipment"} (${priority})`,
      })
    )
  );

  logger.info(`Work order ${workOrderId} created as ${woNumber}`);
});

/**
 * onWorkOrderUpdated
 * Fans out to every notification type keyed off the status transition,
 * plus closed_at stamping. Every check below reads the NEW 11-state
 * snake_case flow: open -> assigned -> accepted -> on_the_way -> on_site
 * -> repairing -> [waiting_spare_part <-> repairing] -> testing ->
 * [testing -> repairing on fail] -> completed -> closed, with
 * completed -> repairing as the one reopen loop.
 */
exports.onWorkOrderUpdated = onDocumentUpdated("work_orders/{workOrderId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  const workOrderId = event.params.workOrderId;
  if (before.status === after.status) return; // only react to status transitions

  if (after.status === "assigned" && after.assigned_to_id) {
    await notify({
      recipientId: after.assigned_to_id,
      recipientRole: "technician",
      entityType: "work_order",
      entityId: workOrderId,
      entityLabel: after.wo_number,
      type: "assigned",
      title: "You've been assigned a work order",
      body: `${after.wo_number} — ${after.asset_name}`,
    });
  }

  if (before.status === "assigned" && after.status === "open") {
    await event.data.after.ref.update({ decline_count: FieldValue.increment(1) });
    const supervisors = await getDepartmentSupervisors(after.department_id);
    await Promise.all(
      supervisors.map((s) =>
        notify({
          recipientId: s.id,
          recipientRole: "supervisor",
          entityType: "work_order",
          entityId: workOrderId,
          entityLabel: after.wo_number,
          type: "declined",
          title: "Technician declined — needs reassignment",
          body: `${after.wo_number} — ${after.asset_name}`,
        })
      )
    );
  }

  if (after.status === "completed") {
    await event.data.after.ref.update({ resolved_at: FieldValue.serverTimestamp() });
    await notify({
      recipientId: after.requester_id,
      recipientRole: "requester",
      entityType: "work_order",
      entityId: workOrderId,
      entityLabel: after.wo_number,
      type: "completed",
      title: "Your work order was completed — please verify",
      body: `${after.wo_number} — ${after.asset_name}`,
    });
  }

  if (before.status === "assigned" && after.status === "accepted") {
    await notify({
      recipientId: after.requester_id,
      recipientRole: "requester",
      entityType: "work_order",
      entityId: workOrderId,
      entityLabel: after.wo_number,
      type: "status_change",
      title: "Technician accepted your work order",
      body: `${after.assigned_to_name || "A technician"} has accepted ${after.wo_number} and will be on their way shortly.`,
    });
  }

  if (before.status === "on_the_way" && after.status === "on_site") {
    await notify({
      recipientId: after.requester_id,
      recipientRole: "requester",
      entityType: "work_order",
      entityId: workOrderId,
      entityLabel: after.wo_number,
      type: "status_change",
      title: "Technician has arrived",
      body: `${after.assigned_to_name || "A technician"} is now on site for ${after.wo_number}.`,
    });
  }

  if (before.status === "completed" && after.status === "repairing" && after.assigned_to_id) {
    await notify({
      recipientId: after.assigned_to_id,
      recipientRole: "technician",
      entityType: "work_order",
      entityId: workOrderId,
      entityLabel: after.wo_number,
      type: "reopened",
      title: "Work order reopened by requester",
      body: `${after.wo_number} — ${after.asset_name}`,
    });
    // Reopening is operationally significant enough that the department's
    // Supervisor should know too, not just the technician doing the work —
    // unlike Decline, this isn't asking them to act, just to be aware.
    const supervisors = await getDepartmentSupervisors(after.department_id);
    await Promise.all(
      supervisors.map((s) =>
        notify({
          recipientId: s.id,
          recipientRole: "supervisor",
          entityType: "work_order",
          entityId: workOrderId,
          entityLabel: after.wo_number,
          type: "reopened",
          title: "Work order reopened by requester",
          body: `${after.wo_number} — ${after.asset_name} was not fixed and has been reopened.`,
        })
      )
    );
  }

  if (after.status === "closed") {
    const breached = after.sla_resolution_due_at && after.sla_resolution_due_at.toMillis() < Date.now();
    await event.data.after.ref.update({
      closed_at: FieldValue.serverTimestamp(),
      sla_breached: !!breached,
    });
  }
});

/**
 * slaBreachSweep
 * Runs every 5 minutes. Flags newly-breached work orders and notifies
 * that work order's department Supervisors once per breach (not on every
 * sweep for an already-flagged one).
 */
exports.slaBreachSweep = onSchedule("every 5 minutes", async () => {
  const now = Timestamp.now();
  // Single inequality filter (sla_resolution_due_at) — status filtered in
  // code below, since Firestore can't cleanly combine two range filters
  // on different fields without a much wider composite index.
  const snap = await db.collection("work_orders").where("sla_breached", "==", false).where("sla_resolution_due_at", "<", now).get();

  const overdue = snap.docs.filter((d) => d.data().status !== "closed");
  if (overdue.length === 0) return;

  const batch = db.batch();
  const notifications = [];
  for (const docSnap of overdue) {
    const wo = docSnap.data();
    batch.update(docSnap.ref, { sla_breached: true });
    notifications.push(
      getDepartmentSupervisors(wo.department_id).then((supervisors) =>
        Promise.all(
          supervisors.map((s) =>
            notify({
              recipientId: s.id,
              recipientRole: "supervisor",
              entityType: "work_order",
              entityId: docSnap.id,
              entityLabel: wo.wo_number,
              type: "sla_breach",
              title: "SLA breached",
              body: `${wo.wo_number} — ${wo.asset_name} has passed its resolution SLA`,
            })
          )
        )
      )
    );
    // P1 breaches are escalated to every Manager, system-wide — this is the
    // one case severe enough to warrant that, not every routine breach.
    if (wo.priority === "P1") {
      notifications.push(
        getManagers().then((managers) =>
          Promise.all(
            managers.map((m) =>
              notify({
                recipientId: m.id,
                recipientRole: "manager",
                entityType: "work_order",
                entityId: docSnap.id,
                entityLabel: wo.wo_number,
                type: "sla_breach",
                title: "P1 SLA breached",
                body: `${wo.wo_number} — ${wo.asset_name} is critical and has passed its resolution SLA`,
              })
            )
          )
        )
      );
    }
  }
  await batch.commit();
  await Promise.all(notifications);
  logger.info(`slaBreachSweep flagged ${overdue.length} work order(s)`);
});

/**
 * slaWarningSweep
 * Runs every 5 minutes, offset in purpose from slaBreachSweep: this fires
 * BEFORE the deadline, once per work order (guarded by sla_warning_sent),
 * when less than 25% of the total resolution window remains. Notifies the
 * assigned Technician and the department's Supervisors always; escalates
 * to every Manager only for P1, matching the same escalation threshold
 * used for breaches.
 */
exports.slaWarningSweep = onSchedule("every 5 minutes", async () => {
  const snap = await db.collection("work_orders").where("sla_warning_sent", "==", false).get();
  const now = Date.now();

  const dueForWarning = snap.docs.filter((d) => {
    const wo = d.data();
    if (wo.status === "closed" || wo.sla_breached) return false;
    const createdMs = wo.created_at?.toMillis ? wo.created_at.toMillis() : null;
    const dueMs = wo.sla_resolution_due_at?.toMillis ? wo.sla_resolution_due_at.toMillis() : null;
    if (!createdMs || !dueMs) return false;
    const totalWindow = dueMs - createdMs;
    const remaining = dueMs - now;
    return remaining > 0 && remaining <= totalWindow * 0.25;
  });
  if (dueForWarning.length === 0) return;

  const batch = db.batch();
  const notifications = [];
  for (const docSnap of dueForWarning) {
    const wo = docSnap.data();
    batch.update(docSnap.ref, { sla_warning_sent: true });

    if (wo.assigned_to_id) {
      notifications.push(
        notify({
          recipientId: wo.assigned_to_id,
          recipientRole: "technician",
          entityType: "work_order",
          entityId: docSnap.id,
          entityLabel: wo.wo_number,
          type: "sla_warning",
          title: "SLA deadline approaching",
          body: `${wo.wo_number} — ${wo.asset_name} is close to breaching its resolution SLA`,
        })
      );
    }
    notifications.push(
      getDepartmentSupervisors(wo.department_id).then((supervisors) =>
        Promise.all(
          supervisors.map((s) =>
            notify({
              recipientId: s.id,
              recipientRole: "supervisor",
              entityType: "work_order",
              entityId: docSnap.id,
              entityLabel: wo.wo_number,
              type: "sla_warning",
              title: "SLA deadline approaching",
              body: `${wo.wo_number} — ${wo.asset_name} is close to breaching its resolution SLA`,
            })
          )
        )
      )
    );
    if (wo.priority === "P1") {
      notifications.push(
        getManagers().then((managers) =>
          Promise.all(
            managers.map((m) =>
              notify({
                recipientId: m.id,
                recipientRole: "manager",
                entityType: "work_order",
                entityId: docSnap.id,
                entityLabel: wo.wo_number,
                type: "sla_warning",
                title: "P1 SLA deadline approaching",
                body: `${wo.wo_number} — ${wo.asset_name} is critical and close to breaching its resolution SLA`,
              })
            )
          )
        )
      );
    }
  }
  await batch.commit();
  await Promise.all(notifications);
  logger.info(`slaWarningSweep flagged ${dueForWarning.length} work order(s)`);
});

/* ============================================================================
   AUTHENTICATION MODULE — role provisioning
============================================================================ */

/**
 * setUserRoleClaims (callable)
 * Sets the custom claims (role, department_id, plant_ids) the security
 * rules and every module's client code depend on. Caller must already be
 * a Supervisor, Manager, or Admin — Supervisors may only provision within
 * their own department; Manager/Admin may provision anywhere.
 */
exports.setUserRoleClaims = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const callerRole = request.auth.token.role;
  const callerDeptId = request.auth.token.department_id;
  if (!["supervisor", "manager", "admin"].includes(callerRole)) {
    throw new HttpsError("permission-denied", "Only a Supervisor, Manager, or Admin can set roles.");
  }

  const { uid, role, departmentId, plantIds } = request.data || {};
  if (!uid || !role || !Array.isArray(plantIds)) {
    throw new HttpsError("invalid-argument", "uid, role, and plantIds[] are required.");
  }
  if (!ALLOWED_ROLES.includes(role)) {
    throw new HttpsError("invalid-argument", `role must be one of ${ALLOWED_ROLES.join(", ")}`);
  }
  if (callerRole === "supervisor" && departmentId !== callerDeptId) {
    throw new HttpsError("permission-denied", "A Supervisor may only provision users within their own department.");
  }

  await getAuth().setCustomUserClaims(uid, { role, department_id: departmentId || null, plant_ids: plantIds });
  await db.collection("users").doc(uid).set({ role, department_id: departmentId || null, plant_ids: plantIds }, { merge: true });
  return { ok: true };
});

/* ============================================================================
   DASHBOARD MODULE — precomputed stats
   ============================================================================
   See the Dashboard module's own documentation (README Section 6) for the
   full rationale: cards and charts read two small precomputed documents
   instead of scanning work_orders live on every page load.
============================================================================ */
const OPEN_STATUSES = ["open", "assigned", "accepted", "on_the_way", "on_site", "repairing", "waiting_spare_part", "testing"];
const TERMINAL_STATUSES = ["completed", "verified", "closed"];

function startOfTodayMillis() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

async function computeDashboardStats() {
  // At meaningful scale this full-collection read should be replaced with
  // incrementally maintained counters or a BigQuery export — flagged, not
  // solved preemptively, per current volume not needing it yet.
  const snap = await db.collection("work_orders").get();
  const workOrders = snap.docs.map((d) => d.data());
  const workOrderCreatedAtById = {};
  snap.docs.forEach((d) => {
    const createdMs = d.data().created_at?.toMillis ? d.data().created_at.toMillis() : null;
    if (createdMs) workOrderCreatedAtById[d.id] = createdMs;
  });

  const acceptedSnap = await db.collection("work_order_history").where("to_status", "==", "accepted").get();
  let responseMinutesTotal = 0;
  let responseSamples = 0;
  acceptedSnap.docs.forEach((d) => {
    const h = d.data();
    const createdMs = workOrderCreatedAtById[h.work_order_id];
    const acceptedMs = h.created_at?.toMillis ? h.created_at.toMillis() : null;
    if (createdMs && acceptedMs && acceptedMs >= createdMs) {
      responseMinutesTotal += (acceptedMs - createdMs) / 60000;
      responseSamples++;
    }
  });

  const now = Date.now();
  const todayStart = startOfTodayMillis();

  const cards = {
    total_open: 0,
    p1_critical: 0,
    p2_high: 0,
    p3_medium: 0,
    p4_low: 0,
    completed_today: 0,
    overdue: 0,
    avg_response_minutes: 0,
    avg_repair_minutes: 0,
    active_technicians: 0,
    updated_at: FieldValue.serverTimestamp(),
  };

  const monthlyMap = {};
  const deptMap = {};
  const assetMap = {};
  const techMap = {};
  let repairMinutesTotal = 0;
  let repairSamples = 0;
  const activeTechnicianIds = new Set();

  for (const wo of workOrders) {
    const createdMs = wo.created_at?.toMillis ? wo.created_at.toMillis() : null;
    const isOpen = OPEN_STATUSES.includes(wo.status);
    const isTerminal = TERMINAL_STATUSES.includes(wo.status);

    if (isOpen) {
      cards.total_open++;
      if (wo.priority === "P1") cards.p1_critical++;
      if (wo.priority === "P2") cards.p2_high++;
      if (wo.priority === "P3") cards.p3_medium++;
      if (wo.priority === "P4") cards.p4_low++;
      if (wo.sla_breached) cards.overdue++;
      if (wo.assigned_to_id) activeTechnicianIds.add(wo.assigned_to_id);
    }

    const closedMs = wo.closed_at?.toMillis ? wo.closed_at.toMillis() : null;
    if (closedMs && closedMs >= todayStart) cards.completed_today++;
    if (createdMs && closedMs && isTerminal) {
      repairMinutesTotal += (closedMs - createdMs) / 60000;
      repairSamples++;
    }

    if (createdMs) {
      const d = new Date(createdMs);
      const key = monthKey(d);
      if (!monthlyMap[key]) monthlyMap[key] = { key, label: monthLabel(d), count: 0 };
      monthlyMap[key].count++;
    }
    if (wo.department_id) {
      if (!deptMap[wo.department_id]) deptMap[wo.department_id] = { id: wo.department_id, count: 0 };
      deptMap[wo.department_id].count++;
    }
    if (wo.asset_id) {
      if (!assetMap[wo.asset_id]) assetMap[wo.asset_id] = { id: wo.asset_id, name: wo.asset_name || wo.asset_id, count: 0 };
      assetMap[wo.asset_id].count++;
    }
    if (wo.assigned_to_id) {
      if (!techMap[wo.assigned_to_id]) {
        techMap[wo.assigned_to_id] = { id: wo.assigned_to_id, name: wo.assigned_to_name || wo.assigned_to_id, completed: 0, repairMinutesTotal: 0, repairSamples: 0 };
      }
      if (isTerminal) {
        techMap[wo.assigned_to_id].completed++;
        if (createdMs && closedMs) {
          techMap[wo.assigned_to_id].repairMinutesTotal += (closedMs - createdMs) / 60000;
          techMap[wo.assigned_to_id].repairSamples++;
        }
      }
    }
  }

  cards.avg_repair_minutes = repairSamples ? Math.round(repairMinutesTotal / repairSamples) : 0;
  cards.avg_response_minutes = responseSamples ? Math.round(responseMinutesTotal / responseSamples) : 0;
  cards.active_technicians = activeTechnicianIds.size;

  const deptIds = Object.keys(deptMap);
  const deptNames = {};
  await Promise.all(
    deptIds.map(async (id) => {
      const d = await db.collection("departments").doc(id).get();
      deptNames[id] = d.exists ? d.data().name : id;
    })
  );

  const charts = {
    monthly_work_orders: Object.values(monthlyMap)
      .sort((a, b) => (a.key > b.key ? 1 : -1))
      .slice(-12)
      .map((m) => ({ month: m.label, count: m.count })),
    department_breakdown: Object.values(deptMap)
      .map((d) => ({ department: deptNames[d.id] || d.id, count: d.count }))
      .sort((a, b) => b.count - a.count),
    machine_breakdown: Object.values(assetMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((a) => ({ asset: a.name, count: a.count })),
    technician_performance: Object.values(techMap)
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 10)
      .map((t) => ({
        technician: t.name,
        completed: t.completed,
        avg_repair_minutes: t.repairSamples ? Math.round(t.repairMinutesTotal / t.repairSamples) : 0,
      })),
    updated_at: FieldValue.serverTimestamp(),
  };

  await db.collection("stats").doc("dashboard_cards").set(cards);
  await db.collection("stats").doc("dashboard_charts").set(charts);
}

exports.recomputeDashboardStats = onSchedule("every 15 minutes", async () => {
  await computeDashboardStats();
  logger.info("Dashboard stats recomputed (scheduled).");
});

exports.refreshDashboardStats = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = request.auth.token.role;
  if (role !== "manager" && role !== "admin") {
    throw new HttpsError("permission-denied", "Only a Manager or Admin can refresh dashboard stats on demand.");
  }
  await computeDashboardStats();
  return { ok: true };
});
