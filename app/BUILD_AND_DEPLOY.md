# SI — Service Inside · Build & Deploy

How this app becomes a live site on Vercel and an Android APK. Read `README.md`
first for what the app *is*; this file is only about shipping it.

The backend is Supabase (project `iclphobvhjwdinxnqexw`). Firebase was removed
entirely on 2026-08-07 — if you find a Firebase reference anywhere outside a
historical note, it's stale.

---

## 1. What is installed on this machine

Nothing here needs reinstalling unless you move to a different machine.

| Tool | Version | Location |
|---|---|---|
| Node.js | 24.18.1 | `C:\Program Files\nodejs` |
| Eclipse Temurin JDK | 17.0.20 | `C:\Users\Ahmad Amirul\toolchain\jdk17` |
| Android SDK | cmdline-tools 11.0, platform-tools, platform `android-34`, build-tools `34.0.0` | `…\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Android\Sdk` — **not** `%LOCALAPPDATA%\Android\Sdk`, see §6 |
| Capacitor | 6.x (`core`, `android`, `cli`) | project `node_modules` |
| GitHub CLI | 2.97.0 | system |
| `@supabase/supabase-js` | ^2.112.2 | project `node_modules` |
| `supabase` CLI | ^2.111.0 | project `node_modules` — call it as `npx supabase` |

Environment variables set at **User** scope (so they persist across reboots):

```
JAVA_HOME         = C:\Users\AHMADA~1\TOOLCH~1\jdk17
ANDROID_HOME      = C:\Users\Ahmad Amirul\AppData\Local\Android\Sdk
ANDROID_SDK_ROOT  = (same as ANDROID_HOME)
JAVA_TOOL_OPTIONS = -Djdk.net.unixdomain.tmpdir=C:/Users/AHMADA~1/.gradle/sockets
PATH             += %JAVA_HOME%\bin, %ANDROID_HOME%\platform-tools, %ANDROID_HOME%\cmdline-tools\latest\bin
```

`JAVA_TOOL_OPTIONS` is not a tuning setting — without it **no Gradle build runs at
all on this machine**. See §6. It makes every JVM print one
`Picked up JAVA_TOOL_OPTIONS: …` line to stderr, which is expected and harmless.

`JAVA_HOME` deliberately uses the 8.3 short path. The real folder sits under
`C:\Users\Ahmad Amirul\`, and the space in that name breaks both `sdkmanager.bat`
and Gradle's JVM detection. Don't "tidy" it to the long path.

`ANDROID_HOME` above is **wrong for Gradle and does nothing** — the SDK is not
really at that path. `android/local.properties` carries the real one. See §6.

Android Studio was **not** installed — only the command-line SDK, which is all a
Gradle APK build needs.

---

## 2. Why the app is a static export

`next.config.js` sets `output: "export"` and `trailingSlash: true`. Three things
follow from that, and all three are load-bearing:

1. **One build serves both targets.** Every page is `"use client"` and talks to
   Supabase straight from the browser, so there is no server logic to lose.
   `next build` emits a plain static site into `out/` — that folder is both what
   Vercel serves and what the APK embeds, so web and Android ship identical UI.

2. **No dynamic route segments.** A static export must know every route at build
   time, and work order ids are created at runtime. So it's
   `/work-orders/view?id=…`, not `/work-orders/[id]`. This is why
   `components/RequireAuth.jsx` preserves the query string when it bounces you to
   `/login` — otherwise an expired session would return you to a detail page with
   nothing selected.

3. **`trailingSlash` emits `view/index.html`** rather than `view.html`.
   Capacitor's WebView resolves directory paths to `index.html`, so this is what
   makes deep links work inside the APK.

Two consequences worth knowing:

- **`NEXT_PUBLIC_*` values are baked in at build time.** Changing one in Vercel
  requires a redeploy, not just a settings save.
- **`src/lib/supabase.js` falls back to placeholder config** when the env vars are
  empty. Without that, `createClient()` runs at module scope during the export
  prerender and throws, failing the build on a fresh clone. Missing config is
  reported as a loud `console.error` in the browser instead, where it's
  actionable.

---

## 3. Deploying the web app (Vercel)

### First time

Follow `../SETUP_SUPABASE_VERCEL.md`, which covers publishing to GitHub and
importing into Vercel. The one setting people get wrong:

> **Root Directory must be `app`.** The Next app is not at the repo root, and the
> build fails without this.

Environment variables to set in Vercel — exactly two:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://iclphobvhjwdinxnqexw.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key from Project Settings → API |

**Never set `SUPABASE_SERVICE_ROLE_KEY` in Vercel.** It bypasses Row Level
Security completely, and because this is a static export there is no server on
Vercel that could use it safely — it would only ever end up in a browser bundle.
It belongs in `app/.env.local` (gitignored) and in Supabase's own Edge Function
environment, nowhere else.

`app/vercel.json` already declares the framework, `outputDirectory: "out"`, and
security headers. Leave the build settings alone.

### After that

Every push to `main` triggers a deploy. There is no deploy command to run.

---

## 4. Deploying database changes

Migrations live in `supabase/migrations/` and are applied in filename order.

```bash
cd app && npx supabase db push
```

That needs Docker for local work; on this machine migrations have been applied
through the Supabase MCP server (`apply_migration`) instead, which talks to the
hosted project directly and needs no Docker.

Either way: **migrations are the source of truth.** Don't change the schema in
the dashboard SQL editor without writing the migration too, or the next clone
won't match.

Edge Functions deploy separately:

```bash
cd app && npx supabase functions deploy admin-users
```

`admin-users` is the only one, and it exists because setting another user's
password requires the service-role key. See `supabase/functions/admin-users/`.

---

## 5. Building the APK

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

**Rebuild the APK after any web change.** It embeds a snapshot of `out/`, so a
Vercel deploy does not update it.

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

## 6. Machine-specific Gradle problems

Three of them, all diagnosed here so nobody re-derives them. Each one stops the
APK build outright, and none has an error message that points at its real cause.

### "Unable to establish loopback connection"

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

### "SDK location not found" although ANDROID_HOME is set

The other build-stopper on this machine:

```
> Could not determine the dependencies of null.
   > SDK location not found. Define a valid SDK location with an ANDROID_HOME
     environment variable or by setting the sdk.dir path in your project's local
     properties file at '…\app\android\local.properties'.
