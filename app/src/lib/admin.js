"use client";

/**
 * SI — Service Inside · Administration
 *
 * Three different mechanisms, chosen per operation by what each one actually
 * needs — not for consistency's sake:
 *
 *   plain UPDATE  — profile fields and activate/deactivate. The users_update
 *                   policy already lets an admin write any user's row, and a
 *                   column guard (migration 0002) stops non-admins straying
 *                   beyond their own name/phone/photo.
 *   RPC           — role changes, via si_set_user_roles(). SECURITY DEFINER
 *                   because it also enforces that a Supervisor may only
 *                   provision inside their own department.
 *   Edge Function — passwords, sign-in addresses and account creation. All three
 *                   write auth.users, which needs Supabase's Admin API and
 *                   therefore the service-role key — a key that bypasses RLS and
 *                   must never reach a browser. See
 *                   supabase/functions/admin-users.
 */
import { supabase, liveQuery } from "./supabase";

/* ------------------------------------------------------------------
   Reads
-------------------------------------------------------------------*/

/**
 * NOTE: employee_id and must_change_password join this select because the Users
 * screen shows both — the number beside the address, and a marker on any account
 * that owes a password change. Neither decides anything on the client.
 */
// is_protected is selected because the client predicates in constants.js read
// it. RLS already hides protected rows from everyone but their owner (migration
// 0015), so in practice it arrives false — carrying it keeps the predicate
// honest rather than relying on that.
const USER_SELECT =
  "id, name, email, phone, employee_id, must_change_password, roles, department_id, " +
  "plant_ids, status, created_at, last_login_at, is_protected, password_changed_at";

/** Every user, live. The users_select policy already limits who sees this. */
export function listenUsers(cb, onError) {
  return liveQuery({
    table: "users",
    run: () => supabase.from("users").select(USER_SELECT).order("name", { ascending: true }),
    cb,
    onError,
  });
}

/** Technician records, for skills and availability. */
export function listenTechnicianRecords(cb, onError) {
  return liveQuery({
    table: "technicians",
    run: () =>
      supabase
        .from("technicians")
        .select("user_id, name, skills, certifications, current_load, availability_status, plant_ids")
        .order("name", { ascending: true }),
    cb,
    onError,
  });
}

/* ------------------------------------------------------------------
   Edge Function calls
-------------------------------------------------------------------*/

/**
 * supabase-js collapses any non-2xx into "Edge Function returned a non-2xx
 * status code" and hides the real reason in error.context, which is the raw
 * Response. Unwrap it, or every failure looks identical to the admin.
 */
