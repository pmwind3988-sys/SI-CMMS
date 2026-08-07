# SI — Service Inside · Build & Deploy

How this app becomes an Android APK and a live Firebase Hosting site. Read
`README.md` first for what the app *is*; this file is only about shipping it.

---

## 1. What is installed on this machine

Everything below was installed as part of setting this up. Nothing needs
reinstalling unless you move to a different machine.

| Tool | Version | Location |
|---|---|---|
| Node.js | 24.18.1 | `C:\Program Files\nodejs` |
| Eclipse Temurin JDK | 17.0.20 | `C:\Users\Ahmad Amirul\toolchain\jdk17` |
| Android SDK | cmdline-tools 11.0, platform-tools, platform `android-34`, build-tools `34.0.0` | `%LOCALAPPDATA%\Android\Sdk` |
| Capacitor | 6.x (`core`, `android`, `cli`) | project `node_modules` |
| Firebase CLI | 15.25.1 | project `node_modules` — call it as `npx firebase` |
| firebase-admin | latest | project `node_modules` — used by the setup scripts |

Environment variables set at **User** scope (so they persist across reboots):

```
JAVA_HOME         = C:\Users\AHMADA~1\TOOLCH~1\jdk17
ANDROID_HOME      = C:\Users\Ahmad Amirul\AppData\Local\Android\Sdk
ANDROID_SDK_ROOT  = (same as ANDROID_HOME)
JAVA_TOOL_OPTIONS = -Djdk.net.unixdomain.tmpdir=C:/Users/AHMADA~1/.gradle/sockets
PATH             += %JAVA_HOME%\bin, %ANDROID_HOME%\platform-tools, %ANDROID_HOME%\cmdline-tools\latest\bin
```

`JAVA_TOOL_OPTIONS` is not a tuning setting — without it **no Gradle build runs at
all on this machine**. See §7. It makes every JVM print one
`Picked up JAVA_TOOL_OPTIONS: …` line to stderr, which is expected and harmless.

`JAVA_HOME` deliberately uses the 8.3 short path. The real folder sits under
`C:\Users\Ahmad Amirul\`, and the space in that name breaks both `sdkmanager.bat`
and Gradle's JVM detection. Don't "tidy" it to the long path.

Android Studio was **not** installed — only the command-line SDK, which is all a
Gradle APK build needs. Install Studio separately if you want the GUI/emulator.

---

## 2. How the web app became APK-able

The app was a Next.js app with no static export. Three changes made it packageable:

1. **`next.config.js` → `output: "export"`.** Every page in this app is already
   `"use client"` and talks to Firebase straight from the browser, so there was
   no server logic to lose. `next build` now emits a plain static site into
   `out/`. That one folder is both what Hosting serves and what the APK embeds,
   so web and Android ship identical UI.

2. **`/work-orders/[id]` → `/work-orders/view?id=…`** (and `[id]/edit` →
   `/work-orders/edit?id=…`). A static export must know every route at build
   time; work order ids are created at runtime, so the dynamic segment could
   never be prerendered. The id moved into a query param. All 9 call sites were
   updated, including notification deep links (`lib/notifications.js`) and the
   post-login return path (`components/RequireAuth.jsx`, which now preserves the
   query string so an expired session returns you to the right work order).

3. **`trailingSlash: true`.** Emits `out/work-orders/view/index.html` instead of
   `view.html`. Capacitor's WebView server resolves directory paths to
   `index.html`, so this is what makes deep links work inside the APK.

Also: `src/lib/firebase.js` now falls back to placeholder config values when the
`NEXT_PUBLIC_FIREBASE_*` vars are empty. Without that, `getAuth()` runs at module
scope during the export prerender and throws `auth/invalid-api-key`, failing the
whole build on a fresh clone. Missing config is instead reported as a loud
`console.error` in the browser, where it's actionable.

---

## 3. Firebase project setup — steps only you can do

Creating a project and `firebase login` both need your Google account in a
browser, so these are yours to run. Takes about ten minutes.

### 3a. Create the project and get the web config

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Once created: **Project Settings → General → Your apps → Add app → Web** (`</>`).
   Register it (nickname anything, e.g. "SI CMMS Web"). Skip Hosting setup there —
   this repo already has it configured.
3. Copy the six values from the `firebaseConfig` snippet it shows you into
   **`app/.env.local`** (the file already exists with the keys, just empty):

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIza…
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abcdef
```

