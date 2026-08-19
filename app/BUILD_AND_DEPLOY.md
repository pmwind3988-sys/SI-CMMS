# SI — Service Inside · Build & Deploy

How this app becomes a live site on Vercel, an Android APK, and an installable
app on iPhone. Read `README.md` first for what the app *is*; this file is only
about shipping it.

The backend is Supabase (project `iclphobvhjwdinxnqexw`). Firebase was removed
entirely on 2026-08-07 — if you find a Firebase reference anywhere outside a
historical note, it's stale.

---

## 1. What is installed on this machine

Nothing here needs reinstalling unless you move to a different machine.

> **This section was rewritten on 2026-08-11** for the current PC (profile
> `C:\Users\User`). It previously described a machine whose profile was
> `C:\Users\Ahmad Amirul`; none of that toolchain carried over, and `npm run apk`
> failed with `JAVA_HOME is not set` until it was reinstalled from scratch.

| Tool | Version | Location |
|---|---|---|
| Node.js | 24.x | `C:\Program Files\nodejs` |
| Eclipse Temurin JDK | 17.0.20+8 | `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot` |
| Android SDK | cmdline-tools 12.0, platform-tools, platform `android-34`, build-tools `34.0.0` | `C:\Android\Sdk` |
| Capacitor | 6.x (`core`, `android`, `cli` — all three must match, see §6) | project `node_modules` |
| `@supabase/supabase-js` | ^2.112.2 | project `node_modules` |
| `supabase` CLI | ^2.111.0 | project `node_modules` — call it as `npx supabase` |

Environment variables set at **User** scope (so they persist across reboots):

```
JAVA_HOME         = C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot
ANDROID_HOME      = C:\Android\Sdk
ANDROID_SDK_ROOT  = (same as ANDROID_HOME)
JAVA_TOOL_OPTIONS = -Djavax.net.ssl.trustStore=C:\Android\certs\gradle-truststore.jks
                    -Djavax.net.ssl.trustStorePassword=changeit
PATH             += C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot\bin
                    C:\Android\Sdk\platform-tools
                    C:\Android\Sdk\cmdline-tools\latest\bin
```

Those PATH entries are **literal absolute paths, not `%JAVA_HOME%\bin`**, and that
is deliberate. A `%VAR%` reference inside PATH only expands if the registry value
is typed `REG_EXPAND_SZ` — and PowerShell's
`[Environment]::SetEnvironmentVariable(name, value, 'User')` writes `REG_SZ`,
which silently *downgrades* the type. The `%JAVA_HOME%\bin` then sits in PATH as
literal text forever and `java` is never found, in every future shell, with no
error to explain why. Literal paths have no expansion step to get wrong.

If you do want the `%VAR%` form, write it through the registry API with an
explicit kind, not through `SetEnvironmentVariable`:

```powershell
$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$k.SetValue('Path', $value, [Microsoft.Win32.RegistryValueKind]::ExpandString)
```

Check what you actually have with `$k.GetValueKind('Path')` — it must say
`ExpandString`.

`JAVA_TOOL_OPTIONS` is not a tuning setting — without it **Gradle cannot download
a single dependency on this machine**, because Norton intercepts HTTPS and the JVM
doesn't trust its certificate. See §6. It makes every JVM print one
`Picked up JAVA_TOOL_OPTIONS: …` line to stderr, which is expected and harmless.

The SDK deliberately lives at `C:\Android\Sdk` — a short path with no spaces,
outside any user profile and outside any MSIX package container. That one choice
avoids three separate failure modes the previous machine hit (see §6).

Android Studio was **not** installed — only the command-line SDK, which is all a
Gradle APK build needs.

`android/local.properties` is gitignored, so it does **not** travel with the repo.
On a fresh clone recreate it:

```properties
sdk.dir=C\:\\Android\\Sdk
```

### Setting this up on a new machine

```bash
winget install --id EclipseAdoptium.Temurin.17.JDK --accept-package-agreements --accept-source-agreements
```

Then unpack the Android command-line tools so that `sdkmanager.bat` ends up at
`C:\Android\Sdk\cmdline-tools\latest\bin\`, and install the three packages the
build needs:

```bash
sdkmanager --sdk_root=C:\Android\Sdk "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

Set the four variables above at User scope, then **open a new terminal** — env
changes do not propagate into already-running shells, and a stale shell will still
report `JAVA_HOME is not set`.

