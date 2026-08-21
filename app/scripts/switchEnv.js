/**
 * SI — Service Inside · environment switch
 * ============================================================================
 * Points the whole toolchain at production or at the test project, in one step.
 *
 *   npm run env:test     switch to SI-CMMS-test
 *   npm run env:prod     switch to SI-CMMS (production)
 *   npm run env:which    say which one is active, change nothing
 *
 * TWO things point at a Supabase project, and this exists because moving one
 * without the other is the accident that costs a production database:
 *
 *   1. app/.env.local              — what the app and the scripts in scripts/ read
 *   2. supabase/.temp/project-ref  — what `db push` and `db:types` write to
 *
 * Move only (1) and `npm run db:push` applies your untested migration to
 * production while the app you are staring at reads test. Nothing warns you:
 * both commands succeed. So this script always moves both, and refuses to call
 * itself done if it could not move the second.
 *
 * The real values live in app/.env.prod.local and app/.env.test.local, which
 * are gitignored by the same `.env*.local` rule that already covers .env.local.
 * .env.local is a GENERATED FILE from here on — edit the source files and
 * re-run the switch, or the change is gone the next time you flip.
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const APP_DIR = path.resolve(__dirname, "..");
const TARGETS = {
  prod: { file: ".env.prod.local", label: "PRODUCTION (SI-CMMS)" },
  test: { file: ".env.test.local", label: "TEST (SI-CMMS-test)" },
};

const REQUIRED = [
  "SI_ENV_NAME",
  "SI_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

/** The same minimal reader _supabaseAdmin.js uses; these scripts run outside the bundler. */
function parseEnvFile(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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
    out[key] = value;
  }
  return out;
}

/** The project ref inside a https://<ref>.supabase.co URL, or null. */
function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(url || "");
  return m ? m[1] : null;
}

/**
 * The kind of a key, by prefix and — for legacy JWTs — by its role claim.
 * Lifted from checkEnv.js deliberately: an anon key sitting in
 * SUPABASE_SERVICE_ROLE_KEY does not throw. It makes every script report
 * "no rows", because RLS is applied instead of bypassed.
 */
function kindOf(value) {
  if (!value) return "missing or empty";
  if (value.startsWith("sb_secret_")) return "service";
  if (value.startsWith("sb_publishable_")) return "anon";
  if (value.startsWith("eyJ")) {
    try {
      const role = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8")).role;
      if (role === "service_role") return "service";
      if (role === "anon") return "anon";
      return `a JWT for the '${role ?? "none"}' role`;
    } catch {
      return "a JWT that will not decode";
    }
  }
  return "an unrecognised shape";
}

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Validates one env file and returns its parsed contents. */
function loadTarget(name) {
  const { file, label } = TARGETS[name];
  const env = parseEnvFile(path.join(APP_DIR, file));

  if (!env) {
    die(
      `${file} does not exist, so there is nothing to switch to.\n` +
        `  It holds the ${label} values. See app/TEST_ENVIRONMENT.md.`
    );
  }

  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) die(`${file} is missing: ${missing.join(", ")}`);

  if (env.SI_ENV_NAME !== name) {
    die(`${file} says SI_ENV_NAME=${env.SI_ENV_NAME}, but it is the '${name}' file. One of the two is wrong.`);
  }

  // A half-edited file is the dangerous state: the marker says test while the
  // URL still says production, so the switch reports success and points at prod.
  const urlRef = refFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!urlRef) die(`${file}: NEXT_PUBLIC_SUPABASE_URL is not a https://<ref>.supabase.co URL.`);
  if (urlRef !== env.SI_PROJECT_REF) {
    die(
      `${file} disagrees with itself:\n` +
        `  SI_PROJECT_REF           ${env.SI_PROJECT_REF}\n` +
        `  NEXT_PUBLIC_SUPABASE_URL ${urlRef}\n` +
        `  Refusing to switch — one of these would silently win.`
    );
  }

  const anonKind = kindOf(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const svcKind = kindOf(env.SUPABASE_SERVICE_ROLE_KEY);
  if (anonKind !== "anon") {
    die(`${file}: NEXT_PUBLIC_SUPABASE_ANON_KEY is ${anonKind}, not the anon key.`);
  }
  if (svcKind !== "service") {
    die(
      `${file}: SUPABASE_SERVICE_ROLE_KEY is ${svcKind}, not the service role key.\n` +
        `  If this slips through, every script reports "no rows" instead of "wrong key".`
    );
  }

  return { env, file, label };
}

/** Both files naming the same project makes a switch a no-op that reads as a switch. */
function assertDistinct(name) {
  const other = name === "prod" ? "test" : "prod";
  const otherEnv = parseEnvFile(path.join(APP_DIR, TARGETS[other].file));
  const mine = parseEnvFile(path.join(APP_DIR, TARGETS[name].file));
  if (otherEnv && otherEnv.SI_PROJECT_REF && otherEnv.SI_PROJECT_REF === mine.SI_PROJECT_REF) {
    die(
      `${TARGETS.prod.file} and ${TARGETS.test.file} both point at ${mine.SI_PROJECT_REF}.\n` +
        `  Switching would do nothing while looking like it did something.`
    );
  }
}

