# SI — Service Inside · Go Live, A to Z

A single linear path from nothing to a working APK on a phone, talking to a real
Firebase project. Follow it in order — several steps depend on earlier ones in
ways that are not obvious.

For background and troubleshooting depth, see **BUILD_AND_DEPLOY.md**. This file
is the checklist; that one is the explanation.

---

## Read this first — the one thing that trips everyone up

**This is an Android app whose Firebase config comes from a *Web* app
registration.** That sounds wrong. Here is why it is correct.

The APK is a [Capacitor](https://capacitorjs.com) shell: an Android WebView that
loads a Next.js static export from inside the APK. Every Firebase call is made
by the **Firebase JavaScript SDK** running in that WebView:

```
src/lib/firebase.js      → firebase/app, firebase/auth, firebase/firestore
src/lib/workOrders.js    → firebase/firestore, firebase/storage
src/lib/dashboard.js     → firebase/functions
```

There is no native Firebase SDK in this project. `android/capacitor.settings.gradle`
lists exactly one plugin (`capacitor-android`), and `AndroidManifest.xml` requests
exactly one permission (`INTERNET`).

Consequences:

| | |
|---|---|
| Register in Firebase Console | **Web app** (`</>`) |
| Config format you need | the six `NEXT_PUBLIC_FIREBASE_*` values |
| `google-services.json` | **not needed, and ignored if present** — it configures the native SDK, which this app does not use |
| Package name `com.serviceinside.cmms` | matters to Android and the Play Store, not to Firebase |

If you register an Android app in Firebase instead of a Web app, you get a
`google-services.json` and none of the six values, and nothing will connect.

> Register an Android app **later** only if you add native features — FCM push
> notifications, Crashlytics, or App Distribution. The app's current
> notifications are Firestore documents, not push, so you do not need it now.
> `android/app/build.gradle` already applies the google-services plugin
> conditionally, so dropping the file in later works without edits.

---

## Prerequisites — already satisfied on this machine

| | Required | You have |
|---|---|---|
| JDK | **17** (Gradle 8.2.1 cannot run on 21) | 17.0.20 ✅ |
| Android SDK | platform 34 | android-34 ✅ |
| Node | ≥ 18.18 | v24.18.1 ✅ |
| A phone | USB debugging on, or any Android emulator | — |

**Do not install JDK 21 to fix the Firebase emulator.** It breaks the APK build
(`Unsupported class file major version 65`). You do not need the emulator for
any step below.

---

# PART A — Firebase Console

Only you can do these; they need your Google account in a browser. About 10
minutes.

### A1. Create the project

<https://console.firebase.google.com> → **Add project** → name it (e.g.
`si-cmms`) → Continue. Google Analytics is optional; the app does not use it.

Note the **Project ID** it assigns (e.g. `si-cmms-4a1b7`) — not the display name.
You need it in step C2.

### A2. Register a **Web** app — not Android

**Project Settings** (gear icon) **→ General → Your apps → Add app → Web (`</>`)**

- App nickname: anything, e.g. `SI CMMS`
- **Do not** tick "Also set up Firebase Hosting" — this repo already configures it

It then shows a `firebaseConfig` snippet. **Leave this page open**, you need it
in step B1.

> Re-read the section at the top if this feels wrong. Web is correct for a
> Capacitor app using the JS SDK.

### A3. Enable Authentication

**Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**

Enable only Email/Password. The app has no social sign-in.

### A4. Check authorized domains — Android-specific

**Authentication → Settings → Authorized domains.**

Confirm **`localhost`** is in the list. It is there by default. Do not remove it:
Capacitor serves the bundle from `https://localhost` inside the WebView
(`capacitor.config.json` sets `androidScheme: "https"`, `hostname: "localhost"`),
so **Firebase Auth on the phone breaks without it.** This is the single most
common cause of "works in the browser, fails in the APK".

### A5. Create the Firestore database

