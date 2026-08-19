/**
 * SI — Service Inside · admin-users Edge Function
 *
 * Why this exists at all: setting another user's password, changing a sign-in
 * address and creating auth accounts all reach into auth.users, which requires
 * Supabase's Admin API, which requires the service-role key.
 * That key bypasses Row Level Security completely, so it can never be shipped to
 * the browser. This function is the only place it runs, on Supabase's servers,
 * where the key is injected from the environment and never leaves.
 *
 * WHO MAY DO WHAT HERE. Not one rule — three, because these operations are not
 * equally dangerous:
 *   - set_password       -> your own, or SUPERUSER ONLY. An administrator who can
 *                           set a subordinate's password holds their credential.
 *   - set_email          -> your own, or SUPERUSER ONLY. Paired with the above
 *                           deliberately: an address you can repoint at a mailbox
 *                           you control, plus the public self-service reset, IS a
 *                           password reset. Restricting one without the other
 *                           would have been theatre.
 *   - send_recovery_link -> any active admin, target strictly below their rank.
 *                           What an administrator uses instead. Refuses a
 *                           placeholder address loudly, because succeeding and
 *                           delivering nothing is the worst outcome available.
 *   - create_user        -> any active admin, no role granted at or above their
 *                           own rank. Flags the new account, because the password
 *                           was chosen by whoever created it.
 *
 * Everything else an admin needs is already possible directly from the client and
 * is deliberately NOT duplicated here:
 *   - role / department / plant changes -> si_set_user_roles() RPC (migration 0020)
 *   - activate / deactivate            -> UPDATE users SET status, allowed to
 *                                         admins by the users_update policy.
 *                                         Since migration 0026 that actually
 *                                         revokes access, at the next token
 *                                         refresh; before it, status decided
 *                                         nothing at all.
 *
 * Authorization is checked twice over:
 *   1. verify_jwt is on, so Supabase rejects anything without a valid token
 *      before this code runs.
 *   2. The caller's row in public.users must HOLD 'admin' among its roles and be
 *      status='active'. That's read from the database rather than taken from the
 *      JWT's user_roles claim — a token issued before an admin was demoted is still validly
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

/**
 * The role hierarchy from migration 0015, restated. It has to be restated:
 * everything below runs on the service-role key, which bypasses Row Level
 * Security, so the users_update / users_insert policies never see these writes.
 * Keep the two in step — if the ranks here and si_role_rank() ever disagree, the
 * looser one wins, and it is this one.
 */
const ROLE_RANK: Record<string, number> = {
  requester: 1,
  technician: 2,
  supervisor: 3,
  manager: 4,
  admin: 5,
};
const SUPERUSER_RANK = 6;

/** The rank of a role name. */
const rankOfRole = (role: string | null | undefined) => ROLE_RANK[role ?? ""] ?? 0;

/** The rank of a set of roles: the highest of them. Mirrors si_roles_rank(). */
const rankOfRoles = (roles: string[] | null | undefined) =>
  (roles ?? []).reduce((max, r) => Math.max(max, rankOfRole(r)), 0);

/**
 * The rank of an actual account. A Superuser holds 'admin' plus is_protected,
 * outranking every role — which is what lets them, and only them, create an
 * Administrator here.
 */
