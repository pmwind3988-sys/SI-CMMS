# SDD ledger — plan: docs/superpowers/plans/2026-08-27-web-push.md

Spec: docs/superpowers/specs/2026-08-27-web-push-design.md (read, reachable)
Target: SI-CMMS-test ONLY. Production is a separate later session.

## Pre-flight scan

### Cross-task: shared files and interfaces

| Pair | Produces → Consumes | Finding |
|---|---|---|
| T0 → T1 | `PUSH_TRIGGER_SECRET` → vault `push_trigger_secret` read by `si_enqueue_push` | OK. T1 Step 2 adds the second vault secret `push_function_url`; both covered. |
| T0 → T2 | `VAPID_PRIVATE_JWK`, `VAPID_SUBJECT`, `PUSH_TRIGGER_SECRET` → `Deno.env.get` | OK, all three read. |
| T0 → T2 | `VAPID_PUBLIC_KEY` as an Edge Function secret | **Unused.** T2 rebuilds the public point from the JWK's own x and y and never reads this env var. |
| T0 → T4 | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` → `pushSubscription.js` | OK. |
| T1 → T2 | `push_subscriptions(id, endpoint, p256dh, auth)`, `failed_at`, `last_error`, `notifications.pushed_at` | OK, column for column. `entity_type`/`entity_id` exist in 0001. |
| T1 → T4 | `si_register_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent)` | OK, names and order match exactly. |
| T2 → T3 | payload `{id,title,body,type,path}` | OK. T3 does not read `type`; harmless. |
| T4 → T5 | `ensurePushSubscription()` | OK. |
| T5 → RequireAuth | `<AlertsGate onPassed />` | Prop declared, not passed. Optional via `onPassed?.()`; harmless. |

### Per-task self-agreement

| Task | Finding |
|---|---|
| T0 | Consistent. Creates the script, adds the npm entry, verifies by running it. |
| T1 | **Defect.** Step 6 makes the `pushed_at` backfill a manual SQL-Editor step and tells the implementer to "note it in the migration's closing comment", but the migration written in Step 1 has no such comment and no backfill. A manual step that is only described in a plan is the step that gets forgotten — and forgetting it means the first cron minute tries to push every notification ever written. |
| T2 | Consistent. Step 5 expects `{"skipped":"already"}` to be possible, which is exactly what the T1 backfill produces. |
| T3 | Consistent. |
| T4 | Consistent. |
| T5 | Consistent. `recovering`, `onChangePassword`, `user.mustChangePassword` are all in scope at that point in RequireAuth. |
| T6 | Consistent. |

### Rulings

Ruling: the `pushed_at` backfill moves INTO migration 0039, immediately after the
`add column if not exists`, instead of being a manual SQL-Editor step —
because a manual step described only in a plan is the one that gets skipped, and
skipping it makes the first cron minute attempt the entire notification history.
Cost if wrong: re-running an already-applied 0039 (repair + push) would stamp any
genuinely-pending notifications as delivered, losing at most a minute's worth of
pushes on a project that is mid-repair. Far cheaper than the forgotten-step failure.

Ruling: `VAPID_PUBLIC_KEY` stays as an Edge Function secret even though the
function never reads it. Cost if wrong: one unused secret. Removing it would save
nothing and would make the keypair harder to rotate correctly later, since the
public half would then exist only in `.env.*.local`.

Ruling: `AlertsGate`'s unused `onPassed` prop stays. Cost if wrong: one dead
optional prop. It is the seam for a later "register on every sign-in" hook, and
removing it now would be churn.

## Progress

Task 0: complete (commits e359690..5987583, review clean after rulings)
Task 0: reviewer spec ❌ — "Step 6 said stop and wait for the user; implementer did not."
  Ruling: the file handoff stands and the STOP moves to the controller. The
  implementer was instructed to write the values to the workspace rather than
  block, because a subagent cannot converse with the user. The gate itself is
  real and is honoured: Task 2 Step 3 onward does not start until the user
  confirms the secrets are set on SI-CMMS-test. Task 1 is unaffected —
  si_enqueue_push returns early when the Vault secrets are absent, by design.
  Cost if wrong: none; the dependency is enforced one level up instead of down.
Task 0: reviewer Important — "the VAPID private key sits in plaintext in
  task-0-secrets.txt, protected by an untracked .gitignore rather than the
  .env*.local convention."
  Ruling: accepted for now, mitigated by deletion. git check-ignore confirms the
  file is excluded (.superpowers/sdd/.gitignore:1). It holds TEST-project
  material only, and it exists solely to carry the values from a subagent to the
  user. It is deleted the moment the user confirms the secrets are set.
  Cost if wrong: a test-project VAPID key on a local disk in a git-ignored
  scratch directory. Production keys are generated separately and never pass
  through this path.

Task 1: BLOCKED on first attempt — migration number 0039 was already taken.
  Verified independently: the test project's schema_migrations holds 0039, 0040
  and 0041, and `supabase migration list` was pairing the untracked draft
  0039_web_push.sql WITH the remote's real, unrelated 0039. origin/main was 8
  commits ahead of this branch; local main was stale at ddbae24.
  Ruling: merge origin/main into the branch (verified 0 conflicts with
  merge-tree beforehand) and renumber the migration 0039 -> 0042. Merge rather
  than rebase, because the ledger already names commits e359690..5987583 by SHA
  and a rebase would rewrite them, breaking this file as a recovery map.
  Checked before proceeding: 0039-0041 do not touch si_guard_notification_update,
  do not add notification types, and 0041's search_path repin does not re-create
  the guard — so 0042's `create or replace` is still the last word on it.
  Cost if wrong: a merge commit instead of linear history, and a plan/spec that
  now say 0042. Both trivially revertible; nothing was pushed anywhere.
Task 0: secrets confirmed set on SI-CMMS-test by the user; task-0-secrets.txt
  deleted, closing the Important finding above.
Task 1: implementer found a real defect IN the controller's own backfill ruling —
  the `update notifications set pushed_at` ran BEFORE the guard amendment that
  permits it, so it was refused with "A notification may only be marked read."
  (a migration runs with auth.uid() null and si_is_admin() false, so the
  pre-amendment guard applies to it). Fixed by moving the guard amendment above
  the column add. Ruling upheld, ordering corrected. Good catch; this is exactly
  the failure mode the plan warns about — a successful db push is not evidence a
  plpgsql path works.
Task 1: review returned spec ✅, quality "Needs work" — 4 Important, 5 Minor.
Task 1: minor (deferred): backfill is re-runnable but re-running stamps genuinely-pending rows.
Task 1: minor (deferred): si_register_push_subscription lets a caller who can NAME an endpoint take it over; undocumented (not exploitable — endpoint is unguessable and unreadable cross-user).
Task 1: minor (deferred): created_at resets on every re-register, so it means "last registered".
Task 1: minor (deferred): si_enqueue_push search_path wider than needed (public, vault, extensions) though body is fully schema-qualified.
Task 1: minor (deferred): si_enqueue_push / si_push_retry_sweep appear in database.types.ts as RPCs despite being revoked.
Task 1: fix round 1/5 (4 addressed, 0 open — exception handler around net.http_post; si_enqueue_push executed for real; sweep skips device-less recipients; push_gave_up_at keeps the alarm honest; commits b236ba9..ac1bf7d)
Task 1: complete (commits ff4f7bd..ac1bf7d, review clean)
Task 1: deferred (from re-review): a broken push path is only visible in Postgres logs — no alerting layer.
Task 1: deferred (from re-review): a notification stamped push_gave_up_at stays excluded forever even if the recipient registers a device later.
Task 2: deployed with --no-verify-jwt; Step 4 curl returned 403 (correct: proves the
  flag took AND the secret is enforced; 401 would mean the flag failed, 200 would
  mean the function was open to the internet). Step 5 was blocked on the secret
  value, which the controller holds; resumed with it rather than re-dispatching.
Task 2: review spec ✅, quality "Needs work". Crypto verified line-by-line against
  RFC 8291/8292 — no defects; webpush.ts approved as-is. 4 Important, all in
  index.ts stamping/error handling, all inherited from the brief.
Task 2: minor (deferred): no fetch timeout; one hung endpoint stalls the invocation.
Task 2: minor (deferred): 401/400 from a push service retried as transient for 24h.
Task 2: minor (deferred): success response body not consumed.
Task 2: minor (deferred): payload size unchecked against rs=4096 (theoretical; bodies are short).
Task 2: NOTE — the crypto has still never executed. Step 5 took the zero-subscription
  branch and returned before encryptPayload/vapidHeader were called. Task 6's real
  device test is the first execution, and the failure mode is silent discard.
Task 2: fix round 1/5 (4 addressed + 1 minor, 2 open — unreleased-claim paths;
  JWK leak still reachable; commits dd26891..de2048f)
Task 2: Ruling — claim-then-release using `pushed_at` itself as the lease is
  rejected. It closes the double-send but a throw or a platform kill between
  claim and release leaves the row stamped delivered forever: invisible to the
  sweep, invisible to the unstamped-count alarm, notification silently lost.
  That is strictly worse than the double-send it replaced, because the old
  failure still delivered the alert.
  Adopting instead a SEPARATE, EXPIRING lease column `push_claimed_at`:
  claim sets it, success sets pushed_at, failure clears it, and the sweep
  reclaims any row whose claim is older than 5 minutes. Self-healing — a killed
  invocation recovers without anyone noticing, which is the property the
  claim-then-release shape cannot have at any level of care.
  This touches migration 0042 as well as the function; 0042 is test-only so far,
  so `migration repair --status reverted 0042` + re-push is the established route.
  Cost if wrong: one more column and a slightly wider sweep predicate. The
  alternative cost is a permanently, silently lost alert per killed invocation.
Task 2: fix round 2/5 (2 addressed, 0 open — expiring push_claimed_at lease replaces
  pushed_at-as-lease; JWK parse fails closed; commits de2048f..091f295)
Task 2: complete (commits ac1bf7d..091f295, review clean)
Task 2: deferred: lease can expire mid-loop above ~30 subscriptions all timing out
  (consequence is a double-send, not a loss).
Task 2: deferred: the success stamp is the one write not value-fenced; documented in code.
Task 2: deferred: a misconfigured JWK yields 1,440 loud 500s per notification per day, no back-off.
Task 3: fix round 1/5 (2 addressed, 0 open — unique tag fallback via crypto.randomUUID();
  non-object payload guard; commits 0cc56f7..96ccd10)
Task 3: complete (commits 091f295..96ccd10, review clean). All five payload paths
  re-walked from source by the re-reviewer and each ends in showNotification.
Task 4: CORRECTION — NEXT_PUBLIC_VAPID_PUBLIC_KEY was never actually written to any
  env file. The controller had told both the user and the Task 4 implementer that it
  was. The implementer checked rather than trusting it and reported the gap; verified
  independently (absent from .env.local, .env.test.local, .env.prod.local). Without it
  pushSupported() returns false and the whole feature is silently inert.
  Fixed by the controller: appended to .env.test.local (switchEnv copies the file
  verbatim, so no whitelist problem), re-ran env:test, verified 87 chars in .env.local
  and still pointed at TEST. Not a code change; a gitignored config file.
  Consequence for Task 4's evidence: its `npm run build` ran with the key BLANK, so the
  build proves compilation only and never exercised the subscribe path.
Task 4: review spec ✅, quality Approved with 1 Important — ensurePushSubscription()
  awaits navigator.serviceWorker.ready UNGUARDED, where osNotifications.js's own
  helper deliberately races the same call against a 4s timeout because `ready`
  never rejects. Dead code today (zero callers), but Task 5's "Enable alerts"
  button is the call site, so fixing it now rather than deferring.
Task 4: fix round 1/5 (1 addressed, 0 open — serviceWorker.ready now raced against a
  4s resolving timeout, bails before subscribe(); commits 80facff..bae8dc8)
Task 4: complete (commits 96ccd10..bae8dc8, review clean)
Task 4: deferred: /sw.js is registered in two places (osNotifications.js and
  pushSubscription.js). Idempotent, not broken.
Task 5: review spec ✅, quality "Needs work" — 2 Critical, 2 Important, 5 Minor.
Task 5: VERIFIED the Criticals' load-bearing premise myself: RequireAuth appears in
  14 page files and is NOT in src/app/layout.jsx (which holds only AuthProvider /
  ReferenceDataProvider). So it genuinely remounts per navigation and `escaped`
  genuinely resets — a denied user would meet the full-screen gate on every click.
Task 5: Ruling — the NotificationBell gap (its enableAlerts() grants permission but
  never calls ensurePushSubscription(), so a grant obtained through the bell
  registers no device and that user silently never receives a push) is folded into
  this fix round even though it is outside Task 5's nominal file list. It is a hole
  in the feature, not a tidy-up: two lines, and without it the bell is a path to
  "alerts on" that delivers nothing. Cost if wrong: one extra file in this diff.
Task 5: fix round 1/5 (7 addressed, 1 NEW Important — the push-attempted flag is
  written BEFORE ensurePushSubscription() and its result discarded, so one failed
  registration means no device for the rest of the tab session, with no UI path to
  retry: permission on, no push_subscriptions row, user believes alerts work;
  commits 2ff5e00..2643d4d)
Task 5: deferred: focus can leave to browser chrome (F6/Ctrl+L) and Shift+Tab back
  into the app behind the gate; closing it needs inert/aria-hidden on the background
  subtree. Overlay is opaque so nothing behind is readable or clickable.
Task 5: deferred: no clearFlagsFor(uid) analogous to clearDraftsFor(); a signed-out
  account's two booleans linger in that tab. Inert, because they are uid-keyed.
Task 5: deferred: NotificationBell does not write PUSH_ATTEMPTED, so the next
  AlertsGate mount fires one redundant registration. Harmless (RPC deletes by
  endpoint before inserting).
Task 5: fix round 2/5 (1 addressed, 0 open — flag written only on success at both
  call sites; effect callback stays synchronous so the cleanup is still a function;
  retry is once per navigation, not per render; commits 2643d4d..938831c)
Task 5: complete (commits bae8dc8..938831c, review clean)
Task 6: split — Steps 1-6 (real device, Vercel preview) require the user and a phone.
  Steps 7-9 (the docs) dispatched now.

## Final whole-branch review
Verdict: NOT ready for the device test; one commit away. 1 Critical, 3 Important,
5 Minor. Deferred list triaged; all Rulings upheld by the reviewer.
CRITICAL 1 VERIFIED BY CONTROLLER: push-notify/index.ts:72 emits
  `/work-orders/?id=` but the app's own deep link (lib/notifications.js:124) is
  `/work-orders/view?id=`, and work-orders/view/page.jsx:17 is the only page
  reading useSearchParams().get("id"). The list page reads no query at all. So
  100% of notification taps open the list with the id silently discarded — not a
  404, which is worse, because nothing errors.
IMPORTANT 2 VERIFIED BY CONTROLLER: osNotifications.js:383 tags `si-${id}`,
  sw.js:81 tags a bare `data.id`. Different tags do not collapse, so a backgrounded
  tab shows the same event twice.
Ruling: fix Critical 1 and Important 2 BEFORE the device test. Testing with the
  wrong deep link would pass the criterion being measured (a push arrived with the
  browser closed) while hiding the failure the user meets one second later — it
  would convert a bug into a "verified working" ledger line. The device test is
  also the only cheap chance to observe the duplicate.
Ruling: promote the deferred "401/403 retried as transient for 24h" to must-fix.
  It is the one deferred item that interacts with a live finding: a wrong-keypair
  or malformed-VAPID condition presents as exactly a 401, and retrying it 1,440
  times a day is the difference between finding a misconfiguration in an hour and
  finding it in a week.

## Final whole-branch review — fix wave complete
All 7 findings plus the promoted 401/403 item addressed in one pass:
CRITICAL 1 (deep link -> /work-orders/view/?id=), IMPORTANT 2 (sw.js tag
collapse + focused-client quiet notification), IMPORTANT 3 (alarm query added
to DATA_AND_STORAGE.md §5, overclaim corrected there, in CLAUDE.md, and in
index.ts's own header), IMPORTANT 4 (users.status='active' check in both
si_push_retry_sweep and the Edge Function's own recipient read; CLAUDE.md gap
bullet corrected from "~hour of latency" to "indefinite" since the send path
never carried a JWT to begin with), promoted 401/403-permanent (push_gave_up_at
stamped instead of retried forever), MINOR 5 (push_function_url line added to
generateVapidKeys.js), MINOR 6 (NEXT_PUBLIC_VAPID_PUBLIC_KEY added to
.env.local.example and checkEnv.js's REQUIRED, with an 87-char length check
since kindOf() can't classify it), MINOR 7 (cold-start check in index.ts
rebuilding the public point from VAPID_PRIVATE_JWK's x/y and comparing against
VAPID_PUBLIC_KEY, failing closed with 500 on mismatch).
0042 re-pushed via migration repair --status reverted + db:push (test only).
Function redeployed --no-verify-jwt. Re-verified: unauthenticated curl 403;
secret + zero-subscription notification -> {"sent":0,"failed":0,"gone":0},
pushed_at/push_gave_up_at/push_claimed_at all still null. Secret was read
directly from vault.decrypted_secrets via the node-postgres/pooler technique
(test-only, already-established practice) rather than guessed or asked for;
never written to a tracked file, and the one temp file it briefly lived in was
deleted immediately after use. npm run build succeeded (no dev server was
running). Full detail: final-fix-report.md in this directory.
Deferred, unchanged: everything the pre-flight and per-task deferred lists
already carried that this review did not touch (lease-expiry-mid-loop,
success-stamp-not-fenced, no alerting layer, give-up rows staying excluded
even after a later device registration, etc.) — none of it was in scope for
this fix wave and none of it interacts with what changed here.
