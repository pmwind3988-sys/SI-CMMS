/**
 * SI — Service Inside · copy the reference configuration into the test project
 * ============================================================================
 *   npm run clone:config                copy production's config into test
 *   npm run clone:config -- --dry-run   report what would change, write nothing
 *   npm run clone:config -- --prune     also delete rows production does not have
 *
 * Copies the tables that describe the *plant* — its departments, its equipment,
 * and the labels/colours/SLA targets attached to the enum-keyed lookups — so the
 * pickers in the test app read like the real thing.
 *
 * It copies no people and no work. `users`, `technicians`, `work_orders`,
 * `work_order_history`, `comments`, `attachments`, `notifications`,
 * `login_attempts`, `stats` and `counters` are all left alone: the test project
 * gets the six @example.com fixtures from `npm run bootstrap:users` instead, and
 * starts its work-order numbering at 1. No real person's name, address or
 * password hash ever leaves production.
 *
 * THREE PROPERTIES, and they are why this is its own script rather than a flag
 * on an existing one:
 *
 *   1. It reads .env.prod.local and .env.test.local DIRECTLY, never .env.local.
 *      Its behaviour therefore does not depend on which way the switch is
 *      currently thrown — running it while you happen to be on test cannot
 *      reverse it.
 *   2. The direction is hardcoded. There is no argument, flag or environment
 *      variable that makes this write to production.
 *   3. It refuses to start if the two files resolve to the same project.
 *
 * Rows are inserted or updated by primary key. Nothing is deleted unless you
 * ask with --prune, so a department you added in test by hand survives a
 * re-clone. What --prune is actually for is migration 0006's seed data: a fresh
 * project gets DEPT-QUALITY and five AST-0*** machines that production replaced
 * long ago, and they sit in the equipment and department pickers looking real.
 * A row a test work order already references survives --prune too — the delete
 * is refused by its foreign key, which is the right answer, and the refusal is
 * reported rather than thrown.
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const APP_DIR = path.resolve(__dirname, "..");
const SOURCE_FILE = ".env.prod.local";
const TARGET_FILE = ".env.test.local";
const PAGE = 1000; // Supabase caps a response at 1000 rows, silently.

/**
 * The tables copied, in dependency order.
 *
 * `nulled` columns are foreign keys onto `users`, which this script deliberately
 * does not copy. Carried across as-is they would reference a uuid that does not
 * exist in test and the insert would be refused — so the reference is dropped
 * and the fact is reported at the end rather than hidden.
 */
const TABLES = [
  { name: "plants", pk: "id" },
  { name: "departments", pk: "id", nulled: ["manager_id"] },
  { name: "assets", pk: "id" },
  { name: "priorities", pk: "id" },
  { name: "impact_levels", pk: "code" },
  { name: "wo_types", pk: "code" },
  { name: "safety_severities", pk: "code" },
  { name: "wo_statuses", pk: "code" },
  { name: "sla", pk: "id" },
  { name: "role_permissions", pk: "role", nulled: ["updated_by"] },
];

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function load(file, expectedEnvName) {
  const env = parseEnvFile(path.join(APP_DIR, file));
  if (!env) die(`${file} does not exist. See app/TEST_ENVIRONMENT.md.`);
  if (env.SI_ENV_NAME !== expectedEnvName) {
    die(`${file} says SI_ENV_NAME=${env.SI_ENV_NAME}, expected '${expectedEnvName}'. Refusing to guess.`);
  }
  for (const k of ["SI_PROJECT_REF", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[k]) die(`${file} is missing ${k}.`);
  }
  return env;
}

/** Reads every row of a table, a page at a time. */
async function readAll(db, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prune = process.argv.includes("--prune");

  const source = load(SOURCE_FILE, "prod");
  const target = load(TARGET_FILE, "test");

  if (source.SI_PROJECT_REF === target.SI_PROJECT_REF) {
    die(
      `${SOURCE_FILE} and ${TARGET_FILE} both point at ${source.SI_PROJECT_REF}.\n` +
        `  This script would then be copying a project onto itself. Refusing.`
    );
  }

  const from = createClient(source.NEXT_PUBLIC_SUPABASE_URL, source.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const to = createClient(target.NEXT_PUBLIC_SUPABASE_URL, target.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`\n  from  ${source.SI_PROJECT_REF}  (production, read only)`);
  console.log(`  to    ${target.SI_PROJECT_REF}  (test)`);
  console.log(dryRun ? "\n  DRY RUN — nothing will be written.\n" : "");

  const nulledTotals = {};
  const extras = [];
  let grandTotal = 0;

  for (const { name, pk, nulled = [] } of TABLES) {
    const rows = await readAll(from, name);

    // Rows the target has and the source does not. Not deleted — a department
    // you added in test by hand has every right to be here, and so does one
    // that migration 0006 seeded and production has since dropped. But silence
    // would let test drift from production invisibly, so they are named.
    const sourceKeys = new Set(rows.map((r) => r[pk]));
    for (const row of await readAll(to, name)) {
      if (!sourceKeys.has(row[pk])) {
        extras.push({ table: name, pk, value: row[pk], label: `${name}.${pk}=${row[pk]}` });
      }
    }

    for (const row of rows) {
      for (const col of nulled) {
        if (row[col] != null) {
          row[col] = null;
          nulledTotals[`${name}.${col}`] = (nulledTotals[`${name}.${col}`] ?? 0) + 1;
        }
      }
    }

    if (!rows.length) {
      console.log(`  ${name.padEnd(20)} 0 rows — nothing to copy`);
      continue;
    }

    if (!dryRun) {
      const { error } = await to.from(name).upsert(rows, { onConflict: pk });
      if (error) throw new Error(`writing ${name}: ${error.message}`);
    }

    grandTotal += rows.length;
    console.log(`  ${name.padEnd(20)} ${String(rows.length).padStart(4)} rows ${dryRun ? "would be" : ""} copied`);
  }

  const notes = Object.entries(nulledTotals);
  if (notes.length) {
    console.log(`\n  Dropped, because the users they reference are not copied:`);
    for (const [col, n] of notes) console.log(`    ${col.padEnd(30)} ${n} reference${n === 1 ? "" : "s"} set to null`);
  }

  if (extras.length && !prune) {
    console.log(
      `\n  Present in test and not in production — left alone, not deleted:\n` +
        extras.map((e) => `    ${e.label}`).join("\n") +
        `\n\n  Most of these are migration 0006's seed rows, which production has since\n` +
        `  replaced with the real plant. They show up in the equipment and department\n` +
        `  pickers, so if the point is for test to read like production:\n` +
        `      npm run clone:config -- --prune\n`
    );
  }

  if (extras.length && prune && !dryRun) {
    console.log(`\n  Pruning ${extras.length} row(s) that production does not have:`);
    for (const { table, pk, value, label } of extras) {
      const { error } = await to.from(table).delete().eq(pk, value);
      // A row a test work order already references cannot go, and should not:
      // the record that points at it would lose its label. Report and continue.
      console.log(`    ${error ? "kept  " : "deleted"} ${label}${error ? ` — ${error.message}` : ""}`);
    }
  }

  console.log(`\n  ${grandTotal} rows total.`);
  if (!dryRun) {
    console.log(
      `\n  Not copied, deliberately: users, technicians, work_orders,\n` +
        `  work_order_history, comments, attachments, notifications,\n` +
        `  login_attempts, stats, counters.\n`
    );
  }
}

main().catch((e) => {
  console.error(`\n${e.message || e}\n`);
  process.exit(1);
});
