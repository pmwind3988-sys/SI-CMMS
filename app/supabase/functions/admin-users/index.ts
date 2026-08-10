/**
 * SI — Service Inside · admin-users Edge Function
 *
 * Why this exists at all: setting another user's password and creating auth
 * accounts require Supabase's Admin API, which requires the service-role key.
 * That key bypasses Row Level Security completely, so it can never be shipped to
 * the browser. This function is the only place it runs, on Supabase's servers,
 * where the key is injected from the environment and never leaves.
 *
 * Everything else an admin needs is already possible directly from the client and
 * is deliberately NOT duplicated here:
 *   - role / department / plant changes -> si_set_user_role() RPC (migration 0004)
 *   - activate / deactivate            -> UPDATE users SET status, allowed to
 *                                         admins by the users_update policy
 *
 * Authorization is checked twice over:
 *   1. verify_jwt is on, so Supabase rejects anything without a valid token
 *      before this code runs.
 *   2. The caller's row in public.users must be role='admin' AND status='active'.
 *      That's read from the database rather than taken from the JWT's user_role
 *      claim — a token issued before an admin was demoted is still validly
 *      signed for up to an hour, and the database is the current truth.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The Authorization header is the only credential that matters here, and browsers
// do not attach it cross-origin on their own — it lives in the app's own storage.
// So a permissive origin cannot be used to act on a signed-in admin's behalf.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIN_PASSWORD_LENGTH = 8;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in required." }, 401);

  // Service client: used for the authorization check and for the privileged work.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Establish who is calling by validating their token.
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller?.user) return json({ error: "Your session is not valid." }, 401);

  const { data: callerRow, error: roleError } = await admin
    .from("users")
    .select("role, status, name")
    .eq("id", caller.user.id)
    .maybeSingle();

  if (roleError) return json({ error: "Couldn't verify your account." }, 500);
  if (!callerRow || callerRow.role !== "admin" || callerRow.status !== "active") {
    return json({ error: "Only an active Administrator can manage user accounts." }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const action = String(payload.action ?? "");

  /* ---------------------------------------------------------------
     set_password — the operation this function was written for.
  ----------------------------------------------------------------*/
  if (action === "set_password") {
    const userId = String(payload.user_id ?? "");
    const password = String(payload.password ?? "");

    if (!userId) return json({ error: "Which user?" }, 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, message: "Password updated." });
  }

  /* ---------------------------------------------------------------
     create_user — an auth account plus its public.users row. Writing the
     users row IS what provisions the role: custom_access_token_hook reads
     users.role when it mints a token, so without the row the account signs
     in with no role and can see nothing.
  ----------------------------------------------------------------*/
  if (action === "create_user") {
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const name = String(payload.name ?? "").trim();
    const role = String(payload.role ?? "");
    const departmentId = payload.department_id ? String(payload.department_id) : null;
    const plantIds = Array.isArray(payload.plant_ids) ? payload.plant_ids.map(String) : [];
    const phone = payload.phone ? String(payload.phone) : "";

    const VALID_ROLES = ["requester", "technician", "supervisor", "manager", "admin"];
    if (!email) return json({ error: "An email address is required." }, 400);
    if (!name) return json({ error: "A name is required." }, 400);
    if (!VALID_ROLES.includes(role)) return json({ error: "Pick a valid role." }, 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }

    // email_confirm: these are shop-floor accounts an admin provisions directly,
    // so there is no inbox round trip to wait for.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) return json({ error: createError.message }, 400);

    const { error: profileError } = await admin.from("users").insert({
      id: created.user.id,
      name,
      email,
      phone,
      role,
      department_id: departmentId,
      plant_ids: plantIds,
      status: "active",
    });

    if (profileError) {
      // Roll the auth account back rather than leaving an account that can sign
      // in but has no role and therefore no access to anything.
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: `Couldn't create the profile: ${profileError.message}` }, 400);
    }

    // A technician also needs a technicians row before they can be assigned work.
    if (role === "technician") {
      const { error: techError } = await admin.from("technicians").insert({
        user_id: created.user.id,
        name,
        skills: [],
        certifications: [],
        current_load: 0,
        availability_status: "available",
        plant_ids: plantIds,
      });
      if (techError) {
        return json({
          ok: true,
          message: `Account created, but the technician record failed: ${techError.message}. They can sign in but cannot be assigned work yet.`,
        });
      }
    }

    return json({ ok: true, user_id: created.user.id, message: `${name} can now sign in.` });
  }

  return json({ error: `Unknown action "${action}".` }, 400);
});
