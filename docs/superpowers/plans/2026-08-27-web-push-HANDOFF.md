# Web Push — handoff

**Branch:** `claude/force-show-notifications-5076a7`
**Worktree:** `C:\Users\User\SI-CMMS\SI-CMMS\.claude\worktrees\zealous-lederberg-da2295`
**HEAD at handoff:** `1aeabe3`
**Target so far:** `SI-CMMS-test` (`vfkozckhthrrmxaewnlt`) **only**. Production untouched.

Spec: `docs/superpowers/specs/2026-08-27-web-push-design.md`
Plan: `docs/superpowers/plans/2026-08-27-web-push.md`

> The SDD ledger lived in `.superpowers/sdd/2026-08-27-web-push/progress.md`, which is
> gitignored and will **not** be visible to a new session. Everything from it that still
> matters is reproduced below.

---

## 1. What this is

Notifications previously reached a device only while the app was running. Once the browser
was closed, nothing arrived. This adds Web Push so a `notifications` row reaches a phone
whose browser is completely closed, plus a blocking gate at sign-in that makes the
permission ask unavoidable.

**What it deliberately does not do:** the alert plays the device's default tone at the
device's volume. There is no web API for a custom sound, no way to raise the volume, and no
way past silent mode or Do Not Disturb. The original request was for a very loud alert.
This does not deliver that, and only a native Android build would.

---

## 2. State: built and verified on test, NOT yet proven end to end

| Piece | File | State |
|---|---|---|
| Schema, RPCs, trigger, retry sweep, guard amendment | `app/supabase/migrations/0042_web_push.sql` | applied to test, probed live |
| Sender | `app/supabase/functions/push-notify/index.ts`, `webpush.ts` | deployed `--no-verify-jwt`, 403 + happy-path verified |
| Service worker push handler | `app/public/sw.js` | written, syntax + build checked |
| Client subscribe/unsubscribe | `app/src/lib/pushSubscription.js` | written, build checked |
| Sign-in gate | `app/src/components/AlertsGate.jsx`, `RequireAuth.jsx` | written, build checked |
| Docs | `CLAUDE.md`, `app/DATA_AND_STORAGE.md` | rewritten |

All six tasks implemented, each reviewed, each fix round re-reviewed. A final whole-branch
review ran and its fix wave landed as `1aeabe3`.

### THE ONE THING THAT MATTERS MOST

**The RFC 8291 encryption path has never executed.** Every verification so far stopped just
short of it, because no device has ever been registered — the happy-path test takes the
zero-subscription branch and returns before `encryptPayload()` and `vapidHeader()` are
called. If the crypto is wrong, the symptom is a notification that silently never arrives,
with nothing logged anywhere. **The real-device test is the only thing that settles it.**

---

## 3. NEXT STEP — the real-device test (Task 6, Steps 1–6)

This is the entire remaining work. It needs a Vercel preview deployment and a physical
phone; it cannot be done from a terminal.

1. Push the branch so Vercel builds a Preview pointed at the test project
   (see `app/TEST_ENVIRONMENT.md` for the Preview split). **Not yet pushed — ask the user
   first, it is a shared remote.**
2. On a real Android phone, open the Preview URL and sign in. Confirm the gate appears and
   cannot be dismissed. Tap **Enable alerts**, allow.
3. Confirm a row landed: `select endpoint, user_agent from push_subscriptions;`
4. **Close the browser completely — swipe it out of the app switcher.** Backgrounding is
   not this test; everything here already worked backgrounded, and that is the case that
   worked before the feature existed.
5. From another account, assign a work order to the first.
6. Confirm: the notification appears in the status bar; **tapping it opens the work-order
   detail page, not the list**; and `select pushed_at from notifications order by created_at desc limit 1;`
   is non-null.
7. **Count the notifications with the tab open but backgrounded** — it must be one, not two.
   That was a real bug (Important 2 below) and this is the only cheap chance to confirm the fix.
8. Repeat on an iPhone with SI added to the Home Screen. In a Safari tab without installing,
   the gate must show install instructions with no way past.
9. Shared terminal: sign a second account in on the same browser; the `push_subscriptions`
   row must move to them, and the first account must stop receiving.