const rankOfAccount = (row: { roles?: string[] | null; is_protected?: boolean | null } | null) =>
  row?.is_protected ? SUPERUSER_RANK : rankOfRoles(row?.roles);

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
    .select("roles, status, name, is_protected, must_change_password")
    .eq("id", caller.user.id)
    .maybeSingle();

  if (roleError) return json({ error: "Couldn't verify your account." }, 500);
  // Membership, not equality: an account holds a set of roles (migration 0020).
  if (!callerRow || !(callerRow.roles ?? []).includes("admin") || callerRow.status !== "active") {
    return json({ error: "Only an active Administrator can manage user accounts." }, 403);
  }

  /* must_change_password HAS TO BE CHECKED HERE, and it is the one place it is
     easy to miss.

     Migration 0026 enforces the flag by withholding role claims at token issue,
     which denies the account everywhere the claims are what is read: every RLS
     policy, and si_set_user_roles via si_caller_rank()/si_is_admin(). This
     function is the exception BY DESIGN — it re-reads roles from the database
     precisely so a stale token cannot be used — and that same design walks
     straight past the withholding.

     Left unchecked, an Administrator holding a password somebody else chose for
     them could set other people's passwords and create accounts before ever
     changing their own. That is the account whose credential is least trusted in
     the whole system, and this is the most privileged code in it.

     Three enforcement points, and the loosest wins. This was the loosest. */
  if (callerRow.must_change_password) {
    return json(
      {
        error:
          "Change your own password first. This account was given a password by " +
          "somebody else, so it cannot administer other accounts until you have " +
          "replaced it.",
      },
      403,
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const action = String(payload.action ?? "");

  /* ---------------------------------------------------------------
     set_password — SUPERUSER ONLY.

     The rank rule is not enough here, and this is the decision the whole
     sub-project turns on: an Administrator who can set a subordinate's password
     HOLDS that person's credential. Restricting it to the account that is
     administered only from Supabase means nobody inside the app ever does.

     The cost is accepted knowingly: an account with no working mailbox and a
     forgotten password waits for the Superuser, night shift included. For
     everyone with a real address, send_recovery_link below is the answer.
  ----------------------------------------------------------------*/
  if (action === "set_password") {
    const userId = String(payload.user_id ?? "");
    const password = String(payload.password ?? "");

    if (!userId) return json({ error: "Which user?" }, 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }

    // Your own password needs no Superuser. That is /change-password, and this
    // branch keeps working for it.
    const isSelf = userId === caller.user.id;
    if (!isSelf && !callerRow.is_protected) {
      return json(
        {
          error:
            "Only the protected Superuser account can set someone else's password. " +
            "Use “Send reset link” instead, so they choose their own.",
        },
        403,
      );
    }

    if (!isSelf) {
      const { data: targetRow, error: targetError } = await admin
        .from("users")
        .select("roles, is_protected, name")
        .eq("id", userId)
        .maybeSingle();

      if (targetError) return json({ error: "Couldn't verify that account." }, 500);
      if (!targetRow) return json({ error: "No such user." }, 404);
      if (targetRow.is_protected) {
        return json(
          { error: "This account is protected. It can only be changed from the database." },
          403,
        );
      }
      // Kept although only a Superuser reaches here, and a Superuser outranks
      // everybody, so it cannot fire today. It is the line that keeps the rule
      // true if the check above is ever widened.
      if (rankOfAccount(targetRow) >= rankOfAccount(callerRow)) {
        return json(
          { error: "You can only set the password of someone below you in the hierarchy." },
          403,
        );
      }
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);

    /* THE FLAG GOES AFTER THE PASSWORD. NOT BEFORE.

       Writing a password IS a password change, so si_sync_auth_user_activity
       fires and clears must_change_password. Set it first and the trigger wipes
       it: the account gets a temporary password and no obligation to change it,
       with nothing anywhere reporting a problem. See migration 0025 §3. */
    if (!isSelf) {
      const { error: flagError } = await admin
        .from("users")
        .update({ must_change_password: true })
        .eq("id", userId);

      if (flagError) {
        // Reported, not swallowed. A password changed without the obligation
        // attached is the one outcome an administrator must not be allowed to
        // believe went fine.
        return json({
          ok: true,
          message:
            `Password updated, but this account was NOT marked as needing to change it: ` +
            `${flagError.message}. Set users.must_change_password = true by hand.`,
        });
      }
      return json({
        ok: true,
        message: "Temporary password set. They must change it the first time they sign in.",
      });
    }

    return json({ ok: true, message: "Password updated." });
  }

  /* ---------------------------------------------------------------
     send_recovery_link — how an administrator helps someone who is locked out.
     Supabase emails them a link and they set their own password, so no
     administrator ever holds a credential belonging to somebody else.

     Sent through an ANON client on purpose. resetPasswordForEmail is a public
     endpoint — /forgot-password already calls it from the browser with any
     address you like — so routing it through here grants nothing new. What this
     function adds is the part the public endpoint cannot: the rank check, a
     refusal on an address that cannot receive mail, and a definite answer to the
     administrator about which of those happened.
  ----------------------------------------------------------------*/
  if (action === "send_recovery_link") {
    const userId = String(payload.user_id ?? "");
    if (!userId) return json({ error: "Which user?" }, 400);

    /* Checked before anything else, because without it the feature cannot work
       at all and every other refusal below would be noise. window.location.origin
       is not available here and would be wrong anyway — Capacitor serves the same
       export from https://localhost, so a link built from it points the reader's
       mail client at their own phone. */
    const SITE_URL = Deno.env.get("SITE_URL") ?? "";
    if (!SITE_URL) {
      return json(
        {
          error:
            "SITE_URL is not set on this function, so the reset link would point nowhere. " +
            "Set it in Edge Functions → Secrets to the deployed web address.",
        },
        500,
      );
    }

    const { data: targetRow, error: targetError } = await admin
      .from("users")
      .select("email, name, roles, is_protected")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) return json({ error: "Couldn't verify that account." }, 500);
    if (!targetRow) return json({ error: "No such user." }, 404);
    if (targetRow.is_protected) {
      return json(
        { error: "This account is protected. It can only be changed from the database." },
        403,
      );
    }
    if (userId !== caller.user.id && rankOfAccount(targetRow) >= rankOfAccount(callerRow)) {
      return json(
        { error: "You can only send a reset link to someone below you in the hierarchy." },
        403,
      );
    }

    /* LOUDLY, not silently. resetPasswordForEmail succeeds against
       tech.arun@example.com and delivers nothing, and an administrator who is
       told it worked believes the person has been helped. That is the worst
       available outcome, so it is the one refusal spelled out in full. */
    const { data: isPlaceholder, error: placeholderError } = await admin.rpc(
      "si_is_placeholder_email",
      { p_email: targetRow.email },
    );

    if (placeholderError) return json({ error: "Couldn't check that address." }, 500);
    if (isPlaceholder === true) {
      return json(
        {
          error:
            `${targetRow.email} is a placeholder address — nothing is delivered to it, so a ` +
            `reset link would silently go nowhere. Give this account a real address first ` +
            `(Edit → Email), or ask the Superuser to set a temporary password.`,
        },
        400,
      );
    }

    // trailingSlash: true in next.config.js, and Supabase matches its redirect
    // allow-list on the exact URL — /reset-password without the slash is a
    // redirect and will not match.
    const redirectTo = `${SITE_URL.replace(/\/+$/, "")}/reset-password/`;

    const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: sendError } = await anon.auth.resetPasswordForEmail(targetRow.email, {
      redirectTo,
    });
    if (sendError) return json({ error: sendError.message }, 400);

    return json({
      ok: true,
      message: `Reset link sent to ${targetRow.email}. It expires — tell them to use it now.`,
    });
  }

  /* ---------------------------------------------------------------
     set_email — the sign-in identity.

     Two stores have to agree: auth.users.email is what the user types at the
     sign-in screen, and public.users.email is what every screen in the app
     displays. Only the Admin API can write the first, which is why this lives
     here rather than beside updateUserProfile().

     Same rank rule as set_password, and for the same reason: an email change is
     an account takeover if it is aimed at somebody you do not outrank — reset
     the address, then use Forgot password on it. Self is allowed, so an admin
     can correct their own address without a Superuser.
  ----------------------------------------------------------------*/
  if (action === "set_email") {
    const userId = String(payload.user_id ?? "");
    const email = String(payload.email ?? "").trim().toLowerCase();

    if (!userId) return json({ error: "Which user?" }, 400);
    // Deliberately loose: the authority on what is a deliverable address is the
    // Admin API below, and a stricter regex here would only reject valid ones.
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      return json({ error: "That doesn't look like a valid email address." }, 400);
    }

    if (userId !== caller.user.id) {
      const { data: targetRow, error: targetError } = await admin
        .from("users")
        .select("roles, is_protected, name")
        .eq("id", userId)
        .maybeSingle();

      if (targetError) return json({ error: "Couldn't verify that account." }, 500);
      if (!targetRow) return json({ error: "No such user." }, 404);
      if (targetRow.is_protected) {
        return json(
          { error: "This account is protected. It can only be changed from the database." },
          403,
        );
      }
      /* Superuser-only, matching set_password, because the two are the same
         privilege wearing different clothes: repoint a subordinate's sign-in
         address at a mailbox you control, run the PUBLIC self-service reset at
         /forgot-password, and you have their password without ever calling
         set_password. Leaving the rank rule here would have left that bypass wide
         open beside a Superuser-only set_password — which would have made this
         whole sub-project theatre. Your own address stays yours to change; that
         is not an escalation. */
      if (!callerRow.is_protected) {
        return json(
          {
            error:
              "Only the protected Superuser account can change someone else's sign-in address. " +
              "You can change your own.",
          },
          403,
        );
      }
      if (rankOfAccount(targetRow) >= rankOfAccount(callerRow)) {
        return json(
          { error: "You can only change the email address of someone below you in the hierarchy." },
          403,
        );
      }
    }

    // email_confirm marks the new address verified straight away. Without it the
    // account is left mid-change — Supabase keeps the old address live until a
    // link is clicked, and these are provisioned shop-floor accounts whose
    // mailbox the admin may well not be able to reach.
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      email,
      email_confirm: true,
    });
    if (authError) return json({ error: authError.message }, 400);

    // The profile row second: if this fails the account can still sign in with
    // the new address, and a stale display value is the milder of the two
    // failures. Rolling the auth change back would risk leaving neither store
    // written if that call failed too.
    const { error: profileError } = await admin
      .from("users")
      .update({ email })
      .eq("id", userId);

    if (profileError) {
      return json({
        ok: true,
        message:
          `Sign-in address changed to ${email}, but the profile record still shows the old one: ` +
          `${profileError.message}`,
      });
    }

    return json({ ok: true, message: `Sign-in address changed to ${email}.` });
  }

  /* ---------------------------------------------------------------
     create_user — an auth account plus its public.users row. Writing the
     users row IS what provisions the roles: custom_access_token_hook reads
     users.roles when it mints a token, so without the row the account signs
     in with no roles and can see nothing.
  ----------------------------------------------------------------*/
  if (action === "create_user") {
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const name = String(payload.name ?? "").trim();
    const roles: string[] = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    const departmentId = payload.department_id ? String(payload.department_id) : null;
    const plantIds = Array.isArray(payload.plant_ids) ? payload.plant_ids.map(String) : [];
    const phone = payload.phone ? String(payload.phone) : "";
    // Trimmed only. The unique index normalises with upper(btrim(...)), so it is
    // the index — not this line — that decides two numbers are the same, and
    // storing what the administrator typed keeps the display honest.
    const employeeIdRaw = payload.employee_id ? String(payload.employee_id).trim() : "";
    const employeeId = employeeIdRaw || null;

    const VALID_ROLES = ["requester", "technician", "supervisor", "manager", "admin"];
    if (!email) return json({ error: "An email address is required." }, 400);
    if (!name) return json({ error: "A name is required." }, 400);
    if (roles.length === 0) return json({ error: "Pick at least one role." }, 400);
    if (!roles.every((r) => VALID_ROLES.includes(r))) {
      return json({ error: "Pick valid roles." }, 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }
    // You cannot create a peer. Matches the users_insert policy, which this
    // path would otherwise sail straight past on the service-role key — and
    // means a new Administrator is made from the Supabase dashboard, alongside
    // the protected accounts.
    // EVERY role granted must be below the caller, not merely the highest of
    // them — otherwise 'admin' could ride along beside 'requester' and the pair
    // would pass as rank 5. Same check si_set_user_roles makes.
    const tooHigh = roles.find((r) => rankOfRole(r) >= rankOfAccount(callerRow));
    if (tooHigh) {
      return json(
        { error: `You cannot grant the role "${tooHigh}" — it is at or above your own rank.` },
        403,
      );
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
      employee_id: employeeId,
      roles,
      department_id: departmentId,
      plant_ids: plantIds,
      status: "active",
      /* A new account's password was chosen by the administrator creating it, so
         it is owed a change for exactly the reason a reset one is. The design
         spec's §5 table lists only set_password; creating an account is issuing a
         credential somebody else knows, and leaving it unflagged would mean every
         account provisioned through this screen keeps an admin-known password
         indefinitely — the requirement this sub-project exists to satisfy, missed
         on the most common route to a new account.

         Safe here, unlike set_password's separate write:
         si_sync_auth_user_activity is an UPDATE trigger on auth.users, and
         createUser INSERTs there. Nothing fires, so nothing clears it. */
      must_change_password: true,
    });

    if (profileError) {
      // Roll the auth account back rather than leaving an account that can sign
      // in but has no roles and therefore no access to anything.
      await admin.auth.admin.deleteUser(created.user.id);
      const hint = /users_employee_id_key/.test(profileError.message)
        ? ` Employee ID "${employeeIdRaw}" is already used by another account.`
        : "";
      return json({ error: `Couldn't create the profile: ${profileError.message}.${hint}` }, 400);
    }

    // A technician also needs a technicians row before they can be assigned work.
    if (roles.includes("technician")) {
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

    return json({
      ok: true,
      user_id: created.user.id,
      message: `${name} can now sign in with that password, and must change it the first time.`,
    });
  }

  return json({ error: `Unknown action "${action}".` }, 400);
});
