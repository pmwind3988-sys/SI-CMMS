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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function projectLabel() {
  if (!URL) return "(no NEXT_PUBLIC_SUPABASE_URL)";
  try {
    return `${new URL(URL).hostname.split(".")[0]} (${URL})`;
  } catch {
    return URL;
  }
}

let cached = null;

function admin() {
  if (cached) return cached;

  if (!URL) {
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
  if (SERVICE_KEY.startsWith("sb_publishable_") || SERVICE_KEY.includes('"role":"anon"')) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY looks like a publishable/anon key, not the service role key.\n" +
        "  These scripts write past Row Level Security and need the service_role secret."
    );
  }

  cached = createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

module.exports = { admin, projectLabel };