These are inlined at **build** time. Any change here means a rebuild
(`npm run build` for web, `npm run apk` for Android).

> These six values are not secrets — they ship in every web bundle by design.
> What protects your data is the Firestore security rules in step 3d, which is
> why deploying them is not optional.

### 3b. Turn on Authentication

**Authentication → Get started → Email/Password → Enable.** (Only
email/password; the app has no social sign-in.)

Under **Authentication → Settings → Authorized domains**, confirm `localhost` is
listed. It is there by default, and the APK needs it — Capacitor serves the
bundle from `https://localhost` inside the WebView.

### 3c. Create the Firestore database

**Firestore Database → Create database → Production mode**, then pick a region
close to your users. Production mode denies everything until you deploy rules,
which is the next step.

### 3d. Deploy rules and indexes

```bash
cd app && npx firebase login
```

```bash
cd app && npx firebase use --add
```

Pick your project and give it the alias `default`. That writes `.firebaserc`.
Then:

```bash
cd app && npm run deploy:rules
```

That pushes `firestore.rules` (the full 5-role transition matrix) and
`firestore.indexes.json`. **Composite indexes take a few minutes to build** —
list and dashboard queries return errors until they finish. Watch progress under
Firestore → Indexes.

### 3e. Create the initial users

Nobody can sign in until users exist *with role custom claims* — the app has no
"create the first admin" screen, deliberately, since that would be a
privilege-escalation hole.

1. Get admin credentials — either route works, see `GO_LIVE.md` step A6:
   - **gcloud, no key file** (required if your organization enforces
     `iam.disableServiceAccountKeyCreation`, which is now the Workspace
     default): `gcloud auth application-default login`
   - **Service account key**: Project Settings → Service Accounts → Generate new
     private key, saved as `app/serviceAccountKey.json`
2. Run — with gcloud credentials:

```bash
cd app; $env:SI_TARGET="live"; $env:GOOGLE_CLOUD_PROJECT="si-cmms"; npm run bootstrap:users
```

   …or with a key file:

```bash
cd app; $env:SI_TARGET="live"; $env:GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"; npm run bootstrap:users
```

That creates six users (one per role) with claims and `/users/{uid}` profiles.
Credentials are listed in `scripts/bootstrapUsers.js` — all with password
`ChangeMe123!`. **Change them, and edit `DEPARTMENT_ID`/`PLANT_ID` in that file
to match your real data, before anyone uses this for real.**

Then seed the reference collections — `/departments`, `/assets`, `/technicians`,
`/priorities`, `/sla`, `/plants`. Run this **after** `bootstrap:users`, so
technician documents get real Auth UIDs instead of placeholder slugs:

```bash
cd app; $env:SI_TARGET="live"; $env:GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"; npm run seed:db
```

`SI_TARGET=live` is required and deliberate — every script in `scripts/`
defaults to the emulator, so nothing can reach your real project by accident.
Add `-- --dry-run` to see exactly what it would write first. The seed is
idempotent; re-running it changes nothing.

Optionally seed one demo work order:

```bash
cd app; $env:GOOGLE_APPLICATION_CREDENTIALS="./serviceAccountKey.json"; npm run seed:demo
```

> `serviceAccountKey.json` grants full admin access to your project. It is
> already covered by `.gitignore` — keep it that way and never commit it.

### 3f. Deploy Hosting

```bash
cd app && npm run deploy:hosting
```