"New terminal" means a new *process tree*. A new tab inside VS Code, Cursor or a
desktop app's integrated terminal inherits the environment block of the editor
process that spawned it, which was captured when that app launched — so the tab
looks new and is not. Restart the host application, or verify from a standalone
Windows Terminal / PowerShell window.

To confirm the persisted values are correct without restarting anything, launch a
process with a freshly-built environment block:

```powershell
Start-Process cmd.exe -ArgumentList '/c','java -version & pause' -UseNewEnvironment
```

`-UseNewEnvironment` rebuilds from the registry instead of inheriting, so it tells
you what a genuinely new shell will see.

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

Environment variables to set in Vercel — two required, one optional:

| Name | Value | |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://iclphobvhjwdinxnqexw.supabase.co` | required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key from Project Settings → API | required |
| `NEXT_PUBLIC_COMPANY_EMAIL_DOMAIN` | e.g. `pmw-group.com` — restricts sign-in to one email domain | optional |

Those are the only three `process.env` reads in the shipped app
(`src/lib/supabase.js` and `src/app/login/page.jsx`).

**All three are inlined at build time, not read at runtime.** This is a static
export — there is no server process on Vercel to read an environment variable, so
`next build` bakes the literal values into the JavaScript bundle. Two consequences:

- Changing a value in the Vercel dashboard does nothing until you **redeploy**.
- `NEXT_PUBLIC_COMPANY_EMAIL_DOMAIN` set in `app/.env.local` but *not* in Vercel
  means the domain restriction applies locally and silently **does not** apply to
  the deployed site. It is a UI convenience either way — the real boundary is RLS,
  not this check — but the two environments will disagree.

The same applies to the APK: `npm run apk` bakes in whatever is in `app/.env.local`
at build time, so web and Android can drift if those two sources differ.

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

**`db push` needs no Docker.** It connects straight to the linked remote project.
Verified on this machine, which has no Docker installed at all: `db push` applied
migrations 0025–0027 over the network. It is `db diff` that needs it, because that
command provisions a shadow database to compare against — and it fails here with
"Docker Desktop is a prerequisite".

Either way: **migrations are the source of truth.** Don't change the schema in
the dashboard SQL editor without writing the migration too, or the next clone
won't match. If a migration ever *is* applied by hand, say so in a comment at the
top of the file, as 0024 does.

Edge Functions deploy separately, and there are two:

```bash
cd app && npx supabase functions deploy admin-users
cd app && npx supabase functions deploy auth-signin --no-verify-jwt
```

`admin-users` exists because setting another user's password requires the
service-role key. `auth-signin` exists because resolving an employee number to a
sign-in address does too — published to `anon` that lookup would be a staff
directory. Its `--no-verify-jwt` is not optional and is also recorded in
`supabase/config.toml`: deployed with verification on, every sign-in is rejected
with a 401 *before a line of the function runs*, and the symptom looks nothing
like the cause because the response never comes from our code.

### Edge Function secrets

Set in the dashboard under Edge Functions → Secrets, or:

```bash
cd app && npx supabase secrets set SITE_URL=https://<the deployed origin>
```

| Secret | Why |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | injected automatically; nothing to do |
| `SITE_URL` | **must be set by hand.** Where a password-recovery link points. |

`SITE_URL` holds the same value as `NEXT_PUBLIC_SITE_URL`, but it is a *function*
secret, not a Vercel variable — an Edge Function has no `window` to read an origin
from, and `window.location.origin` would be wrong anyway in the APK, where
Capacitor serves the same export from `https://localhost`. It must also be listed
under Authentication → URL Configuration → Redirect URLs, or the link is rejected
when it arrives.

`send_recovery_link` refuses to send while it is unset, rather than emailing a link
that points nowhere.

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

## 6. Installing on iPhone and iPad

There is no `npm run ipa`, and the absence is deliberate. A native iOS build
needs macOS, Xcode and a paid Apple Developer account, and installing the result
on anyone's phone needs either the App Store, TestFlight, or an enrolled device
list — none of which this repo builds on. What iOS gets instead is the **same
static export, installed from Safari**, which needs none of those things.

On the phone, against the deployed URL (`NEXT_PUBLIC_SITE_URL`, not localhost —
Safari installs only over HTTPS):

1. Open the site in **Safari**. Chrome and Firefox on iOS cannot install a web
   app; they are Safari with a different wrapper and no share-sheet entry for it.
2. Share → **Add to Home Screen** → Add.

It lands on the springboard as **SI CMMS** with the app icon, and opens full
screen with no address bar and no browser toolbar. `display: standalone` in
`public/manifest.webmanifest` is what makes it full screen on iOS 16.4 and up;
`apple-mobile-web-app-capable` in `layout.jsx` is what does it below that.