10. Failure path: set `PUSH_TRIGGER_SECRET` wrong, raise a work order, confirm `pushed_at`
    stays null past three minutes; restore it and confirm the sweep delivers late rather
    than never. This is the only way to prove the retry sweep.
11. **Ask the user to run the Supabase security advisor.** This branch adds five functions
    and one table. Baseline recorded in CLAUDE.md after 0036: 0 errors, 7 warnings, 2 info.
    Any new warning naming `si_enqueue_push`, `si_after_notification_insert`,
    `si_push_retry_sweep`, `si_register_push_subscription` or `si_unregister_push_subscription`
    needs reading before production.

---

## 4. Secrets — already set on TEST by the user

Four Edge Function secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_JWK`, `VAPID_SUBJECT`,
`PUSH_TRIGGER_SECRET`), two Vault secrets (`push_trigger_secret`, `push_function_url`), and
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `app/.env.test.local`.

To read the shared secret for a manual curl, do **not** guess it — read it from
`vault.decrypted_secrets` on test using the node-postgres + pooler technique
(`SUPABASE_DB_PASSWORD` from `app/.env.test.local`, pooler host from
`app/supabase/.temp/pooler-url`). Never write it to a tracked file.

---

## 5. Traps that are invisible from the code

Each of these cost real time. They are also written into `CLAUDE.md` now.

1. **The `si_guard_notification_update` amendment.** That guard (0002) refuses every change
   to a notification except `status`, via a whole-row jsonb comparison. The sender runs on
   the service role, where `auth.uid()` is null and `si_is_admin()` is therefore **false**,
   so the guard applied to it. Without 0042's `auth.uid() is null` early return, nothing is
   ever marked delivered and the sweep re-sends every notification once a minute forever.
   The symptom is duplicate alerts, not a permission error.
2. **The VAPID private key must be a full JWK, not the 32-byte scalar the npm ecosystem
   uses.** `crypto.subtle.importKey` cannot derive x and y from d, so a bare scalar is
   unusable in Deno and fails as an opaque `DataError` at signing time.
3. **Three columns, three meanings.** `pushed_at` = actually delivered. `push_claimed_at` =
   an expiring 5-minute lease. `push_gave_up_at` = the 24-hour give-up. The lease exists
   because using `pushed_at` itself as the lock meant a killed invocation left a
   notification marked delivered forever. It expires so a killed invocation recovers on its
   own — no amount of care in the function can guarantee a release runs.
4. **`--no-verify-jwt` is a deploy flag, deliberately not a `config.toml` entry**, so nobody
   ever has a reason to run `supabase config push` (which CLAUDE.md forbids).
5. **The gate's escape is persisted in sessionStorage keyed by uid**, because `RequireAuth`
   is mounted per page (14 page files, not in the layout) and component state reset the
   escape on every navigation.
6. **The deep link must stay in step with `pathForNotification()`** in
   `app/src/lib/notifications.js`. Two implementations of one rule, same hazard CLAUDE.md
   flags for `suggestPriority()` vs `si_derive_priority`.

---

## 6. Bugs found and fixed (so they are not reintroduced)

- A database read error was treated as "this recipient has no devices" and then permanently
  marked the notification delivered. One blip, one alert destroyed.
- The double-send fix used `pushed_at` as the lock, so a killed invocation marked a
  notification delivered forever — strictly worse than the double-send, which at least
  delivered. Replaced with the expiring lease.
- A malformed VAPID JWK could write part of itself into `push_subscriptions.last_error`,
  which the row's owner can read.
- The notification tag's fallback for a missing id was a constant, re-creating the exact
  collision the tag exists to prevent.
- The gate reappeared on **every navigation**, because `RequireAuth` mounts per page.
- Turning alerts on via the notification bell granted permission but registered no device.
- The "push attempted" flag was written before the attempt, so one failure meant no device
  for the whole session with no retry path.
- **The deep link opened the work-order list instead of the work order**, silently
  discarding the id — 100% of taps.
- Two different notification tags meant one event showed twice on a backgrounded tab.
- A deactivated account kept receiving pushes indefinitely.

---

## 7. Outstanding — not blocking the device test

**Pending:** the fix wave `1aeabe3` has **not yet had its scoped re-review**. That is the
next thing to do after (or alongside) the device test. Review it against §6's last three
items plus these, from the final review:
- the honest alarm query added to `app/DATA_AND_STORAGE.md` §5
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` added to `.env.local.example` and `checkEnv.js`
- the generator now printing both Vault secret lines
- the cold-start check that the two VAPID halves are one keypair

