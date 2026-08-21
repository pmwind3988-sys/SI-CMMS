/**
 * SI — Service Inside · Supabase service-role connector
 * ============================================================================
 * One place that decides which Supabase project every script talks to, so
 * nothing can accidentally write demo data into production because one file had
 * a different default.
 *
 * This replaces scripts/_firebaseAdmin.js. The emulator-first default that file
 * had is gone along with the emulator: there is one hosted project, and the
 * guard that matters now is a different one — the service role key bypasses Row
 * Level Security completely, so it must never be bundled, never be prefixed
 * NEXT_PUBLIC_, and never be set in Vercel. It lives in app/.env.local, which is
 * gitignored, and is read only by scripts that run on your own machine.
 *
 * Setup:
 *   Supabase Dashboard -> Project Settings -> API -> service_role (click to
 *   reveal), then put it in app/.env.local as SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage:
 *   const { admin, projectLabel } = require("./_supabaseAdmin");
 *   const db = admin();
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const APP_DIR = path.resolve(__dirname, "..");

/**
 * Minimal .env.local reader. Deliberately not a dependency: these scripts run
 * outside the Next.js bundler, which is what would normally load .env.local.
 */
function loadEnvLocal() {
  const p = path.join(APP_DIR, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const rawLine of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

// Named SUPABASE_URL, not URL. A module-scope `const URL` shadows the global
// URL constructor, so `new URL(...)` below threw TypeError on every call and the
// catch returned the bare address — the ref this label exists to show was never
// printed by anything, including check:env.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** The project ref of whichever project .env.local currently points at, or null. */
function activeRef() {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(SUPABASE_URL || "");
  return m ? m[1] : null;
}

function projectLabel() {
  if (!SUPABASE_URL) return "(no NEXT_PUBLIC_SUPABASE_URL)";
  const ref = activeRef();
  return ref ? `${ref} (${SUPABASE_URL})` : SUPABASE_URL;
}

/**
 * Names the key kind if it is the wrong one, or returns null if it looks like a
 * service role key.
 *
 * The previous version of this check tested `key.includes('"role":"anon"')`,
 * which only matches decoded JSON — a legacy JWT carries its claims base64
 * encoded, so pasting the legacy *anon* key here sailed straight past the guard
 * the guard exists to be. Decode the payload and read the claim.
 *
 * Never logs or returns key material, only the kind.
 */
function describeWrongKey(key) {
  if (key.startsWith("sb_secret_")) return null;
  if (key.startsWith("sb_publishable_")) return "a publishable (anon) key";

  if (key.startsWith("eyJ")) {
    let role;
    try {
      role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role;
    } catch {
      return "a JWT whose payload will not decode";
    }
    if (role === "service_role") return null;
    return role ? `a legacy JWT for the '${role}' role` : "a JWT with no role claim";
  }

  return "not a shape this script recognises (expected sb_secret_... or a legacy JWT)";
}

let cached = null;

function admin() {
  if (cached) return cached;

  if (!SUPABASE_URL) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set.\n" +
        "  Add it to app/.env.local (Supabase Dashboard -> Project Settings -> API)."
    );
  }
  if (!SERVICE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
        "  Supabase Dashboard -> Project Settings -> API -> service_role (click to reveal),\n" +
        "  then add it to app/.env.local. It bypasses Row Level Security, so it must never\n" +
        "  be committed, never be prefixed NEXT_PUBLIC_, and never be set in Vercel."
    );
  }
  const wrongKey = describeWrongKey(SERVICE_KEY);
  if (wrongKey) {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY is ${wrongKey}, not the service role key.\n` +
        "  These scripts write past Row Level Security and need the service_role secret:\n" +
        "  Supabase Dashboard -> Project Settings -> API Keys -> secret (sb_secret_...),\n" +
        "  or under Legacy API keys, the row labelled service_role.\n" +
        "\n" +
        "  Symptom if this slips through: every read comes back empty and every write is\n" +
        "  denied, because RLS is being applied instead of bypassed. Empty is not an error,\n" +
        "  so scripts report 'no rows' rather than 'wrong key'."
    );
  }

  cached = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

/**
 * Refuses to run a data-writing script against production.
 *
 * There are two projects now — production and SI-CMMS-test — and `npm run
 * env:test` / `env:prod` flips between them by rewriting .env.local. That makes
 * a new accident possible that could not happen when there was one project:
 * forgetting which way the switch is thrown and seeding demo work orders, or
 * resetting the six fixture passwords, on the live system.
 *
 * Production is identified by the SI_PROJECT_REF in app/.env.prod.local rather
 * than by a ref hardcoded here, so this keeps working if the project is ever
 * moved or rebuilt.
 *
 *   node scripts/seedDemoWorkOrder.js --force    do it anyway
 *
 * If .env.prod.local is absent we cannot tell the two apart. That warns rather
 * than blocks: someone working from a single .env.local the way this repo did
 * before the split should not be stopped by a guard that has nothing to compare
 * against.
 */
function guardProductionWrite(what) {
  const prodEnv = path.join(APP_DIR, ".env.prod.local");
  const active = activeRef();

  if (!fs.existsSync(prodEnv)) {
    console.log(
      `  (cannot tell test from production: app/.env.prod.local is absent,\n` +
        `   so ${what} is running unguarded against ${active ?? "an unknown project"}.)\n`
    );
    return;
  }

  const match = /^\s*SI_PROJECT_REF\s*=\s*(\S+)\s*$/m.exec(fs.readFileSync(prodEnv, "utf8"));
  const prodRef = match ? match[1] : null;
  if (!prodRef || !active || active !== prodRef) return;

  if (process.argv.includes("--force")) {
    console.log(`  --force given: running ${what} against PRODUCTION (${prodRef}).\n`);
    return;
  }

  console.error(
    `\n  REFUSED — ${what} writes data, and .env.local points at PRODUCTION (${prodRef}).\n` +
      `\n  Switch first:      npm run env:test` +
      `\n  Check any time:    npm run env:which` +
      `\n  Or, deliberately:  npm run ${what} -- --force\n`
  );
  process.exit(1);
}

module.exports = { admin, projectLabel, activeRef, guardProductionWrite };