What installing actually changes, beyond the icon:

- **Notifications work.** WebKit exposes no Notification API at all to an
  ordinary Safari tab, so the bell's "turn on alerts" offer cannot appear there —
  it shows Add-to-Home-Screen instructions instead. Installed, on iOS 16.4+, the
  offer appears and alerts land in the notification centre. Delivery is via
  `public/sw.js`, because iOS implements `registration.showNotification()` and
  not the `new Notification()` constructor the desktop path uses.
- **"Remember me" stops expiring.** Safari's tracking prevention clears
  script-writable storage for a site not visited in seven days, which includes
  the `localStorage` the remembered session lives in. Installed web apps are not
  subject to that sweep.
- **Sign in once more.** An installed iOS web app has its own cookie and storage
  jar, separate from Safari's, so the first launch is signed out even if Safari
  was signed in. Password-reset links open in Safari for the same reason — set
  the password there, then sign in inside the installed app.

Two differences from the APK worth knowing:

- **No rebuild step.** The APK embeds a snapshot of `out/`; the installed web app
  fetches it, so a Vercel deploy reaches every iPhone on the next launch. `sw.js`
  caches nothing precisely so that this stays true — see the comment at the top
  of that file.
- **Icons are build input, not a sync step.** `npm run icons` writes
  `src/app/apple-icon.png` and `public/icons/*`; they ship on the next
  `npm run build`. No `cap sync` equivalent is involved.

### If a native iOS app is actually required

Capacitor supports it and the plugins this app uses (`local-notifications`) are
cross-platform, so the work is real but not large. It needs, and this machine has
none of them: a Mac running Xcode, CocoaPods, and an Apple Developer Program
membership. The sequence there is `npm i @capacitor/ios`, `npx cap add ios`,
`npm run build && npx cap sync ios`, then signing and distribution in Xcode.
Anything added to `capacitor.config.json` for it applies to Android too, so make
that change on the Mac where it can be tested.

---

## 7. Machine-specific Gradle problems

All diagnosed here so nobody re-derives them. Each one stops the APK build
outright, and none has an error message that points at its real cause.

Which ones apply **right now** (profile `C:\Users\User`, verified 2026-08-11):

| Problem | Applies here? |
|---|---|
| Norton intercepts HTTPS → `PKIX path building failed` | **Yes** — worked around via `JAVA_TOOL_OPTIONS` |
| Capacitor CLI/runtime version drift → `VERSION_21` | **Yes** — fixed by pinning the CLI to 6.x |
| "Unable to establish loopback connection" | No — Gradle's daemon socket works on this machine |
| "SDK location not found" via MSIX redirection | No — the SDK is at a plain path, `C:\Android\Sdk` |
| Keep `JAVA_HOME` on 17 | **Yes** — still a hard constraint |

### `PKIX path building failed` — Norton is intercepting HTTPS

The build-stopper on this machine. `sdkmanager` reports it as a download failure:

```
Warning: Failed to download any source lists!
Warning: IO exception while downloading manifest
Warning: Failed to find package 'platform-tools'
```

and Gradle reports it as a protocol problem, which is a red herring:

```
> The server may not support the client's requested TLS protocol versions: (TLSv1.2, TLSv1.3).
   > (certificate_unknown) PKIX path building failed:
     unable to find valid certification path to requested target
```

**What's actually happening.** Norton Antivirus's Web/Mail Shield terminates
outbound TLS locally and re-signs it with its own CA, so the certificate the JVM
sees for `dl.google.com` is:

```
Subject : CN=*.google.com
Issuer  : CN=Norton Web/Mail Shield Root, O=Norton Web/Mail Shield,
          OU=generated by Norton Antivirus for SSL/TLS scanning
```

That root **is** trusted by Windows, which is why `Invoke-WebRequest`, `npm` and
the browser all work fine. Java does not use the Windows certificate store — it
uses its own `cacerts` — so every JVM-based tool fails and nothing else does.
That asymmetry is the diagnostic: if PowerShell can fetch a URL and Gradle can't,
suspect the truststore, not the network.

`-Djavax.net.ssl.trustStoreType=Windows-ROOT` is enough for `sdkmanager`, but
**not** for Gradle's dependency resolver, which builds its own SSL context. So the
durable fix is a truststore file:

