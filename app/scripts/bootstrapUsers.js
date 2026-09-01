/**
 * SI — Service Inside · Authentication Module
 *
 * One-time bootstrap: creates the initial Supabase Auth users, their
 * public.users profile rows, and a technicians profile row for anyone whose
 * role is technician. Run this once, with the service role key, before anyone
 * can sign in — there is no in-app "create the first Administrator" flow by
 * design (that would be a privilege-escalation hole).
 *
 * WHERE THE ROLE ACTUALLY COMES FROM has changed since the Firebase version.
 * There is no setCustomUserClaims call here, because there are no custom claims
 * to set: the access-token hook reads public.users.roles at token-issue time
 * and injects them as the `user_roles` claim (migration 0020). Writing the users
 * row IS provisioning the role. One source of truth instead of two that had to
 * be kept in step.
 *
 * Roles match the approved 5-role model: requester, technician, supervisor,
 * manager (Maintenance Manager), admin (Administrator).
 *
 * Usage:
 *   1. Put SUPABASE_SERVICE_ROLE_KEY in app/.env.local
 *      (Dashboard -> Project Settings -> API -> service_role)
 *   2. npm run bootstrap:users
 *
 * Idempotent: re-running finds existing users by email and updates their
 * profile rather than failing.
 */
const { admin, projectLabel, guardProductionWrite } = require("./_supabaseAdmin");

const db = admin();

const PLANT_ID = "PLT001";
// Preferred home for the seeded accounts — but only if it is still active. A
// retired department is a real possibility and not a hypothetical: production
// has retired DEPT-MACHINING, and cloning that reference data into a fresh
// project put all six accounts in a department si_guard_retired_reference()
// refuses on any work order naming it. Resolved against the database by
// pickDepartment() below rather than trusted as a constant.
const PREFERRED_DEPARTMENT_ID = "DEPT-MACHINING";

const SEED_USERS = [
  { email: "requester@example.com",  password: "ChangeMe123!", name: "Ravi Kumar",  roles: ["requester"],  phone: "98450 11223", skills: [] },
  { email: "tech.arun@example.com",  password: "ChangeMe123!", name: "Arun Kumar",  roles: ["technician"], phone: "98450 77003", skills: ["Mechanical", "Hydraulics"] },
  { email: "tech.meera@example.com", password: "ChangeMe123!", name: "Meera Iyer",  roles: ["technician"], phone: "98450 77004", skills: ["Electrical", "PLC"] },
  { email: "supervisor@example.com", password: "ChangeMe123!", name: "Priya Nair",  roles: ["supervisor"], phone: "98450 99001", skills: [] },
  { email: "manager@example.com",    password: "ChangeMe123!", name: "Vikram Shah", roles: ["manager"],    phone: "98450 88002", skills: [] },
  { email: "admin@example.com",      password: "ChangeMe123!", name: "Anita Desai", roles: ["admin"],      phone: "98450 66009", skills: [] },
];

/** Auth has no getUserByEmail; listUsers is the supported lookup. */
async function findAuthUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

/**
 * The department to file these accounts under: the preferred one if it is still
 * active, otherwise the first active one there is.
 *
 * Retirement is not advisory (migration 0031) — si_guard_retired_reference()
 * refuses a work order naming a retired department, so an account whose home
 * department has been retired cannot raise anything against it. Seeding into
 * one produces six accounts that look fine and fail at the last step, which is
 * the shape of bug this schema keeps documenting.
 */
async function pickDepartment() {
  const { data, error } = await db
    .from("departments")
    .select("id, is_active")
    .order("id");
  if (error) throw new Error(`reading departments: ${error.message}`);

  const active = data.filter((d) => d.is_active);
  if (!active.length) {
    throw new Error(
      "Every department is retired, so there is nowhere to put these accounts.\n" +
        "  Restore one in Admin -> Reference data, or run `npm run clone:config`."
    );
  }

  const preferred = active.find((d) => d.id === PREFERRED_DEPARTMENT_ID);
  if (preferred) return preferred.id;

  console.log(
    `${PREFERRED_DEPARTMENT_ID} is retired on this project, so these accounts go to ` +
      `${active[0].id} instead.\n`
  );
  return active[0].id;
}

async function run() {
  console.log(`Project: ${projectLabel()}\n`);
  guardProductionWrite("bootstrap:users");

  const DEPARTMENT_ID = await pickDepartment();

  for (const u of SEED_USERS) {
    let authUser = await findAuthUserByEmail(u.email);

    if (authUser) {
      console.log(`Found existing user ${u.email} (${authUser.id})`);
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true, // no inbox to click through during bootstrap
      });
      if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
      authUser = data.user;
      console.log(`Created user ${u.email} (${authUser.id})`);
    }

    // department_id matters most for Supervisor (their access is scoped to it);
    // Manager/Admin ignore it entirely per the RLS policies, but it costs
    // nothing to set consistently for every role.
    const { error: profileError } = await db.from("users").upsert(
      {
        id: authUser.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        roles: u.roles,
        department_id: DEPARTMENT_ID,
        plant_ids: [PLANT_ID],
        status: "active",
      },
      { onConflict: "id" }
    );
    if (profileError) throw new Error(`users upsert ${u.email}: ${profileError.message}`);

    if (u.roles.includes("technician")) {
      const { error: techError } = await db.from("technicians").upsert(
        {
          user_id: authUser.id,
          name: u.name,
          skills: u.skills,
          plant_ids: [PLANT_ID],
          availability_status: "available",
        },
        { onConflict: "user_id" }
      );
      if (techError) throw new Error(`technicians upsert ${u.email}: ${techError.message}`);
    }

    console.log(`  -> roles=[${u.roles.join(", ")}] department_id=${DEPARTMENT_ID} plant_ids=[${PLANT_ID}]`);
  }

  console.log(
    "\nDone. Sign in at /login with any of the emails above and password ChangeMe123!" +
      "\nChange those passwords before this reaches anyone real." +
      "\n\nEvery account above is marked as seeded, so Admin -> Users and the Admin" +
      "\ndashboard now flag it until the password is changed, the profile is edited," +
      "\nand it has been signed into at least once." +
      "\n\nIf a role change does not appear immediately, the user's existing JWT is still" +
      "\ncached — signing out and in re-issues it through the access-token hook."
  );
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