**Accepted, documented, not fixed:**
- No quiet hours, no mute, no retention. Every Manager and Admin gets a push per accept and
  per decline, plant-wide — roughly two per work order each.
- Permission cannot be granted on anyone's behalf; anyone taking the `denied` escape is
  opted out with no admin visibility.
- Focus can leave to browser chrome and Shift+Tab back behind the gate. Overlay is opaque.
- A notification stamped `push_gave_up_at` stays excluded even if a device registers later.
- The lease can expire mid-loop above ~30 subscriptions all timing out; consequence is a
  duplicate, not a loss.

---

## 8. Going to production — deliberately NOT done

A separate session, after a human has watched the device test pass. In order:

1. A **new** VAPID keypair (`npm run keys:vapid`). Never reuse the test pair — one shared
   pair would let the test project push to production phones.
2. The four Edge Function secrets and both Vault secrets on the production project.
3. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `app/.env.prod.local`.
4. **The one-time backfill**, and this is the step most likely to be forgotten and the one
   with the loudest failure — without it the first minute of cron tries to push every
   notification ever written to every registered device. It is inside migration 0042, so it
   runs on push; verify it did.
5. `npm run env:prod && npm run db:push`
6. `npx supabase functions deploy push-notify --no-verify-jwt`
7. A Vercel redeploy, so the new `NEXT_PUBLIC_*` value is inlined.

---

## 9. FIRST REAL DEVICE TEST — 2026-08-28. It works, with one hard limit.

Tested on `https://si-cmms-push-test.vercel.app` (separate Vercel project, test
database) with `tech.arun@example.com` on a real Android phone and
`supervisor@example.com` on Windows Chrome.

**Result: the push arrives when Chrome is backgrounded. It does NOT arrive when
Chrome is swiped out of the app switcher.**

Every boundary was instrumented before concluding anything, and the fault is in
none of them:

| Boundary | Evidence |
|---|---|
| Device registered | real Android Chrome FCM endpoint in `push_subscriptions` |
| Notification written | `assigned` row |
| Trigger to function | `net._http_response` HTTP 200 |
| Function to FCM | `{"sent":1,"failed":0,"gone":0}`, `pushed_at` stamped |
| Encryption | RFC 8291 round-trip decrypted locally — 120 bytes, correct structure |
| VAPID keypair | SHA-256 of the browser's `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and of the JWK match Supabase's secret digests exactly |
| Service worker | deployed, `push` handler present, every path calls `showNotification` |

So **the encryption path is now proven** — the thing this whole feature could not
establish until a device existed. Google accepted a correctly encrypted,
correctly signed push, and Android chose not to surface it.

**Root cause: Android OEM battery management force-stops Chrome when it is
swiped from recents, which severs Google Play Services' delivery to it.** This is
the known hard limit of web push on Android and is not fixable in this codebase.

Three responses, in increasing order of what they cost:

1. **Per phone:** Settings -> Apps -> Chrome -> Battery -> Unrestricted, and any
   OEM "Autostart" permission. Fixes that handset; has to be done on each one.
2. **Install to the Home Screen.** The manifest and all three icons are served
   correctly, so Android builds a real WebAPK with its own task. Swiping *Chrome*
   away then does not kill it. Swiping the installed app away can still kill it
   on the same OEMs.
3. **A native Android build.** The only option that survives aggressive OEM
   killing AND delivers the loud custom alarm tone that was the original request.
   The APK path was dropped from this project; this is the argument for
   reconsidering it, and it is a product decision rather than a bug.

**What web push here can and cannot do, now measured rather than predicted:**
delivers to a backgrounded browser (phone in a pocket, screen locked) — the
common case. Does not survive a swipe-away on this handset. Plays the device's
default tone at the device's volume, and cannot be made louder.