```powershell
# export the Norton root Windows already trusts
$c = Get-Item Cert:\LocalMachine\Root\303ECDCE46AD972415C293DB18ABB9AE3A705F13
[IO.File]::WriteAllBytes("C:\Android\certs\norton-web-mail-shield-root.cer", $c.Export('Cert'))

# start from a COPY of the JDK's cacerts, so the shipped truststore stays pristine
copy "$env:JAVA_HOME\lib\security\cacerts" C:\Android\certs\gradle-truststore.jks
keytool -importcert -noprompt -trustcacerts -alias norton-web-mail-shield `
        -file C:\Android\certs\norton-web-mail-shield-root.cer `
        -keystore C:\Android\certs\gradle-truststore.jks -storepass changeit
```

then point every JVM at it via `JAVA_TOOL_OPTIONS` (§1).

Two deliberate choices. The truststore is a **copy**, not the JDK's own `cacerts`,
so a JDK update can't silently drop the entry and nothing else on the machine has
its trust widened. And the CA imported is one Windows **already** trusts from a
locally-installed product — this adds no trust that wasn't already there.

To undo it entirely: delete `C:\Android\certs` and clear `JAVA_TOOL_OPTIONS`. If
you later exclude these hosts from Norton's HTTPS scanning, do exactly that.

### Capacitor CLI and runtime must be the same major version

`npm run apk` runs `cap sync`, and **`cap sync` rewrites
`android/app/capacitor.build.gradle`** from the CLI's own template. With
`@capacitor/cli` on 8.x and `@capacitor/core`/`@capacitor/android` on 6.x, the
sync silently rewrote:

```diff
-      sourceCompatibility JavaVersion.VERSION_17
-      targetCompatibility JavaVersion.VERSION_17
+      sourceCompatibility JavaVersion.VERSION_21
+      targetCompatibility JavaVersion.VERSION_21
```

which this project cannot build: it is Gradle 8.2.1 + AGP 8.2.1, and Gradle only
gained JDK 21 support in 8.5.

The file's own header says `DO NOT EDIT THIS FILE` and it means it — editing it
back is pointless, the next `cap sync` overwrites it again. Fix the version drift
instead, and keep all three Capacitor packages on the same major:

```bash
npm install --save-dev @capacitor/cli@^6.2.1
npx cap sync android
git diff --stat app/android/     # must be empty
```

A clean `git diff` on `app/android/` after a sync is the check that CLI and
runtime agree. Moving to Capacitor 8 for real is a coordinated upgrade —
`core` + `android` + `cli` together, plus AGP and Gradle — not a CLI bump.

### "Unable to establish loopback connection"

> **Does not apply to the current machine.** Kept because the diagnosis is hard to
> re-derive and the cause (a filter driver interfering with the Temp folder) can
> reappear. Everything below is written for the *old* profile
> (`C:\Users\Ahmad Amirul`) where it was reproduced. Note that `JAVA_TOOL_OPTIONS`
> is now in use here for an unrelated reason — the Norton truststore above — so if
> you ever need this workaround too, **append** to that variable rather than
> replacing it.

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

> **Does not apply to the current machine** — the SDK sits at `C:\Android\Sdk`,
> a plain path outside any package container, precisely so this cannot recur.
> Kept as the reason that location was chosen.

The build-stopper on the old machine:

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
org.gradle.java.home=C:/Program Files/Eclipse Adoptium/jdk-17.0.20.8-hotspot
```

Note that a JDK 21 runtime is already present on this machine, bundled inside
Angry IP Scanner (`C:\Program Files\Angry IP Scanner\jre`). It is a JRE — no
`javac` — so it can never satisfy a Gradle build, but it will answer
`java -version` if it ever reaches `PATH`. Don't let it.

---

## 8. Everyday commands

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
| `npm run icons` | Re-render the launcher, favicon and iOS/PWA icons from `resources/*.svg` |

**Do not run `npm run build` while `npm run dev` is running.** They share
`.next`, and the production build corrupts the dev server's cache — every chunk
starts returning 500 and the page silently fails to hydrate. Stop the dev server
first, or `rm -rf .next` afterwards.

---

## 9. Known gaps

- The status change and its `work_order_history` row are now atomic
  (`si_transition_work_order`, migration 0010), but **editing** a work order's
  core fields while it is Open still writes no history entry.
- `@capacitor/cli` pulls a `tar` version with a critical advisory. Fixing it
  needs a Capacitor 6 → 8 major upgrade, which has its own breaking changes.
- The APK cannot reach a `localhost` dev server from a real phone. Use
  `npm run dev` in a desktop browser, or `adb reverse tcp:3000 tcp:3000` for a
  USB-connected device.
