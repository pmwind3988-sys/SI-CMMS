#!/usr/bin/env node
/**
 * SI — Service Inside · Record an APK build into /apk_builds
 * ============================================================================
 * Reads the real build outputs — it does not take your word for any of it:
 *
 *   versionCode / versionName ... android/app/build.gradle
 *   applicationId ............... android/app/build.gradle
 *   apk file + size + sha256 .... android/app/build/outputs/apk/{type}/*.apk
 *   web bundle id ............... .next/BUILD_ID
 *   git sha / branch ............ git, if this is a repo (it need not be)
 *
 * and writes one document per build so the installed APK can ask "is there a
 * newer one, and am I below the forced-update floor?" with a single read.
 *
 * Usage:
 *   npm run apk                                  # build first
 *   npm run apk:record                           # record the debug build
 *   npm run apk:record -- --type=release --release --notes="First pilot build"
 *
 * Flags:
 *   --type=debug|release   which APK to look for      (default: debug)
 *   --release              mark released:true         (default: false)
 *   --notes="..."          release_notes
 *   --min-version=N        min_supported_version_code — clients below N must
 *                          force-update. Omit to leave the floor unchanged.
 *   --url=https://...      download_url for a hosted APK
 *   --dry-run              print the document, write nothing
 *
 * Target selection is the same as every other script: emulator unless
 * SI_TARGET=live. See scripts/_firebaseAdmin.js.
 * ============================================================================
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { connect, targetLabel } = require("./_firebaseAdmin");
const { APP, BUILD_TYPES } = require("../schema/schema");
const { validateDoc } = require("../schema/validate");

const APP_DIR = path.resolve(__dirname, "..");

/* ---- args ---------------------------------------------------------------- */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const BUILD_TYPE = opt("type", "debug");
const DRY_RUN = flag("dry-run");

if (!BUILD_TYPES.includes(BUILD_TYPE)) {
  console.error(`--type must be one of: ${BUILD_TYPES.join(", ")}`);
  process.exit(1);
}

/* ---- read android/app/build.gradle -------------------------------------- */
function readGradle() {
  const p = path.join(APP_DIR, "android", "app", "build.gradle");
  if (!fs.existsSync(p)) throw new Error(`Not found: ${p}`);
  const src = fs.readFileSync(p, "utf8");

  const pick = (re, label) => {
    const m = src.match(re);
    if (!m) throw new Error(`Could not read ${label} from android/app/build.gradle`);
    return m[1];
  };

  return {
    application_id: pick(/applicationId\s+["']([^"']+)["']/, "applicationId"),
    version_code: Number(pick(/versionCode\s+(\d+)/, "versionCode")),
    version_name: pick(/versionName\s+["']([^"']+)["']/, "versionName"),
  };
}

/* ---- locate the built APK ------------------------------------------------ */
function findApk(buildType) {
  const dir = path.join(APP_DIR, "android", "app", "build", "outputs", "apk", buildType);
  if (!fs.existsSync(dir)) return null;
  const apk = fs.readdirSync(dir).find((f) => f.endsWith(".apk"));
  if (!apk) return null;

  const full = path.join(dir, apk);
  const buf = fs.readFileSync(full);
  return {
    apk_path: path.relative(APP_DIR, full).split(path.sep).join("/"),
    apk_size_bytes: buf.length,
    apk_sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    mtime: fs.statSync(full).mtime,
  };
}

/* ---- the web bundle the APK embeds -------------------------------------- */
function readWebBuildId() {
  const p = path.join(APP_DIR, ".next", "BUILD_ID");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : null;
}

/* ---- git, if there is any ------------------------------------------------ */
function readGit() {
  const run = (args) => {
    try {
      return execFileSync("git", args, { cwd: APP_DIR, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
    } catch {
      return null; // not a repo, or git absent — both fine, both recorded as null
    }
  };
  return { git_sha: run(["rev-parse", "HEAD"]), git_branch: run(["rev-parse", "--abbrev-ref", "HEAD"]) };
}

async function main() {
  const gradle = readGradle();

  if (gradle.application_id !== APP.application_id) {
    console.error(
      `applicationId drift: build.gradle says "${gradle.application_id}", schema/schema.js expects "${APP.application_id}".\n` +
        "One of them is wrong. Fix before recording — a build registry keyed to the wrong app id is worse than none."
    );
    process.exit(1);
  }

  const apk = findApk(BUILD_TYPE);
  if (!apk) {
    console.warn(
      `No ${BUILD_TYPE} APK found under android/app/build/outputs/apk/${BUILD_TYPE}/.\n` +
        `Recording metadata only — file size, hash and path will be null. Run "npm run apk" first for a complete record.`
    );
  }

  const git = readGit();
  const minVersion = opt("min-version");

  const docId = `${BUILD_TYPE}-${gradle.version_name}-${gradle.version_code}`;
  const doc = {
    application_id: gradle.application_id,
    version_name: gradle.version_name,
    version_code: gradle.version_code,
    build_type: BUILD_TYPE,
    web_build_id: readWebBuildId(),
    git_sha: git.git_sha,
    git_branch: git.git_branch,
    apk_path: apk ? apk.apk_path : null,
    apk_size_bytes: apk ? apk.apk_size_bytes : null,
    apk_sha256: apk ? apk.apk_sha256 : null,
    download_url: opt("url", null),
    release_notes: opt("notes", null),
    released: flag("release"),
    min_supported_version_code: minVersion == null ? null : Number(minVersion),
    built_at: apk ? Timestamp.fromDate(apk.mtime) : FieldValue.serverTimestamp(),
    built_by: process.env.USERNAME || process.env.USER || null,
    updated_at: FieldValue.serverTimestamp(),
  };

  const { ok, errors, warnings } = validateDoc("apk_builds", { ...doc, created_at: doc.updated_at });
  warnings.forEach((w) => console.warn(`  ! ${w}`));
  if (!ok) {
    console.error("\nRefusing to write — schema problems:");
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }

  const printable = { ...doc, built_at: apk ? apk.mtime.toISOString() : "<server timestamp>", updated_at: "<server timestamp>" };
  console.log(`\nTarget: ${targetLabel()}`);
  console.log(`Document: apk_builds/${docId}\n`);
  console.log(JSON.stringify(printable, null, 2));

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const { db } = connect();
  const ref = db.collection("apk_builds").doc(docId);
  const existing = await ref.get();

  await ref.set(
    existing.exists ? doc : { ...doc, created_at: FieldValue.serverTimestamp() },
    { merge: true }
  );

  console.log(`\n${existing.exists ? "Updated" : "Recorded"} apk_builds/${docId}.`);
  if (doc.released) {
    console.log(`Marked RELEASED — clients on version_code < ${gradle.version_code} will now see an update available.`);
  }
  if (doc.min_supported_version_code != null) {
    console.log(`Force-update floor set to version_code ${doc.min_supported_version_code}.`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
