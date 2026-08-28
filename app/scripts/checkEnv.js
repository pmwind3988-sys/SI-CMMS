/**
 * SI — Service Inside · env sanity check
 * ============================================================================
 * Answers one question before you waste time on a script that appears to work:
 * is app/.env.local pointing at the right project with the right keys?
 *
 * It exists because the failure mode is silent. Put the anon key in
 * SUPABASE_SERVICE_ROLE_KEY and nothing throws — Row Level Security is applied
 * instead of bypassed, so every read comes back as an empty array and every
 * write is refused. Scripts then report "0 rows" or "nothing to do", which
 * reads like a fact about the database rather than a fact about your key.
 *
 * Prints key *kinds* and never key material.
 *
 *   npm run check:env
 * ============================================================================
 */
const { admin, projectLabel } = require("./_supabaseAdmin");

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
];

/** The kind of a key, by prefix and — for legacy JWTs — by its role claim. */
function kindOf(value) {
  if (!value) return "missing or empty";
  if (value.startsWith("sb_secret_")) return "secret key (service role)";
  if (value.startsWith("sb_publishable_")) return "publishable key (anon)";
  if (value.startsWith("https://")) return "url";
  if (value.startsWith("eyJ")) {
    try {
      const role = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8")).role;
      return `legacy JWT, role='${role ?? "none"}'`;
    } catch {
      return "JWT that will not decode";
    }
  }
  return "unrecognised shape";
}

async function main() {
  console.log(`project: ${projectLabel()}\n`);

  let bad = 0;
  for (const name of REQUIRED) {
    // NEXT_PUBLIC_VAPID_PUBLIC_KEY is a base64url-encoded uncompressed EC
    // point, not a URL and not a JWT — kindOf() has no shape for it and would
    // call it "unrecognised shape" even when it is exactly right. Presence
    // and length are what generateVapidKeys.js's own printout already checks
    // ("Public key length: ... (expect 87)"), so that is what this validates
    // instead of trying to classify it.
    if (name === "NEXT_PUBLIC_VAPID_PUBLIC_KEY") {
      const value = process.env[name] || "";
      const ok = value.length === 87;
      if (!ok) bad++;
      console.log(
        `  ${(ok ? "ok" : "WRONG").padEnd(5)}  ${name.padEnd(31)} ` +
        (value ? `${value.length} chars (expect 87)` : "missing or empty")
      );
      continue;
    }

    const kind = kindOf(process.env[name]);
    const ok =
      (name === "SUPABASE_SERVICE_ROLE_KEY" && /service.role/.test(kind)) ||
      (name === "NEXT_PUBLIC_SUPABASE_ANON_KEY" && /anon/.test(kind)) ||
      (name === "NEXT_PUBLIC_SUPABASE_URL" && kind === "url");
    if (!ok) bad++;
    console.log(`  ${(ok ? "ok" : "WRONG").padEnd(5)}  ${name.padEnd(31)} ${kind}`);
  }

  if (bad) {
    console.log(
      "\nThe service role secret is Project Settings -> API Keys -> secret (sb_secret_...).\n" +
        "On the Legacy API keys panel instead, anon and service_role are both JWTs and look\n" +
        "alike; the service_role one is masked until you click Reveal. If you could copy it\n" +
        "without revealing it, you copied anon."
    );
    process.exit(1);
  }

  // Shape is right; now prove it. A PostgREST read is only a connectivity check
  // — an anon key returns [] here without erroring, which is exactly the
  // ambiguity this script exists to remove. The admin API is the decisive one:
  // it refuses anything that is not the service role outright.
  const db = admin();
  const { error } = await db.from("users").select("id").limit(1);
  if (error) {
    console.log(`\nWRONG  the API rejected a plain read: ${error.message}`);
    process.exit(1);
  }

  const { data: users, error: e2 } = await db.auth.admin.listUsers({ perPage: 1 });
  if (e2) {
    console.log(`\nWRONG  admin API refused the key: ${e2.message}`);
    process.exit(1);
  }

  console.log(`\nok    service role key bypasses RLS and reaches the admin API (${users.users.length ? "users present" : "no users"}).`);
}

main().catch((e) => {
  console.error(`\n${e.message || e}`);
  process.exit(1);
});
