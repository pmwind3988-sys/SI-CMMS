#!/usr/bin/env node
/**
 * SI — Service Inside · Schema drift check
 * ============================================================================
 * schema/schema.js is only useful while it still describes reality. This
 * checks it against the files it was derived from, and fails loudly when they
 * have moved apart:
 *
 *   - every collection with a match block in firestore.rules is in COLLECTIONS
 *     (and vice versa)
 *   - every collectionGroup in firestore.indexes.json is a known collection
 *   - every indexed fieldPath exists in that collection's field list
 *   - status literals in schema.js match those in firestore.rules
 *   - applicationId in build.gradle matches APP.application_id
 *   - reference-data ids in schema.js still match src/lib/constants.js
 *
 * Needs no database. Run it in CI, or before deploying rules.
 *
 *   npm run schema:check
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");
const schema = require("../schema/schema");

const APP_DIR = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(APP_DIR, rel), "utf8");

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const note = (m) => notes.push(m);

/* ---- 1. rules ↔ COLLECTIONS --------------------------------------------- */
const rules = read("firestore.rules");
// `databases` is the /databases/{database}/documents root, not a collection.
const ruleCollections = [...rules.matchAll(/match\s+\/([a-z_]+)\/\{/g)]
  .map((m) => m[1])
  .filter((c) => c !== "databases");
const schemaCollections = Object.keys(schema.COLLECTIONS);

for (const c of ruleCollections) {
  if (!schemaCollections.includes(c)) {
    fail(`firestore.rules has a match block for /${c} but schema.js has no COLLECTIONS entry. Every MCP tool and the validator are blind to it.`);
  }
}
for (const c of schemaCollections) {
  if (!ruleCollections.includes(c)) {
    fail(`schema.js declares "${c}" but firestore.rules has no match block for it — it is unreachable from any client (default deny).`);
  }
}

/* ---- 2. indexes ↔ COLLECTIONS ------------------------------------------- */
const indexes = JSON.parse(read("firestore.indexes.json"));
for (const idx of indexes.indexes || []) {
  const c = idx.collectionGroup;
  const def = schema.COLLECTIONS[c];
  if (!def) {
    fail(`firestore.indexes.json indexes collectionGroup "${c}", which is not in schema.js.`);
    continue;
  }
  const fields = Object.keys(def.fields || {});
  if (!fields.length) continue; // shape-described collection, e.g. stats
  for (const f of idx.fields || []) {
    if (f.fieldPath && f.fieldPath !== "__name__" && !fields.includes(f.fieldPath)) {
      fail(`Index on ${c} references field "${f.fieldPath}", which is not in that collection's schema. Typo, or schema.js is behind.`);
    }
  }
}

/* ---- 3. status literals ↔ rules ----------------------------------------- */
for (const s of schema.STATUS_FLOW) {
  if (!rules.includes(`"${s}"`)) {
    // Not every status is named in the rules (terminal ones need no clause);
    // report as a note so a genuine rename still surfaces without noise.
    note(`Status "${s}" does not appear literally in firestore.rules — expected for statuses with no transition clause, suspicious otherwise.`);
  }
}
for (const t of schema.STATUS_TRANSITIONS) {
  for (const req of t.requires) {
    if (req !== "assigned_to_id" && req !== "verified_by" && !rules.includes(req)) {
      fail(`Transition ${t.from} → ${t.to} claims firestore.rules requires "${req}", but that field does not appear in the rules.`);
    }
  }
}

/* ---- 4. build.gradle ↔ APP ---------------------------------------------- */
const gradlePath = path.join(APP_DIR, "android", "app", "build.gradle");
if (fs.existsSync(gradlePath)) {
  const gradle = fs.readFileSync(gradlePath, "utf8");
  const m = gradle.match(/applicationId\s+["']([^"']+)["']/);
  if (!m) {
    fail("Could not read applicationId from android/app/build.gradle.");
  } else if (m[1] !== schema.APP.application_id) {
    fail(`applicationId drift: build.gradle "${m[1]}" vs schema.js APP.application_id "${schema.APP.application_id}".`);
  }
} else {
  note("android/app/build.gradle not found — skipped the APK identity check.");
}

/* ---- 5. reference data ↔ constants.js ----------------------------------- */
const constants = read("src/lib/constants.js");
// Anchor on the `id:` key itself — an unanchored /id:/ also matches
// `department_id:` and would report every department as a missing asset.
const idsIn = (block) => [...block.matchAll(/(?:^|[{,\s])id:\s*"([^"]+)"/g)].map((m) => m[1]);
const blockOf = (name) => {
  const start = constants.indexOf(`export const ${name} = [`);
  if (start === -1) return null;
  const end = constants.indexOf("];", start);
  return constants.slice(start, end);
};

const pairs = [
  ["DEPARTMENTS", schema.DEPARTMENTS.map((d) => d.id), "departments"],
  ["EQUIPMENT", schema.ASSETS.map((a) => a.id), "assets"],
  ["TECHNICIANS", schema.TECHNICIANS.map((t) => t.id), "technicians"],
];

for (const [constName, schemaIds, collection] of pairs) {
  const block = blockOf(constName);
  if (!block) {
    note(`src/lib/constants.js no longer exports ${constName} — if it was migrated to /${collection}, drop it from schema.js's seed data too.`);
    continue;
  }
  const constIds = idsIn(block);
  const missing = constIds.filter((id) => !schemaIds.includes(id));
  const extra = schemaIds.filter((id) => !constIds.includes(id));
  if (missing.length) fail(`${constName} in constants.js has ids not in schema.js seed data: ${missing.join(", ")}. They will never reach /${collection}.`);
  if (extra.length) note(`schema.js seeds ids into /${collection} that constants.js does not list: ${extra.join(", ")}. Fine if intentional.`);
}

/* ---- 6. internal consistency -------------------------------------------- */
for (const t of schema.STATUS_TRANSITIONS) {
  if (!schema.STATUS_FLOW.includes(t.from)) fail(`STATUS_TRANSITIONS references unknown from-status "${t.from}".`);
  if (!schema.STATUS_FLOW.includes(t.to)) fail(`STATUS_TRANSITIONS references unknown to-status "${t.to}".`);
  for (const r of t.roles) if (!schema.ROLES.includes(r)) fail(`STATUS_TRANSITIONS references unknown role "${r}".`);
}
for (const [name, def] of Object.entries(schema.COLLECTIONS)) {
  for (const [field, spec] of Object.entries(def.fields || {})) {
    if (spec.ref && !schema.COLLECTIONS[spec.ref]) {
      fail(`${name}.${field} references collection "${spec.ref}", which does not exist.`);
    }
    if (spec.enum && !Array.isArray(spec.enum)) fail(`${name}.${field} has a non-array enum.`);
  }
}
for (const code of schema.PRIORITY_CODES) {
  if (!schema.SLA_TARGETS[code]) fail(`Priority ${code} has no SLA_TARGETS entry.`);
  if (!schema.PRIORITY_META[code]) fail(`Priority ${code} has no PRIORITY_META entry.`);
}

/* ---- report ------------------------------------------------------------- */
console.log(`Checked ${schemaCollections.length} collections, ${(indexes.indexes || []).length} indexes, ${schema.STATUS_TRANSITIONS.length} transitions.\n`);

if (notes.length) {
  console.log("Notes:");
  notes.forEach((n) => console.log(`  · ${n}`));
  console.log("");
}

if (problems.length) {
  console.error(`FAILED — ${problems.length} drift problem(s):`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}

console.log("OK — schema.js matches firestore.rules, firestore.indexes.json, build.gradle and constants.js.");
