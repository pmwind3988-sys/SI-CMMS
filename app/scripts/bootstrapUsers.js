/**
 * SI — Service Inside · Authentication Module
 *
 * One-time bootstrap: creates initial Firebase Auth users and sets their
 * custom claims (role, department_id, plant_ids) plus a matching
 * /users/{uid} profile document. Run this once, directly with the Admin
 * SDK, before anyone can sign in — there is no in-app "create the first
 * Administrator" flow by design (that would be a privilege-escalation hole).
 *
 * Roles now match the approved 5-role model: requester, technician,
 * supervisor, manager (Maintenance Manager), admin (Administrator).
 *
 * Target selection goes through scripts/_firebaseAdmin.js like every other
 * script here: the EMULATOR unless SI_TARGET=live. That connector also refuses
 * to run against the live project while an emulator host is still exported,
 * which is the one mistake that would otherwise silently create your six real
 * users inside a throwaway emulator.
 *
 * Usage (live):
 *   1. Download a service account key from Firebase Console →
 *      Project Settings → Service Accounts → Generate new private key.
 *   2. $env:SI_TARGET="live"
 *      $env:GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"
 *      npm run bootstrap:users
 */
const { connect, targetLabel } = require("./_firebaseAdmin");

const { auth, db } = connect();

const PLANT_ID = "PLT001";
const DEPARTMENT_ID = "DEPT-MACHINING"; // adjust to a real /departments/{id} you've created

const SEED_USERS = [
  { email: "requester@example.com", password: "ChangeMe123!", name: "Ravi Kumar", role: "requester", phone: "98450 11223", skills: [] },
  { email: "tech.arun@example.com", password: "ChangeMe123!", name: "Arun Kumar", role: "technician", phone: "98450 77003", skills: ["Mechanical", "Hydraulics"] },
  { email: "tech.meera@example.com", password: "ChangeMe123!", name: "Meera Iyer", role: "technician", phone: "98450 77004", skills: ["Electrical", "PLC"] },
  { email: "supervisor@example.com", password: "ChangeMe123!", name: "Priya Nair", role: "supervisor", phone: "98450 99001", skills: [] },
  { email: "manager@example.com", password: "ChangeMe123!", name: "Vikram Shah", role: "manager", phone: "98450 88002", skills: [] },
  { email: "admin@example.com", password: "ChangeMe123!", name: "Anita Desai", role: "admin", phone: "98450 66009", skills: [] },
];

async function run() {
  console.log(`Target: ${targetLabel()}\n`);
  for (const u of SEED_USERS) {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(u.email);
      console.log(`Found existing user ${u.email} (${userRecord.uid})`);
    } catch {
      userRecord = await auth.createUser({ email: u.email, password: u.password, displayName: u.name });
      console.log(`Created user ${u.email} (${userRecord.uid})`);
    }

    // department_id matters most for Supervisor (their access is scoped to
    // it); Manager/Admin ignore it entirely per the security rules, but it
    // costs nothing to set consistently for every role.
    await auth.setCustomUserClaims(userRecord.uid, {
      role: u.role,
      department_id: DEPARTMENT_ID,
      plant_ids: [PLANT_ID],
    });

    await db.collection("users").doc(userRecord.uid).set(
      {
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        department_id: DEPARTMENT_ID,
        plant_ids: [PLANT_ID],
        skills: u.skills,
        status: "active",
      },
      { merge: true }
    );

    console.log(`  → role=${u.role} department_id=${DEPARTMENT_ID} plant_ids=[${PLANT_ID}]`);
  }
  console.log("\nDone. Users must sign out/in (or refresh their ID token) to pick up new custom claims.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