/** Reads .env.local and works out what it currently points at. */
function currentTarget() {
  const env = parseEnvFile(path.join(APP_DIR, ".env.local"));
  if (!env) return { name: null, ref: null, note: "app/.env.local does not exist" };

  const ref = env.SI_PROJECT_REF || refFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (env.SI_ENV_NAME && TARGETS[env.SI_ENV_NAME]) return { name: env.SI_ENV_NAME, ref };

  // No marker: an .env.local written before this script existed. Match by ref.
  for (const [name, { file }] of Object.entries(TARGETS)) {
    const t = parseEnvFile(path.join(APP_DIR, file));
    if (t && t.SI_PROJECT_REF === ref) {
      return { name, ref, note: "matched by project ref; no SI_ENV_NAME marker" };
    }
  }
  return { name: null, ref, note: "unrecognised — matches neither env file" };
}

/** The Supabase CLI's own entry point, so it can be run without a shell. */
function cliEntry() {
  try {
    return require.resolve("supabase/dist/supabase.js", { paths: [APP_DIR] });
  } catch {
    die(
      "The supabase CLI package is not installed.\n" +
        "  Run `npm install` in app/, then try the switch again."
    );
  }
}

/** What supabase/.temp/project-ref says, which is where db push would write. */
function linkedRef() {
  const p = path.join(APP_DIR, "supabase", ".temp", "project-ref");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : null;
}

function reportWhich() {
  const cur = currentTarget();
  const linked = linkedRef();
  const label = cur.name ? TARGETS[cur.name].label : "UNKNOWN";

  console.log(`\n  app/.env.local  ->  ${label}`);
  console.log(`  project ref     ->  ${cur.ref ?? "(none)"}${cur.note ? `   [${cur.note}]` : ""}`);
  console.log(`  supabase CLI    ->  ${linked ?? "(not linked)"}`);

  if (linked && cur.ref && linked !== cur.ref) {
    console.log(
      `\n  MISMATCH. The app reads ${cur.ref}, and \`db push\` would write to ${linked}.\n` +
        `  Run \`npm run env:${cur.name ?? "prod"}\` to bring them back into step.\n`
    );
    process.exit(1);
  }
  console.log("");
}

function switchTo(name) {
  const { env, file, label } = loadTarget(name);
  assertDistinct(name);

  const banner =
    `# GENERATED FILE — do not edit.\n` +
    `# Written by scripts/switchEnv.js from ${file}.\n` +
    `# Active target: ${label}\n` +
    `# Edit ${file} and re-run \`npm run env:${name}\`; edits here are lost on the next switch.\n` +
    `#\n`;

  fs.writeFileSync(
    path.join(APP_DIR, ".env.local"),
    banner + fs.readFileSync(path.join(APP_DIR, file), "utf8"),
    "utf8"
  );

  // Move the CLI's target in the same breath. If this fails the two are out of
  // step — the exact state this script exists to prevent — so say so loudly and
  // exit non-zero rather than printing a success line.
  console.log(`\n  .env.local  ->  ${label}`);
  console.log(`  linking the Supabase CLI to ${env.SI_PROJECT_REF} ...\n`);

  // The database password goes through the environment, never `--password`. The
  // CLI reads SUPABASE_DB_PASSWORD either way, and an argument would end up
  // concatenated into a command line.
  //
  // The CLI is run as `node node_modules/supabase/dist/supabase.js`, not as
  // `npx supabase`. Node 24 refuses to spawn a .cmd shim without shell:true
  // (EINVAL), and turning the shell on to work around that is what puts
  // arguments back on a command line. Calling the package's own entry point
  // needs no shell at all.
  const r = spawnSync(process.execPath, [cliEntry(), "link", "--project-ref", env.SI_PROJECT_REF], {
    cwd: APP_DIR,
    stdio: "inherit",
    env: env.SUPABASE_DB_PASSWORD
      ? { ...process.env, SUPABASE_DB_PASSWORD: env.SUPABASE_DB_PASSWORD }
      : process.env,
  });
  if (r.status !== 0) {
    die(
      `supabase link failed.\n` +
        `  app/.env.local now points at ${label}, but the CLI still points at ${linkedRef() ?? "nothing"}.\n` +
        `  DO NOT run db:push until these agree. Fix the link, then \`npm run env:which\`.`
    );
  }

  const linked = linkedRef();
  if (linked !== env.SI_PROJECT_REF) {
    die(`supabase link reported success, but supabase/.temp/project-ref says ${linked}. Refusing to call this done.`);
  }

  const rule = "=".repeat(64);
  console.log(`\n  ${rule}`);
  console.log(`   NOW ON: ${label}`);
  console.log(`   ref:    ${env.SI_PROJECT_REF}`);
  console.log(`  ${rule}`);
  console.log(
    `\n  Restart \`npm run dev\` if it is running. Next inlines NEXT_PUBLIC_* at\n` +
      `  build time, so a live dev server keeps the old project and the switch\n` +
      `  looks as though it did nothing.\n` +
      `\n  \`npm run check:env\` confirms the keys actually reach this project.\n`
  );
}

const arg = (process.argv[2] || "").toLowerCase();
if (arg === "which" || arg === "") reportWhich();
else if (TARGETS[arg]) switchTo(arg);
else die("Usage: node scripts/switchEnv.js <prod|test|which>");