async function invokeAdminFunction(body) {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });

  if (error) {
    let detail = null;
    try {
      detail = (await error.context?.json())?.error;
    } catch {
      // Not JSON — fall back to the generic message below.
    }
    throw new Error(detail || error.message || "That didn't work.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Set a user's password directly.
 *
 * Superuser only, for anyone but yourself, and enforced server-side — an
 * Administrator who can set a subordinate's password holds that person's
 * credential. It also marks the account as owing a change, so the password you
 * hand over stops working as soon as they have replaced it.
 */
export async function setUserPassword(userId, password) {
  return invokeAdminFunction({ action: "set_password", user_id: userId, password });
}

/**
 * Email someone a password-recovery link — what an Administrator uses instead of
 * setting a password.
 *
 * Not `supabase.auth.resetPasswordForEmail` from here, even though that would
 * work and is what /forgot-password does. The Edge Function adds the three things
 * this screen needs and the public endpoint cannot give: the rank check, a
 * refusal on an address that cannot receive mail, and a message saying which of
 * those happened. A silent success on a placeholder address is the failure this
 * exists to prevent — the mail is accepted and delivered nowhere, and the
 * administrator believes the person has been helped.
 */
export async function sendRecoveryLink(userId) {
  return invokeAdminFunction({ action: "send_recovery_link", user_id: userId });
}

/**
 * Change a user's sign-in address.
 *
 * Also an Edge Function call, and for the same reason as the password: the
 * address the user actually signs in with lives in auth.users, which only the
 * Admin API reaches. The function writes public.users.email too, so the two
 * agree, and applies the rank rule — your own account, or one strictly below
 * you, which is what stops one Administrator taking over another's by pointing
 * it at a mailbox they control.
 */
export async function setUserEmail(userId, email) {
  return invokeAdminFunction({ action: "set_email", user_id: userId, email });
}

/**
 * Delete an account outright. SUPERUSER ONLY, and the only irreversible
 * operation on a user.
 *
 * An Edge Function call because two rows have to go and one of them is in
 * auth.users, which only the Admin API reaches. The function deletes the
 * public.users row as the CALLER, so users_delete is still the boundary and the
 * deletion log still records who did it, then removes the sign-in on the service
 * role (migration 0030).
 *
 * Expect this to REFUSE for anyone who has actually used the system. Six foreign
 * keys onto users(id) are ON DELETE NO ACTION, so an account that has raised,
 * been assigned, verified, commented or uploaded cannot be removed without
 * breaking the audit trail. si_guard_user_delete turns that into a sentence
 * naming what it found, and describeError() passes server messages through
 * untouched so it reaches the screen as written. Deactivation is the answer
 * there, and the message says so.
 */
export async function deleteUser(userId) {
  return invokeAdminFunction({ action: "delete_user", user_id: userId });
}

/**
 * Create an account. The users row is what grants the role — the access-token
 * hook reads users.role when minting a token — so the function writes both, and
 * rolls the auth account back if the profile insert fails.
 */
export async function createUser({
  email, password, name, roles, departmentId, plantIds, phone, employeeId,
}) {
  return invokeAdminFunction({
    action: "create_user",
    email,
    password,
    name,
    roles,
    department_id: departmentId || null,
    plant_ids: plantIds || [],
    phone: phone || "",
    employee_id: employeeId?.trim() || null,
  });
}

/* ------------------------------------------------------------------
   Direct writes
-------------------------------------------------------------------*/

/**
 * Change a user's roles, department and plants together.
 *
 * The new roles only reach their JWT when their token is next refreshed, since
 * custom_access_token_hook runs at token-issue time. Supabase refreshes roughly
 * hourly, so a demotion is not instant — tell the user to sign out and back in
 * if it needs to take effect now.
 *
 * si_set_user_roles restates every rule the users_* policies apply, because it
 * is SECURITY DEFINER and no policy sees it: not your own account, target below
 * your rank, and every role granted below your rank — not merely the highest of
 * them, or a Manager could grant admin alongside requester and have the pair
 * pass as rank 5.
 */
export async function setUserRoles(userId, roles, departmentId, plantIds) {
  const { error } = await supabase.rpc("si_set_user_roles", {
    p_uid: userId,
    p_roles: roles,
    p_department_id: departmentId || null,
    p_plant_ids: plantIds || [],
  });
  if (error) throw error;
}

/** Deactivate or reactivate an account. */
export async function setUserStatus(userId, status) {
  const { error } = await supabase.from("users").update({ status }).eq("id", userId);
  if (error) throw error;
}

/**
 * Edit the display fields on someone else's profile.
 *
 * employee_id is admin-only, and the column guard is what enforces it: it sits in
 * si_guard_user_self_update's non-admin deny list (migration 0025), so a
 * non-admin patching their own row is refused rather than silently ignored.
 */
export async function updateUserProfile(userId, { name, phone, employeeId }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (phone !== undefined) patch.phone = phone;
  // An empty string is a deliberate clear, so `undefined` is the only skip. The
  // column is nullable and its unique index is partial, so null is how an account
  // has no number — rather than an empty string competing with every other one.
  if (employeeId !== undefined) patch.employee_id = employeeId?.trim() ? employeeId.trim() : null;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("users").update(patch).eq("id", userId);
  if (error) throw error;
}

/**
 * Grant or revoke a capability for a whole role.
 *
 * A plain UPDATE: role_permissions_update is `using (si_is_superuser())`, so the
 * database is what limits this to a Superuser, and an Administrator attempting
 * it gets a refusal rather than a silent no-op — which is why the row count is
 * checked. There is no insert or delete policy; the five rows are the five
 * values of the si_role enum, like the other enum-keyed tables (migration 0009).
 */
export async function setRolePermission(role, capability, value) {
  const { data, error } = await supabase
    .from("role_permissions")
    .update({ [capability]: value })
    .eq("role", role)
    .select("role");
  if (error) throw error;
  if (!data?.length) {
    throw new Error("Only a Superuser can change role permissions.");
  }
}

/** Keep a technician's skill list in step, so AssignPanel's matching works. */
export async function updateTechnicianRecord(userId, { skills, availabilityStatus }) {
  const patch = {};
  if (skills !== undefined) patch.skills = skills;
  if (availabilityStatus !== undefined) patch.availability_status = availabilityStatus;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("technicians").update(patch).eq("user_id", userId);
  if (error) throw error;
}

/* ------------------------------------------------------------------
   Operational reference data — departments and assets are real records an
   admin adds to, unlike the enum-keyed lookup tables which can only be
   relabelled (see migration 0009).
-------------------------------------------------------------------*/

export async function upsertDepartment({ id, name, code, plantId }) {
  /* Trimmed here, and this is not cosmetic. createDepartment() below has always
     trimmed; this path — Admin -> Settings -> Departments — did not, and
     production carried a department actually named "Maintenance " for it. The
     trailing space is invisible in every list it appears in, sorts oddly, and
     makes a second "Maintenance" typed without it read as a different
     department rather than a collision. `code` too, since it is unique and
     " MTN" and "MTN" are two different codes. */
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Give the department a name.");
  const cleanCode = String(code || "").trim();
  const { error } = await supabase
    .from("departments")
    .upsert(
      { id, name: clean, code: cleanCode || id, plant_id: plantId || "PLT001" },
      { onConflict: "id" }
    );
  if (error) throw error;
}

/**
 * Create a department, for the "+ Add new" row in the raise form's picker.
 *
 * INSERT rather than upsert, unlike upsertDepartment above: this one is reached
 * by any signed-in user (migration 0019 opened departments_insert), and an
 * upsert would let a Requester silently rewrite an existing department's name by
 * guessing its id. A collision has to come back as a collision.
 *
 * The id is derived from the name rather than typed, because the person filing a
 * work order should not have to know that DEPT-* is a business key printed on
 * things. `code` is `unique not null`, so it gets the same treatment and the
 * same de-duplicating suffix.
 */
export async function createDepartment({ name, plantId }) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Give the department a name.");

  const slug = clean.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  if (!slug) throw new Error("That name has no letters or numbers in it.");

  const { data, error } = await supabase
    .from("departments")
    .insert({
      id: `DEPT-${slug}`,
      name: clean,
      code: slug.slice(0, 12),
      plant_id: plantId || "PLT001",
    })
    .select("id, name, code, plant_id")
    .single();

  // 23505 is either id or code — both mean the same thing to the person typing,
  // and both are worth saying plainly rather than as "duplicate key value".
  if (error) {
    if (error.code === "23505") {
      throw new Error(`"${clean}" already exists — pick it from the list instead.`);
    }
    throw error;
  }
  return data;
}

/*
 * Deleting a department used to live here, counting the three tables that carry
 * a FK onto it so the failure could name them instead of arriving as a bare
 * 23503. Migration 0031 moved that counting into si_guard_reference_delete(),
 * which does it for all six reference tables, cannot race a concurrent insert,
 * and holds whether the DELETE arrives from this app or from anything else.
 * The caller is deleteReferenceRow("departments", id) in lib/referenceData.js.
 */

/*
 * createAsset() is gone.
 *
 * It was the "+ Add equipment" row in the raise form's picker, opened up by
 * migration 0032 on the reasoning that the person on the floor with a fault is
 * the one who notices the machine is missing. 0049 closed it again: the
 * equipment register is now the three 2026 master lists, `assets_insert` is
 * si_is_admin(), and "Other (specify)" is what someone with an unlisted machine
 * chooses instead — recorded on their work order, added to no list.
 *
 * Removed rather than left in place, the same way 0031 removed
 * deleteDepartment(): an exported write that every non-admin caller would have
 * refused reads as a capability the app still has.
 */

/**
 * Add or correct a piece of equipment. Administrator only since migration 0049,
 * and the only way equipment enters the register now.
 *
 * `plantId` is required and deliberately has no fallback. It used to default to
 * 'PLT001', which 0049 retired — so the old default would now create a machine
 * on a plant nobody can choose, and that machine would be invisible on the raise
 * form with nothing on screen to explain why. The plant is what the equipment
 * picker narrows on; a machine without one is unreachable.
 *
 * `departmentId` stays optional, and that is the other half of 0049: the master
 * lists record a location, not a department, so all 134 imported machines carry
 * none and the column lost its `not null`.
 */
export async function upsertAsset({ id, assetCode, name, departmentId, criticality, category, plantId, status }) {
  // Same trimming as upsertDepartment, for the same reason — and `name` here is
  // denormalised onto work_orders.asset_name, so a stray space is copied onto
  // every work order raised against the machine afterwards.
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Give the machine a name.");
  if (!plantId) throw new Error("Choose which plant the machine is on.");
  const { error } = await supabase.from("assets").upsert(
    {
      id,
      asset_code: String(assetCode || "").trim() || id,
      name: clean,
      department_id: departmentId || null,
      criticality,
      category: category || null,
      plant_id: plantId,
      // Carried through rather than pinned to 'active'. Since 0031 this column
      // is what retires a piece of equipment, so hardcoding it here would put
      // a decommissioned machine back on the raise form the next time an
      // Administrator corrected its name — and the guard would not object,
      // because restoring is a legitimate write it simply would not have made.
      status: status || "active",
    },
    { onConflict: "id" }
  );
  if (error) throw error;
}

export async function updateSlaTargets(priorityId, patch) {
  const { error } = await supabase.from("sla").update(patch).eq("priority_id", priorityId);
  if (error) throw error;
}

export async function updatePriority(priorityId, patch) {
  const { error } = await supabase.from("priorities").update(patch).eq("id", priorityId);
  if (error) throw error;
}
