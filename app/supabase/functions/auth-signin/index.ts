/**
 * SI — Service Inside · auth-signin Edge Function
 *
 * Sign in with an employee number instead of an email address.
 *
 * WHY IT IS A SEPARATE FUNCTION. admin-users would have been fewer files, and
 * its very first act is verifying that the caller is an active Administrator. An
 * unauthenticated action inside it would sit one `if` away from every privileged
 * operation in the module. Separate function, separate blast radius.
 *
 * WHY THE LOOKUP IS SERVER-SIDE. The anon key ships inside the browser bundle,
 * so anything granted to `anon` is a public endpoint. A function mapping employee
 * number to email address is then a staff directory and a credential-stuffing
 * target list, walkable in a loop. Exact match, rate limits and hashing all still
 * leave an oracle: the caller learns which numbers exist. Here the service-role
 * key never leaves Supabase, and a wrong number is indistinguishable from a wrong
 * password.
 *
 * ONE MESSAGE FOR EVERY FAILURE. Unknown number, wrong password, no number set,
 * inactive account, rate-limited — all GENERIC below. Any branch that says more
 * hands back the oracle. The direct email path in AuthContext has to match it,
 * or the leak simply moves to the other route.
 *
 * NEITHER THIS NOR si_email_by_employee_id FILTERS ON status. Adding it is the
 * obvious defensive move and it breaks the design: an inactive account would fail
 * at resolution while a wrong password fails at GoTrue, and the two become
 * distinguishable. An inactive account authenticates normally here and is denied
 * by carrying no role claims (migration 0026), which is the only place that
 * decision belongs.
 *
 * THE PASSWORD IS FORWARDED AND NEVER LOGGED. No console.log of the request body,
 * ever — that is the review item for this file. Nothing here logs the identifier
 * either: it is the key of the rate-limit row, so the table already holds
 * whatever needed keeping.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Every failure, without exception. */
const GENERIC = "Those details didn't match.";

// Five free attempts, then a delay that doubles and caps at eight minutes. It
// expires on its own; nobody has to lift it. See 0027 for why this is a delay
// rather than a lockout.
const FREE_ATTEMPTS = 5;
const BASE_DELAY_SECONDS = 15;
const MAX_DELAY_SECONDS = 480;
const WINDOW_HOURS = 1;

/**
 * Every failure takes at least this long, measured from the moment this function
 * was entered.
 *
 * ONE MESSAGE IS NOT ENOUGH ON ITS OWN, and this was measured rather than
 * assumed: before the floor, an unknown employee number came back a median 293ms
 * FASTER than a known number with a wrong password. That is an enumeration
 * oracle with a stopwatch instead of an error message.
 *
 * It cannot be fixed by making the two paths do equal work. An unknown number
 * stops at the lookup, but even if it were forwarded to GoTrue the gap would
 * remain, because GoTrue is itself slower when the account exists — that is when
 * it has a hash to verify. Equalising work would mean reimplementing bcrypt
 * timing, which is absurd.
 *
 * So: pad instead. A floor hides the difference no matter which branch was taken,
 * covers branches added later, and costs a brute-forcer real time. Successes are
 * NOT padded — the caller already knows whether they got a session, so there is
 * nothing left to hide.
 */
const MIN_FAILURE_MS = 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function delayFor(failedCount: number) {
  const over = failedCount - FREE_ATTEMPTS;
  if (over <= 0) return 0;
  return Math.min(BASE_DELAY_SECONDS * 2 ** (over - 1), MAX_DELAY_SECONDS);
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  /** Every "no" leaves by this door, and they all take the same time to do it. */
  async function refuse() {
    const remaining = MIN_FAILURE_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    return json({ error: GENERIC }, 400);
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  let payload: { identifier?: unknown; password?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const identifier = String(payload.identifier ?? "").trim();
  const password = String(payload.password ?? "");
  if (!identifier || !password) return await refuse();

  const key = identifier.toLowerCase();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- the delay, before anything else is spent on this request -------------
  const { data: attempt } = await admin
    .from("login_attempts")
    .select("failed_count, first_failed, locked_until")
    .eq("identifier", key)
    .maybeSingle();

  const now = Date.now();
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > now) {
    return await refuse();
  }

  // A counter older than the window is stale. Start again rather than holding
  // yesterday's typos against somebody.
  const withinWindow = Boolean(
    attempt?.first_failed &&
      now - new Date(attempt.first_failed).getTime() < WINDOW_HOURS * 3600_000,
  );
  const priorFailures = withinWindow ? (attempt?.failed_count ?? 0) : 0;

  async function recordFailure() {
    const failed = priorFailures + 1;
    const delay = delayFor(failed);
    await admin.from("login_attempts").upsert(
      {
        identifier: key,
        failed_count: failed,
        first_failed: withinWindow ? attempt!.first_failed : new Date(now).toISOString(),
        locked_until: delay ? new Date(now + delay * 1000).toISOString() : null,
      },
      { onConflict: "identifier" },
    );
  }

  // --- resolve the identifier ----------------------------------------------
  let email: string | null = null;
  if (identifier.includes("@")) {
    email = identifier.toLowerCase();
  } else {
    // One definition of sameness, shared with users_employee_id_key. See 0027
    // for why this is an RPC and not a .ilike() built here.
    const { data: found } = await admin.rpc("si_email_by_employee_id", {
      p_employee_id: identifier,
    });
    email = typeof found === "string" && found ? found : null;
  }

  if (!email) {
    await recordFailure();
    return await refuse();
  }

  // --- exchange the credentials -------------------------------------------
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    await recordFailure();
    return await refuse();
  }

  const session = await res.json();

  // Success clears the counter outright: a correct credential is the end of the
  // matter, and leaving the row would carry the delay into the next typo.
  await admin.from("login_attempts").delete().eq("identifier", key);

  // Returned verbatim for the client to hand to supabase.auth.setSession(). The
  // claims inside it are the hook's, exactly as on the direct email path — this
  // function mints nothing and decides nothing about authorization.
  return json({ session });
});
