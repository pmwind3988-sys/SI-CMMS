/**
 * SI — Service Inside · Admin SDK connector
 * ============================================================================
 * Emulator-first, live-ready. One place that decides which Firestore every
 * script and the MCP server talks to, so nothing can accidentally write demo
 * data into production because one file had a different default.
 *
 * The default is the EMULATOR. Reaching the live project takes a deliberate
 * SI_TARGET=live plus real credentials — an env var you have to mean to set,
 * not one you can drift into.
 *
 *   SI_TARGET=emulator   (default)  → 127.0.0.1:8080 / :9099, fake credentials
 *   SI_TARGET=live                  → applicationDefault(), real project
 *
 * Live credentials — either works:
 *   (a) gcloud user credentials (no key file; the route to use when the org
 *       policy iam.disableServiceAccountKeyCreation blocks key downloads):
 *         gcloud auth application-default login
 *         GOOGLE_CLOUD_PROJECT=si-cmms       ← required, user creds name no project
 *   (b) a service account key JSON:
 *         GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
 *
 * Overrides:
 *   FIRESTORE_EMULATOR_HOST      default 127.0.0.1:8080  (matches firebase.json)
 *   FIREBASE_AUTH_EMULATOR_HOST  default 127.0.0.1:9099
 *   GOOGLE_CLOUD_PROJECT         project id; emulator default "si-cmms-local"
 * ============================================================================
 */
const path = require("path");
const fs = require("fs");
const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const TARGET = (process.env.SI_TARGET || "emulator").toLowerCase();
const IS_LIVE = TARGET === "live";

const DEFAULT_FIRESTORE_EMULATOR = "127.0.0.1:8080";
const DEFAULT_AUTH_EMULATOR = "127.0.0.1:9099";
const DEFAULT_EMULATOR_PROJECT = "si-cmms-local";

/**
 * The well-known path `gcloud auth application-default login` writes to.
 * firebase-admin's applicationDefault() already reads this file (it handles
 * "authorized_user" refresh-token credentials, not just service account keys) —
 * we only look for it here so we can tell the difference between "no
 * credentials at all" and "gcloud credentials, which are fine".
 *
 * This is the supported route when the organization policy
 * iam.disableServiceAccountKeyCreation blocks downloading a key file.
 */
function gcloudAdcPath() {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA && path.join(process.env.APPDATA, "gcloud")
      : process.env.HOME && path.join(process.env.HOME, ".config", "gcloud");
  return base ? path.join(base, "application_default_credentials.json") : null;
}

function hasGcloudAdc() {
  const p = gcloudAdcPath();
  return Boolean(p && fs.existsSync(p));
}

function targetLabel() {
  if (IS_LIVE) return `LIVE project "${process.env.GOOGLE_CLOUD_PROJECT || "(from credentials)"}"`;
  return `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_FIRESTORE_EMULATOR} (project "${process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_EMULATOR_PROJECT}")`;
}

let cached = null;

function connect() {
  if (cached) return cached;

  if (IS_LIVE) {
    const hasKeyFile = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG);
    const hasAdc = hasGcloudAdc();

    if (!hasKeyFile && !hasAdc) {
      throw new Error(
        "SI_TARGET=live but no credentials. Use either:\n" +
          "  (a) gcloud user credentials — no key file, works when the org policy\n" +
          "      iam.disableServiceAccountKeyCreation blocks key downloads:\n" +
          "        gcloud auth application-default login\n" +
          `        $env:GOOGLE_CLOUD_PROJECT="si-cmms"\n` +
          "  (b) a service account key JSON, if your org still permits them:\n" +
          "        Firebase Console → Project Settings → Service Accounts → Generate new private key\n" +
          "        $env:GOOGLE_APPLICATION_CREDENTIALS=\"./serviceAccountKey.json\""
      );
    }

    // User credentials from gcloud carry no project id (a service account key
    // does), so applicationDefault() cannot infer one. Requiring it explicitly
    // also keeps "reach production" a two-key action rather than something an
    // ambient file on disk can enable by itself.
    if (!hasKeyFile && hasAdc && !process.env.GOOGLE_CLOUD_PROJECT) {
      throw new Error(
        "SI_TARGET=live using gcloud application-default credentials, but GOOGLE_CLOUD_PROJECT is not set. " +
          'These credentials do not name a project, so the Admin SDK has no idea which Firestore to talk to. Set it:\n' +
          '  $env:GOOGLE_CLOUD_PROJECT="si-cmms"'
      );
    }

    // Guard against the worst mistake this script could make: pointing at the
    // live project while an emulator host is still exported in the shell.
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error(
        `SI_TARGET=live but FIRESTORE_EMULATOR_HOST is still set to "${process.env.FIRESTORE_EMULATOR_HOST}". ` +
          "Unset it — otherwise the Admin SDK silently talks to the emulator and you will think you wrote to production."
      );
    }

    if (!getApps().length) {
      const opts = { credential: applicationDefault() };
      if (process.env.GOOGLE_CLOUD_PROJECT) opts.projectId = process.env.GOOGLE_CLOUD_PROJECT;
      initializeApp(opts);
    }
  } else {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_FIRESTORE_EMULATOR;
    process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || DEFAULT_AUTH_EMULATOR;
    process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_EMULATOR_PROJECT;
    // The emulator accepts any projectId and ignores credentials entirely.
    if (!getApps().length) initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }

  cached = { db: getFirestore(), auth: getAuth(), isLive: IS_LIVE, label: targetLabel() };
  return cached;
}

module.exports = { connect, targetLabel, IS_LIVE, TARGET };