```

Confusing, because `ANDROID_HOME` *is* set, `local.properties` *does* contain
`sdk.dir`, and `%LOCALAPPDATA%\Android\Sdk` looks perfectly real in Explorer and
in PowerShell.

**What's actually happening.** The SDK was installed from a terminal running
inside the Claude desktop app, which is an **MSIX package**. Windows redirects a
packaged app's `AppData\Local` into its own container, so the download landed in

```
C:\Users\Ahmad Amirul\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Android\Sdk
```

and the tidy `%LOCALAPPDATA%\Android\Sdk` is only a projection of it that exists
for processes *inside* that container. The Gradle **daemon** runs detached and
outside it, so for the daemon that directory simply does not exist — and neither
does anything `ANDROID_HOME` points at, since it names the same phantom path.
AGP finds no SDK from either source and reports the generic "not found" message.

The tell, if you want to confirm it rather than take my word for it:

```bash
powershell -c "(Get-Item $env:LOCALAPPDATA\Android\Sdk).Target"
```

Prints a `…\Packages\…\LocalCache\…` path → you are looking at a redirected
directory, not a real one.

**The fix** is the real path in `android/local.properties`, which is what is
there now. AGP prefers `sdk.dir` over the environment, so the misleading
`ANDROID_HOME` no longer matters.

`local.properties` is gitignored (Capacitor puts it there, correctly — it is
machine-specific). So this fix does not travel with the repo: **on a fresh clone
of this machine you must recreate it.**

Two things worth knowing:

- That location is inside an app's package cache. Resetting or reinstalling the
  Claude desktop app **wipes it**, and the SDK goes with it. Moving the SDK to a
  plain path like `C:\Android\Sdk` and repointing `sdk.dir`, `ANDROID_HOME` and
  `PATH` is the durable cleanup.
- Installing the SDK from a normal terminal — Windows Terminal, PowerShell,
  cmd — avoids the redirection entirely and is the simpler thing to do next time.

### Keep JAVA_HOME on 17

Gradle 8.2.1 + AGP 8.2.1 **cannot run on JDK 21** — point `JAVA_HOME` at 21
globally and the APK build stops with `Unsupported class file major version 65`.
Nothing in this project needs 21 any more (that was a firebase-tools requirement,
and firebase-tools is gone), so there is no longer any reason to install it.

If some future tool does need 21, keep `JAVA_HOME` on 17 and pin Gradle
explicitly in `android/gradle.properties`:

```
org.gradle.java.home=C:/Program Files/Java/jdk-17
```

---

## 7. Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Next dev server at localhost:3000, against the live Supabase project |
| `npm run build` | Static export into `out/` |
| `npm run apk` | Full rebuild → debug APK |
| `npm run cap:sync` | Copy an existing `out/` into the Android project (no web rebuild) |
| `npm run db:push` | Apply pending migrations (needs Docker) |
| `npm run db:diff` | Diff the live schema against the migrations |
| `npm run db:types` | Regenerate TypeScript types from the live schema |
| `npm run bootstrap:users` | Create the six role users (needs the service-role key) |
| `npm run seed:demo` | Seed one demo work order (needs the service-role key) |
| `npm run apk:record` | Record the built APK into `apk_builds` |

**Do not run `npm run build` while `npm run dev` is running.** They share
`.next`, and the production build corrupts the dev server's cache — every chunk
starts returning 500 and the page silently fails to hydrate. Stop the dev server
first, or `rm -rf .next` afterwards.

---

## 8. Known gaps

- The status change and its `work_order_history` row are now atomic
  (`si_transition_work_order`, migration 0010), but **editing** a work order's
  core fields while it is Open still writes no history entry.
- `@capacitor/cli` pulls a `tar` version with a critical advisory. Fixing it
  needs a Capacitor 6 → 8 major upgrade, which has its own breaking changes.
- The APK cannot reach a `localhost` dev server from a real phone. Use
  `npm run dev` in a desktop browser, or `adb reverse tcp:3000 tcp:3000` for a
  USB-connected device.