**Firestore Database → Create database → Production mode** → pick a region close
to your users.

Production mode denies all access until you deploy rules, which is step D.
Region cannot be changed later — choose deliberately.

### A6. Admin credentials for the scripts

`bootstrap:users`, `seed:db`, and `apk:record` use the Admin SDK, which needs
credentials that outrank the security rules. Two routes — **pick one.**

#### A6a (preferred) — gcloud user credentials, no key file

Use this if key creation is blocked. Google Workspace organizations now enforce
`iam.disableServiceAccountKeyCreation` by default, so
**Generate new private key** fails with:

> Key creation is not allowed on this service account. Please check if service
> account key creation is restricted by organization policies.

That policy is doing its job — downloadable keys are the largest single source
of leaked cloud credentials. You do not need one. Install the
[Google Cloud CLI](https://cloud.google.com/sdk/docs/install), then:

```
gcloud auth application-default login
gcloud auth application-default set-quota-project si-cmms
```

The first command opens a browser, you sign in as yourself, and it writes
`%APPDATA%\gcloud\application_default_credentials.json`. The Admin SDK reads
that file automatically. Then, in every shell that runs a live script:

```
$env:SI_TARGET="live"; $env:GOOGLE_CLOUD_PROJECT="si-cmms"
```

`GOOGLE_CLOUD_PROJECT` is **required** here — user credentials, unlike a key
file, do not name a project, so without it the scripts stop rather than guess.

These credentials carry *your own* IAM permissions, so you need **Owner** or
**Editor** on `si-cmms` (whoever created the project has Owner). They expire and
refresh normally, and revoking your account revokes them — neither is true of a
key file.

#### A6b — service account key, if your org still permits it

**Project Settings → Service Accounts → Generate new private key → Generate key.**
Save the downloaded JSON as exactly `app/serviceAccountKey.json`, then use
`$env:GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"` instead of
`GOOGLE_CLOUD_PROJECT`.

> This grants **full admin access** to your project — it bypasses every security
> rule, never expires, and is not tied to any person. It is already in
> `.gitignore`. Never commit it, never paste its contents into a chat or an
> issue, never email it.

#### If you specifically need A6b and it is blocked

Lifting the policy is a real option, not a trick, but it is a company decision:
someone with **Organization Policy Administrator** (`roles/orgpolicy.policyAdmin`)
must edit `iam.disableServiceAccountKeyCreation` in the Google Cloud console
under **IAM & Admin → Organization Policies**, adding a project-level exception
for `si-cmms`. If that is not you, it is a request to your Workspace admin — and
they will reasonably ask why A6a doesn't work, since for this project it does.

### A7. Decide: Spark or Blaze

| Feature | Spark (free) | Notes |
|---|---|---|
| Firestore, Auth, Hosting | ✅ | everything below works |
| **Cloud Functions** | ❌ Blaze | see the warning |
| **Cloud Storage** (photos/videos) | ❌ Blaze | attachment uploads fail; nothing else does |

**Without Cloud Functions the app runs but its automation is inert:** work orders
get no `wo_number`, SLA timers never populate, no notifications are created, and
the Manager/Admin dashboards read stat documents that nothing writes — so they
show zeros.

You can start on Spark and upgrade later; nothing below changes. If you upgrade,
**set a budget alert first** (Google Cloud Console → Billing → Budgets & alerts).

---

# PART B — Put the config into the project

### B1. Fill in `.env.local`

Open `app/.env.local`. The keys exist and are empty. Paste the six values from
the snippet in step A2:

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSy…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=si-cmms-4a1b7.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=si-cmms-4a1b7
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=si-cmms-4a1b7.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abc123def456
```

No quotes, no spaces around `=`, no trailing comma.

Also set, in the same file:

```
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
```

> These six are **not secrets** — they ship in every web bundle and inside the
> APK by design. What protects your data is the security rules in Part D, which
> is why deploying them is not optional.

### B2. Verify they loaded

```bash
cd app; node -e "require('dotenv')" 2>$null; node -e "const s=require('fs').readFileSync('.env.local','utf8');const m=Object.fromEntries(s.split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));['NEXT_PUBLIC_FIREBASE_API_KEY','NEXT_PUBLIC_FIREBASE_PROJECT_ID','NEXT_PUBLIC_FIREBASE_APP_ID'].forEach(k=>console.log((m[k]?'OK   ':'EMPTY').padEnd(6),k,m[k]?'('+m[k].slice(0,12)+'…)':''))"
```

All three must say `OK`. If any says `EMPTY`, the APK will be built
unconfigured — exactly the state the current `app-debug.apk` is in.

---

# PART C — Link the CLI to your project

### C1. Log in

```bash
cd app; npx firebase login
```

Opens a browser. Approve with the same Google account that owns the project.

### C2. Select the project

```bash
cd app; npx firebase use --add
```

Pick your project from the list, then give it the alias **`default`**. This
writes `app/.firebaserc`, which does not exist yet.

Verify:

```bash
cd app; npx firebase projects:list
```

---

# PART D — Deploy the security rules and indexes

```bash
cd app; npm run deploy:rules
```

This pushes `firestore.rules` (the full 5-role transition matrix across all 15
collections) and all 16 composite indexes from `firestore.indexes.json`.

**Composite indexes take several minutes to build.** Until they finish, list and
dashboard queries return `FAILED_PRECONDITION`. Watch progress at **Firestore
Database → Indexes**; wait for every row to read *Enabled* before Part I.

Sanity-check the rules are what you think before deploying:

```bash
cd app; npm run schema:check
```

---

# PART E — Create the initial users

Nobody can sign in until users exist **with role custom claims**. The app has no
"create the first admin" screen — deliberately, since that would be a
privilege-escalation hole.

### E1. Point the shell at the live project

Run this in the **same PowerShell window** you will use for Parts E and F.

If you took **A6a** (gcloud, no key file):

```bash
cd app; $env:SI_TARGET="live"; $env:GOOGLE_CLOUD_PROJECT="si-cmms"
```

If you took **A6b** (service account key):

```bash
cd app; $env:SI_TARGET="live"; $env:GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"
```

Either way the scripts print a `Target:` line before doing anything — read it.
It must say `LIVE project "si-cmms"`.

`SI_TARGET=live` is required and deliberate: every script in `scripts/` targets
the emulator by default, so nothing can reach your real project by accident. The
connector also refuses to run if `FIRESTORE_EMULATOR_HOST` is still set.

### E2. Create them

```bash
cd app; npm run bootstrap:users
```

First line of output must name your real project, not `EMULATOR`. It creates six
users, one per role, each with `role` / `department_id` / `plant_ids` custom
claims and a matching `/users/{uid}` profile.

Default credentials are in `scripts/bootstrapUsers.js` — all six use password
`ChangeMe123!`.

> **Change those passwords before anyone uses this for real**, and edit
> `DEPARTMENT_ID` / `PLANT_ID` in that file to match your real data first if you
> already know them.

### E3. Verify

**Authentication → Users** should list six accounts. **Firestore → users**
should hold six documents keyed by Auth UID.

---

# PART F — Seed the database

Run this **after** Part E, so technician documents get real Auth UIDs instead of
the placeholder slugs from `constants.js`.

### F1. Dry run first

```bash
cd app; npm run seed:db -- --dry-run
```

Prints the 28 documents it would write across 6 collections, and writes nothing.
Confirm the target line says your live project.

### F2. Seed

```bash
cd app; npm run seed:db
```

Writes `/plants` (1), `/departments` (7), `/assets` (7), `/priorities` (4),
`/sla` (4), `/technicians` (5). Idempotent — safe to re-run. It never touches
`work_orders`, `work_order_history`, `notifications` or `counters`.

### F3. Optionally add a demo work order

```bash
cd app; npm run seed:demo
```

One closed work order with a full 10-entry history trail, for checking the list
and detail screens have something to render.

### F4. Verify

**Firestore Database → Data** should now show the collections above. Or ask me —
`si_database_status` reports the count in every collection at once.

---

# PART G — Deploy Cloud Functions (Blaze only)

Skip if you stayed on Spark. Re-read the warning in A7 about what stops working.

```bash
cd app/functions; npm install
```

```bash
cd app; npm run deploy:functions
```

First deploy takes several minutes and enables Cloud Build and Artifact Registry
on the project.

---

# PART H — Build the APK

**Only now.** The six config values are inlined at **build** time, so an APK
built before Part B cannot reach Firebase no matter what you do afterwards.

```bash
cd app; npm run apk
```

Three chained steps: `next build` → `cap sync android` → Gradle `assembleDebug`.
Output:

```
app/android/app/build/outputs/apk/debug/app-debug.apk
```

Confirm the config actually made it in — this must print **nothing**:

```bash
cd app; findstr /C:"NEXT_PUBLIC_FIREBASE_API_KEY" out\_next\static\chunks\*.js
```

A match means the value was still unset at build time and the bundle kept the
unresolved `process.env` reference. Go back to B2.

---

# PART I — Install and verify

### I1. Install

With USB debugging on:

```bash
adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk
```

Or copy the `.apk` to the phone and tap it (needs "install unknown apps" allowed
for your file manager).

### I2. Sign in

Open **SI CMMS** → sign in as `admin@example.com` / `ChangeMe123!`.

### I3. What you should see

| Screen | Expected |
|---|---|
| Login | succeeds, redirects to the Admin dashboard |
| Admin dashboard | 10 stat cards — **zeros unless you deployed Functions** (Part G) |
| Work orders list | the demo work order, if you ran F3 |
| New work order | Department and Equipment dropdowns populated from the seeded collections |

If sign-in fails inside the APK but works in a desktop browser, the cause is
almost always the authorized-domains setting in **A4**.

---

# PART J — Record the build

```bash
cd app; npm run apk:record
```

Reads `build.gradle`, the built APK (size + SHA-256), `.next/BUILD_ID` and git,
and writes one document to `/apk_builds`. Add `--release` once you are actually
distributing it, and `--min-version=N` to set the forced-update floor.

---

# PART K — Release APK (later, for real distribution)

`npm run apk` produces a **debug** APK signed with Android's public throwaway
key. Fine for sideloading and internal pilots; not acceptable for the Play Store
or long-term distribution.

See **BUILD_AND_DEPLOY.md § 4 "Debug vs release"** for the keystore steps.
**Back the keystore up** — lose it and you can never update the app under the
same identity again.

---

# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `auth/invalid-api-key` in the APK | `.env.local` empty at build time | B1 → B2 → rebuild (H) |
| Sign-in works in browser, fails in APK | `localhost` missing from authorized domains | A4 |
| `permission-denied` on every read | rules not deployed | D |
| `FAILED_PRECONDITION … requires an index` | composite indexes still building | wait; Firestore → Indexes |
| Dashboards show all zeros | Cloud Functions not deployed | G, or accept it on Spark |
| Work orders have no `WO-…` number | same — `onWorkOrderCreate` never ran | G |
| Scripts say `EMULATOR` when you meant live | `SI_TARGET` not set in *this* shell | E1 |
| `SI_TARGET=live but FIRESTORE_EMULATOR_HOST is still set` | leftover env var | `Remove-Item Env:FIRESTORE_EMULATOR_HOST` |
| Gradle: `Unsupported class file major version 65` | `JAVA_HOME` points at JDK 21 | point it back at 17 |
| Attachment upload fails | Cloud Storage needs Blaze | A7 |
| Technician docs keyed `tech-arun` not a UID | ran `seed:db` before `bootstrap:users` | re-run E then F |
