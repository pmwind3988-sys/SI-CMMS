#!/usr/bin/env node
/**
 * SI — Service Inside · Build the Firestore database from the codebase
 * ============================================================================
 * Seeds every reference collection from schema/schema.js, which was itself
 * derived from src/lib/constants.js, firestore.rules and functions/index.js.
 *
 * This is what closes README open items #3 and #4: /departments, /assets,
 * /technicians, /priorities and /sla stop being frozen arrays in a JS module
 * and become real collections the APK can read with onSnapshot.
 *
 * Every write is idempotent (set with merge on a stable document ID), so
 * running this twice changes nothing the second time. It never touches
 * work_orders, work_order_history, notifications, comments, attachments or
 * counters — those are transactional, user-generated or server-owned.
 *
 * EMULATOR (default, no credentials, no cost):
 *   npm run emulators                     # in one terminal
 *   npm run seed:db                       # in another
 *
 * LIVE PROJECT:
 *   set GOOGLE_APPLICATION_CREDENTIALS=.\serviceAccountKey.json
 *   set SI_TARGET=live
 *   set GOOGLE_CLOUD_PROJECT=<your-project-id>
 *   npm run seed:db
 *
 * Flags:
 *   --dry-run    print what would be written, write nothing
 *   --only=a,b   seed only these collections
 * ============================================================================
 */
const { connect, targetLabel } = require("./_firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const {
  PLANTS,
  DEPARTMENTS,
  ASSETS,
  TECHNICIANS,
  PRIORITY_META,
  SLA_TARGETS,
  PRIORITY_CODES,
  PLANT_ID,
} = require("../schema/schema");
const { validateDoc } = require("../schema/validate");

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const onlyArg = argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length).split(",").map((s) => s.trim()) : null;

const wanted = (name) => !ONLY || ONLY.includes(name);

/** Collected across the run so one bad row fails the whole seed loudly. */
const problems = [];

function stage(collection, id, data) {
  const { ok, errors, warnings } = validateDoc(collection, data);
  warnings.forEach((w) => console.warn(`  ! ${collection}/${id}: ${w}`));
  if (!ok) errors.forEach((e) => problems.push(`${collection}/${id}: ${e}`));
  return { collection, id, data, ok };
}

async function main() {
  const { db, auth } = connect();
  const now = FieldValue.serverTimestamp();
  const writes = [];

  /* ---- plants ---------------------------------------------------------- */
  if (wanted("plants")) {
    for (const p of PLANTS) {
      const { id, ...rest } = p;
      writes.push(stage("plants", id, { ...rest, created_at: now }));
    }
  }

  /* ---- departments ----------------------------------------------------- */
  if (wanted("departments")) {
    for (const d of DEPARTMENTS) {
      const { id, ...rest } = d;
      writes.push(
        stage("departments", id, {
          ...rest,
          plant_id: PLANT_ID,
          manager_id: null,
          created_at: now,
          updated_at: now,
        })
      );
    }
  }

  /* ---- assets ---------------------------------------------------------- */
  if (wanted("assets")) {
    const deptIds = new Set(DEPARTMENTS.map((d) => d.id));
    for (const a of ASSETS) {
      const { id, ...rest } = a;
      // Referential integrity is not something Firestore will check for us.
      if (!deptIds.has(a.department_id)) {
        problems.push(`assets/${id}: department_id "${a.department_id}" has no matching /departments document.`);
      }
      writes.push(
        stage("assets", id, {
          ...rest,
          asset_code: id,
          plant_id: PLANT_ID,
          status: "active",
          manufacturer: null,
          model: null,
          serial_number: null,
          install_date: null,
          warranty_expiry: null,
          meter_reading: null,
          meter_unit: null,
          qr_code: null,
          photo_url: null,
          created_at: now,
          updated_at: now,
        })
      );
    }
  }

  /* ---- priorities ------------------------------------------------------ */
  if (wanted("priorities")) {
    for (const code of PRIORITY_CODES) {
      writes.push(
        stage("priorities", code, {
          code,
          ...PRIORITY_META[code],
          created_at: now,
          updated_at: now,
        })
      );
    }
  }

  /* ---- sla ------------------------------------------------------------- */
  if (wanted("sla")) {
    for (const code of PRIORITY_CODES) {
      const t = SLA_TARGETS[code];
      writes.push(
        stage("sla", code, {
          priority_id: code,
          plant_id: null, // null = global default; {plant}_{code} docs override
          ack_target_minutes: t.ack_target_minutes,
          resolution_target_minutes: t.resolution_target_minutes,
          resolution_target_label: t.resolution_target_label,
          created_at: now,
          updated_at: now,
        })
      );
    }
  }

  /* ---- technicians ----------------------------------------------------- *
   * Doc ID must be the Auth UID (architecture §3.6). Resolve it by email
   * where the user actually exists; fall back to the constants.js slug so a
   * bare emulator still seeds. See DIVERGENCES.technician_doc_id.           */
  if (wanted("technicians")) {
    for (const t of TECHNICIANS) {
      let docId = t.id;
      let resolved = false;
      try {
        const rec = await auth.getUserByEmail(t.auth_email);
        docId = rec.uid;
        resolved = true;
      } catch {
        // No Auth user yet — run bootstrap:users first if you want real UIDs.
      }
      if (!resolved) {
        console.warn(`  ! technicians/${t.id}: no Auth user for ${t.auth_email}; using the placeholder slug as the doc ID. Run "npm run bootstrap:users" first for real UIDs.`);
      }
      writes.push(
        stage("technicians", docId, {
          user_id: docId,
          name: t.name,
          skills: t.skills,
          certifications: [],
          current_load: t.current_load,
          availability_status: "available",
          plant_ids: [PLANT_ID],
          created_at: now,
          updated_at: now,
        })
      );
    }
  }

  /* ---- report and commit ----------------------------------------------- */
  if (problems.length) {
    console.error(`\nRefusing to seed — ${problems.length} schema problem(s):`);
    problems.forEach((p) => console.error(`  ✗ ${p}`));
    process.exit(1);
  }

  const byCollection = writes.reduce((acc, w) => {
    (acc[w.collection] = acc[w.collection] || []).push(w.id);
    return acc;
  }, {});

  console.log(`\nTarget: ${targetLabel()}`);
  for (const [c, ids] of Object.entries(byCollection)) {
    console.log(`  ${c.padEnd(14)} ${String(ids.length).padStart(3)} doc(s)  ${ids.join(", ")}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  // Batched: 500 is the Firestore write limit per batch; we are far under it,
  // but chunking keeps this correct if the reference data grows.
  const CHUNK = 400;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + CHUNK)) {
      batch.set(db.collection(w.collection).doc(w.id), w.data, { merge: true });
    }
    await batch.commit();
  }

  console.log(`\nSeeded ${writes.length} document(s) across ${Object.keys(byCollection).length} collection(s).`);
  console.log("Idempotent — safe to re-run. work_orders, history, notifications and counters were not touched.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
