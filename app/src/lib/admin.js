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
 *   RPC           — role changes, via si_set_user_role(). SECURITY DEFINER
 *                   because it also enforces that a Supervisor may only
 *                   provision inside their own department.
 *   Edge Function — passwords and account creation. These need Supabase's Admin
 *                   API and therefore the service-role key, which bypasses RLS
 *                   and must never reach a browser. See
 *                   supabase/functions/admin-users.
 */
import { supabase, liveQuery } from "./supabase";

/* ------------------------------------------------------------------
   Reads
-------------------------------------------------------------------*/

/**
 * si_dummy_flags is a computed column, not a stored one — PostgREST calls
 * si_dummy_flags(users) per row (migration 0012). Selecting it here rather than
 * re-deriving "does this still look like demo data?" in the client keeps one
 * definition, and keeps it next to the columns it reads.
 */
// is_protected is selected because the client predicates in constants.js read
// it. RLS already hides protected rows from everyone but their owner (migration
// 0015), so in practice it arrives false — carrying it keeps the predicate
// honest rather than relying on that.
const USER_SELECT =
  "id, name, email, phone, role, department_id, plant_ids, status, created_at, " +
  "last_login_at, is_protected, seed_source, password_changed_at, si_dummy_flags";

/** Every user, live. The users_select policy already limits who sees this. */
export function listenUsers(cb, onError) {
  return liveQuery({
    table: "users",
    run: () => supabase.from("users").select(USER_SELECT).order("name", { ascending: true }),
    cb,
    onError,
  });
}

/* ------------------------------------------------------------------
   Demo accounts

   The six accounts bootstrapUsers.js creates share one password and an
   @example.com address, and until now nothing in the app ever said so. Each
   reason is tracked separately so it clears on its own the moment it is dealt
   with — an account with no reasons left is simply not flagged.
-------------------------------------------------------------------*/

export const DEMO_FLAGS = {
  placeholder_email: {
    short: "Placeholder email",
    detail: "The sign-in address is at a reserved demo domain, so it can never receive mail.",
    fix: "Create a real account for this person and deactivate this one.",
  },
  default_password: {
    short: "Default password",
    detail: "Still on the password the seeding script set — shared with every other seeded account.",
    fix: "Set a new password from this row.",
  },
  unchanged_profile: {
    short: "Seed profile",
    detail: "Name and phone are still exactly what was seeded, so nobody has claimed this account.",
    fix: "Edit the profile, or clear the demo mark if this is a real person.",
  },
  never_signed_in: {
    short: "Never signed in",
    detail: "Provisioned by the seeding script and never used.",
    fix: "Deactivate it if nobody needs it.",
  },
};

export function demoFlagsOf(user) {
  return user?.si_dummy_flags ?? [];
}

export function isDemoAccount(user) {
  return demoFlagsOf(user).length > 0;
}

/**
 * Only the flagged accounts, for the Admin dashboard card. Filtering client-side
 * rather than as a PostgREST predicate on the computed column: the user table is
 * small, and the card wants the full rows anyway to list them.
 */
export function listenDemoAccounts(cb, onError) {
  return liveQuery({
    table: "users",
    run: () => supabase.from("users").select(USER_SELECT).order("name", { ascending: true }),
    cb: (rows) => cb(rows.filter(isDemoAccount)),
    onError,
  });
}

/**
 * "This is a real account, stop flagging it."
 *
 * A plain UPDATE, like the other profile writes: users_update already limits
 * this to an Administrator, and si_guard_user_self_update (migration 0012)
 * rejects it from anyone else — a flagged user must not be able to clear their
 * own flag.
 *
 * Clearing seed_source drops default_password, unchanged_profile and
 * never_signed_in together, because all three only apply to a seeded account.
 * placeholder_email survives deliberately: an @example.com address is still
 * fake, and the only honest fix is a different account.
 */
export async function clearDemoMark(userId) {
  const { error } = await supabase
    .from("users")
    .update({ seed_source: null, seed_name: null, seed_phone: null })
    .eq("id", userId);
  if (error) throw error;
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

/** Set any user's password directly. Admin only, enforced server-side. */
export async function setUserPassword(userId, password) {
  return invokeAdminFunction({ action: "set_password", user_id: userId, password });
}

/**
 * Create an account. The users row is what grants the role — the access-token
 * hook reads users.role when minting a token — so the function writes both, and
 * rolls the auth account back if the profile insert fails.
 */
export async function createUser({ email, password, name, role, departmentId, plantIds, phone }) {
  return invokeAdminFunction({
    action: "create_user",
    email,
    password,
    name,
    role,
    department_id: departmentId || null,
    plant_ids: plantIds || [],
    phone: phone || "",
  });
}

/* ------------------------------------------------------------------
   Direct writes
-------------------------------------------------------------------*/

/**
 * Change a user's role, department and plants together.
 *
 * The new role only reaches their JWT when their token is next refreshed, since
 * custom_access_token_hook runs at token-issue time. Supabase refreshes roughly
 * hourly, so a demotion is not instant — tell the user to sign out and back in
 * if it needs to take effect now.
 */
export async function setUserRole(userId, role, departmentId, plantIds) {
  const { error } = await supabase.rpc("si_set_user_role", {
    p_uid: userId,
    p_role: role,
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

/** Edit the display fields on someone else's profile. */
export async function updateUserProfile(userId, { name, phone }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (phone !== undefined) patch.phone = phone;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("users").update(patch).eq("id", userId);
  if (error) throw error;
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
  const { error } = await supabase
    .from("departments")
    .upsert({ id, name, code: code || id, plant_id: plantId || "PLT001" }, { onConflict: "id" });
  if (error) throw error;
}

export async function upsertAsset({ id, assetCode, name, departmentId, criticality, category, plantId }) {
  const { error } = await supabase.from("assets").upsert(
    {
      id,
      asset_code: assetCode || id,
      name,
      department_id: departmentId,
      criticality,
      category: category || null,
      plant_id: plantId || "PLT001",
      status: "active",
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