That runs `next build` and uploads `out/`. You get a
`https://your-project.web.app` URL.

---

## 4. Building the APK

Once `.env.local` holds real values:

```bash
cd app && npm run apk
```

That is three steps chained: `next build` → `cap sync android` → Gradle
`assembleDebug`. The APK lands at:

```
app/android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a phone with USB debugging on:

```bash
adb install -r app/android/app/build/outputs/apk/debug/app-debug.apk
```

Or just copy the `.apk` to the device and tap it (needs "install unknown apps"
allowed for your file manager).

App identity, set in `capacitor.config.json`:

- **Application ID** — `com.serviceinside.cmms`
- **App name** — SI CMMS

### Debug vs release

`npm run apk` produces a **debug** APK: signed with Android's throwaway debug
key. Fine for internal testing and sideloading, **not** acceptable for Play
Store or long-term distribution — debug keys are public and the build is
unoptimised.

For a real release you need your own keystore:

```bash
keytool -genkey -v -keystore si-cmms-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias si-cmms
```

Then add a `signingConfigs` block to `android/app/build.gradle` referencing it
(keep the passwords in `android/keystore.properties`, git-ignored) and run
`npm run apk:release`. **Back that keystore up** — lose it and you can never
update the app under the same identity.

---

## 5. Plan limits: what works free, what needs Blaze

The free **Spark** plan covers most of this. Two things do not:

| Feature | Plan | Effect if unavailable |
|---|---|---|
| Firestore, Authentication, Hosting | Spark ✅ | — |
| **Cloud Storage** (work order photos/videos) | **Blaze** | For projects created after Oct 2024 the default bucket requires billing. Attachment uploads in `lib/workOrders.js` will fail; everything else works. |
| **Cloud Functions** | **Blaze** | Auto WO numbering, SLA computation, notification fan-out, SLA warning/breach sweeps, and dashboard stat rollups never fire. |

That second row matters more than it looks. With Functions undeployed you get a
working app whose **automation is inert** — work orders may lack numbers, SLA
timers won't populate, notifications won't be created, and Manager/Admin
dashboards read stat documents that nothing is writing, so they show zeros.

If you upgrade to Blaze (set a budget alert first):

```bash
cd app && npm run deploy:functions
```

```bash
cd app && npx firebase deploy --only storage
```

---

## 6. Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server at localhost:3000, against real Firebase |
| `npm run build` | Static export into `out/` |
| `npm run apk` | Full rebuild → debug APK |
| `npm run cap:sync` | Copy an existing `out/` into the Android project (no web rebuild) |
| `npm run deploy:hosting` | Build + deploy the site |
| `npm run deploy:rules` | Deploy Firestore rules + indexes |
| `npm run deploy:functions` | Deploy Cloud Functions (Blaze) |
| `npm run emulators` | Local Firebase Emulator Suite (**needs JDK 21+** — see below) |
| `npm run bootstrap:users` | Create the six role users (needs service account) |
| `npm run seed:db` | Seed all reference collections (needs service account) |
| `npm run seed:demo` | Seed one demo work order (needs service account) |
| `npm run schema:check` | Fail on schema drift — no database or credentials needed |
| `npm run apk:record` | Record the built APK into `/apk_builds` |

### The two-JDK problem on this machine

These two requirements conflict, and installing the wrong thing breaks the build:

| Tool | JDK |
|---|---|
| Gradle 8.2.1 + AGP 8.2.1 (the APK build) | **17** — Gradle 8.2 cannot run on 21 at all |
| firebase-tools 15 (the emulator only) | **21+** |

This machine has JDK 17, which is why `npm run apk` works and `npm run emulators`
does not. **If you install JDK 21 and point `JAVA_HOME` at it globally, the APK
build stops working** with `Unsupported class file major version 65`.

If you want both, keep `JAVA_HOME` on 17 and pin Gradle explicitly by adding this
to `android/gradle.properties`:

```
org.gradle.java.home=C:/Program Files/Java/jdk-17
```

then set `JAVA_HOME` to 21 only in the shell where you run the emulator.

**You do not need the emulator to go live.** It is for local testing only —
the entire path in Section 3 works on JDK 17 alone.

`npm run emulators` note: an APK on a real phone cannot reach `127.0.0.1`
emulators on your PC. Use `npm run dev` in a browser for emulator work, or
`adb reverse tcp:8080 tcp:8080` (and `9099`) for a USB-connected device.

---

## 7. The Gradle "loopback connection" problem on this machine

Worth reading before you touch `JAVA_TOOL_OPTIONS`, because without it every
Gradle build fails immediately with:

```
FAILURE: Build failed with an exception.
* What went wrong:
java.io.IOException: Unable to establish loopback connection
```

**What's actually happening.** On Windows, JDK 17's `Selector.open()` builds an
internal wakeup pipe on top of an **AF_UNIX socket**, created in the directory
given by `jdk.net.unixdomain.tmpdir` (default: `java.io.tmpdir`, i.e. your Temp
folder). On this machine a socket in `%LOCALAPPDATA%\Temp` **binds successfully
but cannot be connected to** — `connect` returns `Invalid argument`. So every
`Selector.open()` throws, and since Gradle's client talks to its daemon over a
socket, the client can never reach the daemon it just started. No build runs.

Verified specifics, so nobody re-derives them:

- It is **not** path length. AF_UNIX sockets connect fine at 66-character paths
  elsewhere under your profile; the 108-byte `sockaddr_un` limit is nowhere near.
- It is **not** the JDK install, Gradle version, Capacitor, or this project.
  A five-line Java program calling `Selector.open()` fails the same way.
- It is **the Temp directory specifically**. Any other directory works. The
  likely cause is a filter driver — antivirus or similar — intercepting that
  folder. TCP loopback is unaffected.
- Setting it via `org.gradle.jvmargs` in `gradle.properties` is **not enough**:
  Gradle does not forward that `-D` to the daemon JVM, so the client connects and
  the daemon still fails. `JAVA_TOOL_OPTIONS` works because every JVM — client and
  daemon — picks it up from the inherited environment.

The fix points those sockets at `C:\Users\Ahmad Amirul\.gradle\sockets` instead.
The `AHMADA~1` 8.3 short form in the value is deliberate: Gradle and the JVM
launcher split arguments on spaces, so the long form `C:/Users/Ahmad Amirul/...`
gets parsed as two arguments and dies with
`Could not find or load main class Amirul`.

If you ever resolve the underlying Temp-folder interference (excluding it in your
security software, say), you can delete `JAVA_TOOL_OPTIONS` and the
`.gradle\sockets` folder. To test whether it's still needed, save this as `T.java`:

```java
public class T {
  public static void main(String[] a) throws Exception {
    System.out.println(java.nio.channels.Selector.open());
  }
}
```

Then run it with the variable cleared (JDK 11+ executes a single source file
without compiling first):

```bash
$env:JAVA_TOOL_OPTIONS=$null; java T.java
```

Prints a `WEPollSelectorImpl` → the workaround is no longer needed. Throws
`Unable to establish loopback connection` → keep it.

**On a different machine**, none of this may apply — try a build without
`JAVA_TOOL_OPTIONS` first, and only add it if you see the loopback error.

---

## 8. Known gaps carried over

These are pre-existing and unchanged by the APK work — see the root `README.md`
for full context:

- Supervisor has no dashboard (needs department-scoped stat documents).
- Asset, Department and Technician records are hardcoded lookups in
  `src/lib/constants.js`, not real collections.
- `priorities` and `sla` are designed as Firestore collections but read from
  `constants.js`.
- `next@14.2.5` is flagged by npm for a known security advisory. Most Next.js
  CVEs target server-side features this app no longer ships (it's a static
  export), but a bump to the latest patched 14.x is still worth doing.
