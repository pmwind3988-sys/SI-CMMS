# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SI — Service Inside: a CMMS work order module. Next.js 14 (static export, every page
`"use client"`) + Supabase (Postgres) + Vercel for web, Capacitor for Android, and an
installable home-screen web app on iOS.

The runnable app lives in `app/`. `docs/` holds the specs, `prototypes/` standalone HTML
click-throughs, `archive/` superseded iterations (never use as reference).

## Commands

All from `app/`:

```bash
npm run dev              # dev server (port 3000)
npm run build            # static export into out/
npm run lint             # next lint
```

Database (Supabase CLI; `db:diff` needs Docker, `db:push` does not):

```bash
npm run db:push          # apply pending migrations — connects to the linked remote, no Docker
npm run db:diff          # diff live schema against migrations — needs Docker (shadow database)
npm run db:types         # regenerate src/lib/database.types.ts from live schema
npm run bootstrap:users  # create the 6 role users
npm run seed:demo        # one demo work order walked through the real workflow
```

**There are two Supabase projects.** `SI-CMMS` (`iclphobvhjwdinxnqexw`) and
`SI-CMMS-test` (`vfkozckhthrrmxaewnlt`), and which one every command above talks
to is a mode you switch:

```bash
npm run env:which        # which project am I pointed at?
npm run env:test         # point everything at test
npm run env:prod         # point everything back
npm run clone:config     # copy prod's departments/equipment/labels into test
```

Full detail in `app/TEST_ENVIRONMENT.md`. Four things matter here:

- **The switch moves two things, not one.** `app/.env.local` is what the app and
  `scripts/` read; `supabase/.temp/project-ref` is what `db push` and `db:types`
  *write to*. Move only the first and `db push` applies an untested migration to
  production while the app in front of you reads test — both commands succeed and
  nothing warns. `switchEnv.js` moves both or exits non-zero, and `env:which`
  fails if it ever finds them disagreeing.
- **`app/.env.local` is generated now.** The real values live in
  `app/.env.prod.local` and `app/.env.test.local` (both already gitignored by
  `.env*.local`). Edit those and re-run the switch; edits to `.env.local` are
  lost on the next flip.
- **`bootstrap:users` and `seed:demo` refuse to run against production** unless
  given `-- --force`, because the switch is what makes seeding the live system
  possible in the first place. `db:push` is deliberately unguarded.
- **Never run `supabase config push` while linked to production.** It pushes the
  whole auth config with everything unstated filled from CLI defaults, silently
  overwriting the dashboard — measured on test: MFA TOTP off, email confirmations
  off, `otp_length` 8→6. There is no `npm run config:push` on purpose.

Switching does not reload a running dev server: `NEXT_PUBLIC_*` is inlined at
build time, so restart `npm run dev` or the switch looks like it did nothing.

Android:

```bash
npm run apk              # build + cap sync + assembleDebug
npm run apk:record       # record the built APK into apk_builds
```

There is **no test suite** and no test runner configured. Verification is manual, via the
dev server or `npm run lint`.

**Never run `npm run build` while `npm run dev` is live** — they share `.next`, and the
production build corrupts the dev cache (every chunk 500s, page fails to hydrate silently).

`npm run lint` is currently broken on its own: Next 16 removed `next lint`. Until the script
is repointed at ESLint directly, `npm run build` is the compile check.

Environment: `app/.env.local` (copy `.env.local.example`). `SUPABASE_SERVICE_ROLE_KEY` is
read only by the Node scripts in `app/scripts/`; it bypasses RLS and must never be set in
Vercel or prefixed `NEXT_PUBLIC_`.

## Architecture

**The database is the authorization boundary — not the client.** Predicates in
`app/src/lib/constants.js` (`canAssign`, `canEditWhileOpen`, …) decide what to *show*; the
matching RLS policy decides what is *allowed*. When they disagree the policy wins and the
user sees an error, not a silent success. Adding a client predicate without the policy is a
bug; so is loosening a policy to match a predicate.

`app/supabase/migrations/*.sql` is the source of truth for schema, RLS, triggers, cron and
seed data. `app/schema/schema.js` is dead Firestore-era reference documentation.

### Data layer contract

Components **never import `supabase` directly**. They call `listenX(args, cb, onError)` from
`src/lib/*` and get an unsubscribe function back. Keep new code on that contract.

| File | Responsibility |
|---|---|
| `lib/supabase.js` | client, Remember-Me storage adapter, `liveQuery`/`liveRow` |
| `lib/workOrders.js` | every work order read and write |
| `lib/notifications.js` | in-app notifications |
| `lib/osNotifications.js` | presenting one of those in the OS — status bar / notification centre |
| `lib/dashboard.js` | the two precomputed stat rows |
| `lib/datetime.js` | Malaysian dates/times, and the date-range presets |
| `lib/exportWorkOrders.js` | shaping the Excel export (pure; no Supabase, no React) |
| `lib/referenceData.js` | `ReferenceDataProvider` / `useReferenceData()` |
| `lib/admin.js` | user and reference-data administration |
| `lib/errors.js` | `describeError()` |
| `context/AuthContext.js` | session, claims, the single `user` shape |

`liveQuery` re-runs its query on any relevant `postgres_changes` event rather than patching a
local cache — one extra round trip per change, always exactly what RLS returns now.

### The role claim

`role` is reserved by Supabase for the Postgres role PostgREST switches into. The application
roles travel as **`user_roles`** (the set) and **`user_role`** (the highest of them), injected
by `public.custom_access_token_hook`. That hook must be enabled (Authentication → Hooks →
Customize Access Token) or every policy silently denies and users sign in to an empty app.
Consequence: **a role change takes effect only when the token is next issued** (~hourly, or
sign out/in).

`si_roles()` falls back to `array[user_role]` when `user_roles` is absent. That is not
defensiveness: tokens live an hour, so when migration 0020 was applied every signed-in user
was carrying one minted by the old hook. Without the fallback all of them would have been
denied by every policy until their token refreshed — silently, the way the missing
`is_protected` claim failed before 0017.

Roles are lowercase snake_case, matching the `si_role` enum: `requester`, `technician`,
`supervisor`, `manager`, `admin`. Supervisor, Manager and Admin are all system-wide on work
orders; Technician sees what is assigned to them and Requester what they raised. Admin
screens are Admin-only, including for Managers.

### Multi-role (migration 0020)

**An account holds a set of roles, not one.** `users.roles si_role[]` replaced `users.role`,
any combination is allowed, and four rules follow:

- **Authorization is their union, always.** Every `si_is_*()` is a membership test over
  `si_roles()`. On the client, `hasRole()`/`hasAnyRole()` from `lib/roles.js` — never
  `user.role`, which is only the highest and exists for landing pages and badges.
- **Rank is the maximum held**, so every hierarchy rule in 0015 carries over untouched: a
  Supervisor+Technician ranks 3, Administrators still cannot edit each other, only a
  Superuser still makes an Administrator. `si_set_user_roles` additionally requires *every*
  role granted to be below the caller, not just the highest — otherwise `admin` could ride
  along beside `requester` and the pair would pass as rank 5.
- **Nobody assigns work to themselves.** `si_guard_work_order_transition` refuses it, and the
  check sits *above* the admin bypass so it holds for Administrators and Superusers too — the
  same placement 0015 used for the self-role-change lock. Consequence, accepted deliberately:
  if one person is the only active Supervisor *and* the only active Technician, a Manager or
  Admin has to do the assigning.
- **The dashboard switcher is a view control, never a security control.** It changes which
  queue you are looking at; the database grants the union regardless. Nothing may gate a
  capability on it, or a security boundary ends up living in `localStorage`.
- **Anything scoped "to you" needs an ownership test of its own now.** `listenWorkOrderList`
  returns the union, so a Supervisor+Technician receives the whole plant, and every filter that
  leaned on RLS having already narrowed the rows silently became wrong. `RoleDashboard` scopes
  its whole row set by the role being viewed (`ATTENTION[view].scope`) and `WorkOrderList`
  filters its own count; both used to test status alone and both reported other people's jobs
  as the signed-in user's. Supervisor scopes to everything deliberately — an unassigned queue
  is owned by nobody, which is what puts it on their desk. This narrows *display* only, which
  is the sanctioned direction: showing less than the policy allows is fine, and gating a
  capability on it is the line above.

The transition guard no longer asks "what is this person" — it computes which of the caller's
roles authorise the move (`si_eligible_roles`), so a Supervisor+Technician acting on someone
else's job qualifies as supervisor where the old technician check refused them. That same set
stamps `work_order_history.actor_role`, which now records **the role acted under** rather than
the account's identity.

`actor_role`, `author_role`, `uploaded_by_role` and `recipient_role` stay singular. They
record a role in a moment, and a moment still has exactly one.

Supervisor **was** scoped to their `department_id` and is not any more (migration 0019).
`department_id` survives on every table — it routes notifications and is what the dashboard
breaks down by — but it decides nothing about access. The policy and the transition trigger
were changed together; changing only one of them is the failure this migration documents.
`si_in_same_department()` still exists and nothing calls it.

### Account state (migrations 0025, 0026)

**`users.status` and `users.must_change_password` decide access, and they do it in the
token rather than in a policy.** `custom_access_token_hook` withholds `user_roles` *and*
`user_role` from an account that is not `active` or that owes a password change. Every
policy already denies an account whose `si_roles()` is empty, so one mechanism covers both
and not a single policy changed.

Before 0026, `status` decided **nothing**. Measured on a freshly minted token for a
deactivated account: `user_roles: ["requester"]`. "Deactivate" in Admin → Users wrote a
column that no policy, trigger or client predicate read.

**Both claims, not one.** `si_roles()` aggregates `user_roles` with `array_agg` inside a
`coalesce`, and `array_agg` over zero rows returns NULL — so `user_roles: []` falls
through to the `user_role` branch and the role comes straight back. The version that
emits an empty array looks correct, denies nothing and raises nothing. `AuthContext`
mirrored the same chain through `profile.roles` and had the same hole from the other side:
`users_select` lets an account read its own row, so the client refilled exactly what the
hook withheld. That fallback is gone, and `roles` is no longer even selected there.

Deactivation is not immediate — tokens live about an hour, the same latency a role change
already has.

`must_change_password` is cleared by `si_sync_auth_user_activity` when the password
actually changes, so **anything that sets the flag must set it after writing the
password.** Reversed, the trigger clears it and the account gets a temporary password with
no obligation attached, silently. `create_user` is the exception and is safe for a
structural reason instead: that trigger fires on UPDATE of `auth.users`, and account
creation INSERTs. `si_guard_user_self_update` refuses to let anyone clear their own flag,
Superuser included, and takes `si_protected_override()`'s door for the trigger's own
write — the same door 0016 opened on the protection guard.

`/change-password` is the only page a flagged account can use, and it must never sit
behind `RequireRole`: the account holds no roles, so a role gate would reject it from the
one thing it is allowed to do. The redirect lives in `RequireAuth` so it takes precedence
over the inner role gate rather than racing it.

**The claim-withholding does not reach the Edge Functions**, and that is not an oversight
in them — `admin-users` re-reads roles from the database precisely so a stale token cannot
be used. It therefore has to check the flag itself, and does. A rule added to one
enforcement point and not the others is a hole, and the loosest path wins.

### Signing in (migration 0027)

Two identifiers, two paths, deliberately. An email address goes straight to GoTrue from
the browser. An employee number goes through the `auth-signin` Edge Function, which
resolves it with `si_email_by_employee_id` on the service-role key — an anon-callable
lookup would be a public staff directory and a credential-stuffing target list. Splitting
rather than routing everything through the function means an outage costs employee-ID
sign-ins only.

Every failure returns one sentence, **on both paths**, from one exported constant. Two
wordings is itself the oracle: it distinguishes an unknown identifier from a wrong
password.

Neither the function nor the lookup filters on `status`. Filtering would make an inactive
account fail at resolution while a wrong password fails at GoTrue, and the two would
become distinguishable. Inactive accounts authenticate normally and are denied by carrying
no roles.

**One message is not sufficient on its own.** Before the fix, an unknown number came back
a median 293ms *faster* than a known number with a wrong password, because it stops at the
lookup instead of reaching GoTrue — enumeration with a stopwatch. It cannot be fixed by
equalising the work: GoTrue is itself slower when the account exists, since that is when
it has a hash to verify. So every refusal leaves through one padded exit with a 1000ms
floor. Successes are not padded; the caller already knows whether they got a session.

`login_attempts` exists because GoTrue throttles by origin and every ID sign-in shares the
function's egress address — without it, adding the function would make brute-force
protection *worse* than not having it. It is a self-expiring delay rather than a lockout,
because the key is a number anyone can read off a badge: a lockout would be a
denial-of-service. A held request does not increment the counter, so nobody can extend
somebody else's delay by hammering it.

### A stale session no longer costs the user their work

**No migration — this is entirely client-side, and nothing about the authorization
boundary changes.**

A session stops working in three quite different ways, and the app used to treat all
three as the worst one: redirect to `/login`, discarding whatever was on screen. On a
phone, on a plant floor, that is a typed fault report gone.

1. **The access token expired, the refresh token is fine.** By far the most common — a
   tab open since Friday, a phone that slept. Recoverable with no password.
2. **The network is down.** The session is perfectly good. Signing anyone out over this
   destroys work in order to react to a condition that fixes itself.
3. **The refresh token was rejected** — revoked, the password changed elsewhere, the
   account deactivated. Nothing can re-authenticate without the password, so the only
   thing left to do well is lose nothing on the way to the sign-in screen.

`AuthContext` owns `sessionState` (`active` / `recovering` / `lost`).
`lib/sessionRecovery.js` is the bus that feeds it — React-free and Supabase-free, because
`lib/supabase.js` imports it and the reverse would be a cycle. `lib/draftRecovery.js` is
the snapshot store.

Six things there are load-bearing:

- **`user` deliberately keeps its value while `recovering`.** `RequireAuth` holds the page
  instead of redirecting, which is the whole mechanism — the tree is both what the user can
  still see and the only thing that can be *asked* for a snapshot if recovery fails. Nulling
  `user` instead makes every mounted component dereference null and crashes the page this
  exists to protect. It is safe for the reason stated at the top of this file: the database
  is the authorization boundary, so a stale client object grants nothing and every request
  still carries whatever token actually exists — during recovery, none.
- **`snapshotDrafts()` must run BEFORE `setUser(null)`.** Clearing the user is what unmounts
  the tree, and a draft is captured by asking the live component for its state. Reversed,
  the feature still compiles, still shows the right banner, still lands on the right page,
  and silently saves nothing every time. Measured: with the tree gone, the registry is empty
  and 0 drafts are written.
- **The registered snapshot function must read a ref, not its closure.** `registerDraftSource`
  runs in an effect with `[]` deps — it has to, or every keystroke rebuilds the registration —
  so the function it registers is the *first* render's. Measured with the ref removed: a full
  complaint typed into the real form, **0 drafts saved**. That is the failure mode this whole
  feature is most likely to ship with, because everything else about it still looks correct.
- **The uid is part of every draft key.** A draft holds free text about a fault plus a name
  and phone number, and the entire premise is that a sign-in screen is about to appear —
  where, on a shared workshop terminal, a *different person* may sign in. They look under
  their own uid and find nothing; `clearDraftsFor()` then removes the previous holder's
  drafts outright, because "unreachable" and "not there" are different claims and only one
  is worth making. Same distinction migration 0029 turned on.
- **Only a retryable failure retries; only an affirmative rejection ends the session.** Being
  offline is not being signed out. `isRetryableFailure()` mirrors the judgement supabase-js
  itself makes — it preserves a session through `AuthRetryableFetchError` and only tears one
  down when the refresh token is refused.
- **`isAuthExpiryError()` is deliberately narrow.** Widening it is how a genuine bug — a
  broken policy, a bad column — stops reaching `onError` and turns into a "signing you back
  in…" banner that never diagnoses itself. An RLS denial, a trigger message and a missing
  column are all explicitly *not* expiry.

**`liveQuery` reports expiry to the bus instead of to `onError`, and re-runs on recovery.**
Measured on the live test project with a token the server refuses: **eleven** listeners
failed at once with `PGRST301` on one page load. Without this the user gets eleven identical
red boxes reading "JWT expired", which names the mechanism and tells them nothing. With it:
one banner, one refresh, zero error boxes, and the list refills itself — the re-run matters
because a listener that failed during the gap otherwise waits for a row to change, which on
a quiet work order is never.

**`RECOVERY_GRACE_MS` exists because of a measurement, not a theory.** That same page load
produced eleven reports and **two** recoveries: ten coalesced into one refresh, and a
straggler whose request had left with the already-replaced token landed afterwards and
started a second, pointless one. Ignoring failures for two seconds after a success took it
to eleven reports, one recovery. It converges either way — this buys a round trip, not
correctness.

**Signing out during recovery is handled explicitly, and has to be.** Pressing Sign out while
the banner is up is the obvious response to it taking a while. Without stopping the loop
there, its next attempt was refused, `abandonRecovery()` filed a resume ticket, and a user
who had deliberately signed out was met with "Your session ended" and an offer to resume —
and `sessionState` was left on `recovering`, the one state `RequireAuth` refuses to redirect
out of, so the app cleared the user, declined to navigate, and rendered nothing at all.

**One documented exception to "role decides the landing page".** The FSD rule stands for a
fresh sign-in. After an expiry, `?reason=expired` plus a resume ticket sends the user back to
where they were — **only when the signed-in uid matches the interrupted one**. Anyone else
gets their own dashboard and the previous holder's drafts are destroyed. This also closes a
standing inconsistency: `RequireAuth` has always set `next` "for session-expiry mid-use" and
the login page never read it.

Scope, deliberately: **the raise/edit work order form only.** Comment drafts, the
WorkflowPanel reasons and the admin forms are not preserved. Photos are not preserved
anywhere and cannot be — they are live browser `File` handles with no serialisable form —
which is why the restore notice names them rather than letting somebody submit a fault
report believing the picture is still attached.

### The role hierarchy (migration 0015)

```
requester(1) → technician(2) → supervisor(3) → manager(4) → admin(5) → superuser(6)
```

**You may write a `users` row if it is your own, or if its rank is strictly below yours.**
`si_account_rank()` / `si_caller_rank()` are the SQL side, `accountRank()` in `lib/roles.js`
the client mirror. The comparison needs no subquery because the row being checked carries
both the roles and the flag being compared — which is why 0020 made `roles` an array column
on `users` rather than a join table. A join table would put a read of `users` inside a policy
on `users`, which is the recursion this schema avoids everywhere.

**Superuser is not a sixth enum value.** It is `role='admin'` plus `users.is_protected`,
injected into the JWT as the `is_protected` claim by `custom_access_token_hook` (migration
0017 — 0002's hook emitted only `user_role`, `department_id` and `plant_ids`, and 0015 was
written believing the flag was already there). That keeps `si_is_admin()` true for them, so
every existing policy, `RequireRole` and transition row applies unchanged and only the rank
comparison sees the extra tier. Adding to the `si_role` enum would have flipped
`si_is_admin()` to false for the account needing the most access.

The failure mode if that claim is missing is silence, not an error: `si_is_superuser()`
returns false, the account is an ordinary rank-5 admin, and the sixth tier simply does not
exist. Anything depending on a claim needs the hook checked, not assumed.

Consequences that are deliberate, not gaps:

- **Only a Superuser can create or promote an Administrator.** 5 is below 6, and not below 5.
- **Admins cannot edit each other.** Same rank, so neither is below the other.
- **Nobody changes their own role or status**, Superuser included — RLS always lets you write
  your own row, so `si_guard_user_self_update` is the only place that hole closes. It also
  removes the last way to lock yourself out.
- The rank rule is uniform at every level, but it does not hand out screens: `users_update`
  still gates its non-self branch on `si_is_admin()`, so Managers and Supervisors write no
  row but their own and `/admin/users` stays Admin-only. Where the uniform rule reaches them
  is `si_set_user_roles`, which they have always been able to call.

Three enforcement points, because two of them bypass RLS: the `users_*` policies; the
`si_set_user_roles` RPC (SECURITY DEFINER); and `supabase/functions/admin-users` (service
role). A rule added to one and not the others is a hole — the loosest path wins.

That is not a caution in the abstract. Migration 0026 enforces `must_change_password` by
withholding role claims, which covers the policies *and* the RPC, because both read
`si_roles()`. It does not reach the Edge Function, which re-reads roles from the database
by design — so a flagged Administrator could set other people's passwords before changing
their own until that function checked the flag itself. Every rule about who may do what to
a `users` row has to be walked through all three.

### Protected accounts

`users.is_protected` marks an account that is administered **only from Supabase**.
`si_guard_protected_user` refuses every write to one, and `users_select` hides it from
everyone but its own holder — so it is absent from Admin → Users, from every count and every
picker, while still able to sign in and use the app normally. Setting the flag is itself
impossible from the app.

That guard was added directly to the hosted project and shipped `SECURITY INVOKER` while
calling a helper granted only to `postgres`, so it raised `permission denied for function
si_protected_override` on *every* write to `users` for *every* role. Migration 0013 fixes it.
Every other guard on this schema is `SECURITY DEFINER`; that is not optional styling.

**All three of those objects were missing from this directory until 2026-08-21, and that made
the schema unbuildable.** `users.is_protected`, `si_protected_override()` and
`si_guard_protected_user()` were created in the dashboard before `supabase/migrations/` existed;
0013's own closing note said so and nothing acted on it for twenty-three migrations. Pushing
0001-0036 into a new project stops dead at 0013 with *"function
public.si_guard_protected_user() does not exist"* — 0013's first statement is an `alter function`
on something no file ever created. Eight migrations assume all three are already there.

They are now **reconstructed at the top of 0013, from the contract those migrations describe
rather than copied from production.** Production's bodies have never been read: that needs
`supabase db dump` (Docker), psql, or a management API token, and this machine has none of the
three. So every statement is conditional on the object being *absent* — on production every test
fails and nothing changes, on a fresh project a working equivalent is created. An unconditional
`create or replace` would have overwritten the real guard with the guess, which is the one
outcome worse than the drift. `0013` carries the SQL to print production's real definitions;
until someone runs it, test's guard is contract-equivalent and not known to be identical.

It had to live in 0013 because **no new migration file can sort between two existing ones.** The
CLI orders by *filename*, and every digit is below `_` in ASCII, so `00125_…` sorts before
`0012_…` rather than after — and it desynchronises the applied-version pairing, after which the
CLI wants to re-apply 0012. A letter suffix sorts correctly and is ignored outright, because the
version parser takes digits only. Both measured. 0013 is already applied on production, so
editing it can never re-run there.

### Test accounts are gone (migrations 0046, 0047)

**There is no such thing as a test account on this schema any more, and no such thing as
test data.** 0028's `users.is_test_account` and 0033/0034's `work_orders.is_test_data` are
both dropped, along with every policy, trigger and predicate built on them.

The argument for keeping fixtures on production expired when `SI-CMMS-test` was stood up.
A fixture existed to be signed into while a change was being tried; there is now a whole
project for that, and an account on production that nobody can account for is a liability
rather than a convenience.

**Two migrations, and the order is the point.** 0046 deletes the five fixture accounts;
0047 removes the machinery. Reversed — or half-applied — the flag disappears while the rows
are still there, and they surface as ordinary staff in Admin → Users and in the technician
roster. That is precisely the outcome 0028 was written to prevent, reached by deleting 0028.

What 0046 could safely do was decided by measurement, not assumption. All five fixtures
returned zero for work orders raised, work orders worked or verified, history rows, comments
and attachments, so `si_guard_user_delete` (0030) never fired and no audit trail was touched.
Had any of them acted on a real work order the migration would have failed on that guard,
loudly, which is the right failure. **That guard has no null-uid early return, deliberately:
it refuses a migration exactly as it refuses an Administrator.**

`is_test_account` is also why 0046 is correct on both projects. The fixtures on
`SI-CMMS-test` were never marked — 0028 backfills from `seed_source` in a one-time UPDATE
that, on a project built from scratch, runs before `bootstrap:users` has created anybody —
so it deletes five rows on production and none on test. The test project keeps the accounts
you actually sign into. A hardcoded email list would have destroyed them.

**What survives, and why.** `user_deletions.is_test_account` stays: that table is an archive,
and 0046 has just written five rows into it with the flag true. Dropping the column would
erase the record of the removal at the moment of recording it — the same reasoning that kept
`priority_touched` as an export column that can now only read "No". `si_is_placeholder_email`
stays too, because `admin-users` still refuses to send a recovery link to an address that can
never receive mail.

**The seeded-demo-data heuristic went with it.** 0012's `si_dummy_flags` computed column and
the `seed_*` columns behind it drove a "Demo accounts" card on the dashboard, a banner and
filter in Admin → Users, and a per-account chip naming why. It measured the same thing by a
different route and has nothing left to measure. Nothing was ever gated on it, which is what
made it safe to remove without ceremony — 0028's header explains why it was never the right
thing to *enforce* with in the first place.

One consequence to know: `canSendRecoveryLink()` used to read `si_dummy_flags`. It now tests
the address against a domain list in `lib/constants.js` that **mirrors
`si_is_placeholder_email`, and must be changed in both places** — the same standing rule that
already binds `suggestPriority()` to `si_derive_priority()`. The server is still the boundary;
the client predicate only avoids offering a button whose one possible outcome is a refusal.

**The dashboard is simpler than it was.** `si_compute_dashboard_stats` and
`si_dashboard_card_rows` are 0034's definitions with the predicates removed and nothing else
altered. Both were replaced *before* the column was dropped — a plpgsql body is not parsed
until it is called, so the reverse order pushes cleanly and leaves both functions to fail at
the next pg_cron sweep. Same trap `si_guard_user_self_update` posed for the `seed_*` columns,
and the same one 0036's header describes from the other direction: **a successful `db push` is
not evidence that a plpgsql function works.**

The known gap CLAUDE.md used to record here — the two timing averages including work a fixture
performed — resolved itself. There are no fixtures, so there is nothing to weigh.

Every user-visible label went with the columns: the amber **Demo** tag on a work order row, the
flask **Test account** badge, the two chart footnotes (`EXCLUDES_TEST_DATA` and the technician
chart's narrower one), and the export's **Test Data** column and its Export Info paragraph.
`RoleDashboard` no longer filters its row set, and `bootstrap:users` no longer writes `seed_*`.

### Estimated downtime is no longer collected

The field is gone from the raise form, and `createWorkOrder()` deliberately does not send
`est_downtime_value` / `est_downtime_unit`. **No migration**: both columns are nullable
(0001), so a new work order simply carries no estimate.

The columns stay, and so do the export's two columns, because the estimates already
recorded are part of those work orders' records. What that costs is one guard: the detail
view rendered `` `${wo.est_downtime_value} ${wo.est_downtime_unit}` `` unconditionally,
which prints the string **"null null"** the moment a work order has neither. It is now
conditional, the same shape the `Area` row already used for rows raised before 0019 —
shown for the work orders raised while the field existed, absent otherwise. Editing an old
work order no longer sends those two keys either, so its estimate survives being edited.

Consequence to expect rather than treat as a bug: the export's "Est. Downtime" and
"Downtime Unit" columns are blank for everything raised from here on.

### Priority is derived, not chosen (migration 0036)

**`work_orders.priority` follows the production impact, and cannot be chosen.** It was a
suggestion the requester could reject; the four priority buttons and the `priority_touched`
flag they set are gone from the raise form. Migration 0051 later added one audited exception,
for an Administrator re-grading a live work order — see "An Administrator may re-grade a
priority" below. Nothing about the derivation changed: the override is a separate column that
`si_force_derived_priority` coalesces over the derived value.

The escalations are **kept**, and that was a deliberate choice against the narrower reading
of "follows the impact": a safety flag still raises the priority to its severity's ceiling
and an environmental flag to Medium's, so the derived value is the most urgent of the three
inputs. Dropping them would have made `safety_severities.escalates_to_priority` decide
nothing, and auxiliary equipment (P3) with a high safety risk would have stopped escalating
to P1 — a safety regression arriving silently.

**The rule lives in a trigger, because a read-only control decides nothing.** This schema
has shipped that bug twice: `users.status` was written by the admin screen and read by no
policy, trigger or predicate for four migrations (0026), and 0031's header makes the same
argument about a retirement that only filters a dropdown. So `si_derive_priority(si_impact,
jsonb, jsonb)` recomputes it and `a00_derive_work_order_priority` (BEFORE INSERT OR UPDATE)
overwrites whatever arrives. Measured against PostgREST: sending `priority: 'P4'` on a work
order whose impact derives P2 stores **P2**, and `priority_touched` comes back false.

`suggestPriority()` in `lib/referenceData.js` is still there and still computes the same
thing. It is not the rule — it is what lets the form show the answer, and the SLA targets
that follow from it, before anything is submitted. **The two must stay in step**; change one
without the other and the form promises one priority while the database stores another.

Four details worth not undoing:

- **`a00_` is load-bearing.** BEFORE row triggers fire in name order, and
  `before_work_order_insert` (0003) computes *both SLA deadlines* from `new.priority`.
  Behind it, the SLA would be calculated from whatever the client sent and then contradict
  the priority actually stored. It also sorts ahead of `a0_guard_retired_reference` (0031),
  so a direct caller passing a retired priority gets it replaced rather than refused for a
  field they do not control — a retired *impact* is still refused, which is right, because
  the impact is chosen.
- **It fires on every UPDATE, not `update of impact, …`.** RLS grants rows, not columns, so
  a column list would leave a bare `update work_orders set priority = 'P1'` unguarded, and
  `updateWorkOrderFields()` forwards an arbitrary `fields` object. Same reasoning as 0033's
  stamp trigger.
- **0036 backfills**, precisely because of the point above: with the trigger on every
  UPDATE, a row disagreeing with its impact would be corrected the next time anyone touched
  it, so a technician accepting a job would bump its priority as a side effect. Correcting
  them at migration time makes that atomic and leaves every later UPDATE a no-op. SLA
  deadlines already set are **not** recomputed — they are a promise made when the work order
  was raised.
- **The form was reordered, not just disabled.** Production impact now sits *above*
  priority, since a derived value printed above its own input reads backwards. Safety and
  environmental risk stayed below it and each gained a visible *"Raises the priority to at
  least Pn"* line: under the old design an override was a deliberate click where the eye
  already was, and now flagging a risk changes a value that may be off the top of the
  screen.

`priority_touched` survives as a column and as the export's "Priority Overridden" column.
It can only read "No" now, but an export is a record and churning a record's shape is worse
than a constant column. 0051's re-grade is reported in three columns of its own rather than
reusing this one — they are different events.

### Four plants, and equipment that belongs to one (migration 0049)

**The plant decides which equipment a work order can be raised against.** `plants` held one
row until now — `PLT001`, "Main Plant", with a Bengaluru address inherited from the
architecture doc — and nothing ever chose one: `createWorkOrder()` hardcoded `'PLT001'` and
no screen showed the field. That is the "single plant" line this file's Known gaps carried
since 0001, and it is closed.

Four sites: `F1` (PMW Industries), `F2` (PMW Concrete Industries), `F3` (PMW Industries F3)
and `FACILITY`. 134 machines loaded from the 2026 Machinery & Equipment Master Lists — F1 63,
F2 38, F3 33 — plus one `Other (specify)` row per plant. Facility has no list of its own
yet, so `Other` is all it offers.

**The raise form asks Department → Plant → Equipment**, and the plant is what narrows the
picker. Department is untouched and still 0019's rule: who triages, chosen by the person
reporting, deciding nothing about access, and allowed to disagree with where the machine is.

Six things here are load-bearing:

- **`assets.department_id` lost its `not null`, and had to.** The master lists carry a
  LOCATION column (`PMW-F1/F2/F3`) and no department, so keeping the constraint would have
  meant inventing a department for 134 machines — guessing whether a 5-tonne overhead crane
  belongs to Production or to Maintenance, 134 times, and writing the guesses into a column
  the app then displays as fact. Equipment registered before 0049 keeps whatever department
  it has. `work_orders.department_id` is still `not null`: that one is answered by a person.
- **`handleAssetChange` sets the PLANT now, not the department.** It used to fill the
  department in from `assets.department_id`, which is null on every imported machine — so
  left alone it would have cleared a department the user had just chosen, on every machine in
  the register.
- **Changing the plant clears the equipment**, where changing the department deliberately
  does not. Department and asset are *allowed* to disagree; plant and asset cannot — the
  plant is where that machine is, so F3 plus an F1 lathe is a stale selection rather than a
  real situation. It would also leave a machine on screen the picker no longer offers.
- **With no plant chosen the equipment picker offers nothing**, which is the opposite of what
  the department narrowing did (no department meant every machine). The registers overlap by
  code — F1, F2 and F3 each have an `AC1`, F2 and F3 each have a `BP` — so one flat list
  offers four different machines under the same label with no way to tell them apart. There
  is no "show every plant" escape hatch for the same reason: choosing the plant *is* the
  answer, and it sits one field above.
- **Asset ids are `AST-{plant}-{nnn}`, not derived from the machine code**, because those
  codes are not unique even within one sheet: F1 uses `L1` for both "Lathe Machine No 1" and
  "Laser No 1", and `C1`/`C2`/`C3` for both the cutting machines and Cranes 1-3. The code is
  kept verbatim in `asset_code`, which has never carried a unique index.
- **`work_orders.plant_id` is `not null` now**, backfilled to `PLT001` first. Every work order
  raised before today was stamped `'PLT001'` by `createWorkOrder`, so that is the honest
  answer for those rows rather than a blank — there was one plant and that was it.

**Every machine already registered is retired, not deleted.** `work_orders.asset_id` is a
foreign key with no cascade and `asset_name` is denormalised onto the row, so a work order
raised against "Batching Plant" has to go on reading "Batching Plant" forever. Measured on
test before the migration: `AST-BATCHING-PLANT` carried 21 work orders and `AST-FLOODLIGHT`
20 — Postgres would have refused to delete either. The retirement is written as "everything
that is not one of the rows below" rather than as a list of ids, because the two projects hold
different equipment and a hardcoded list would leave whatever it failed to name still on the
picker. Same reasoning 0046 used for keying on a flag instead of on email addresses.

**Registering equipment from the raise form stops here.** 0032 opened `assets_insert` to any
signed-in user, arguing that the person on the floor with a fault is the one who notices the
machine is missing. That was right when the register was empty; it is also what produced
"Aircond", "Lampu", "Floodlight" and "Main office 1st floor" as plant equipment. `assets_insert`
is now `si_is_admin()`, `createAsset()` is **removed** from `lib/admin.js` (the way 0031
removed `deleteDepartment()` — an exported write every non-admin caller would refuse reads as
a capability the app still has), and `upsertAsset()` requires a plant with no fallback: it used
to default to `'PLT001'`, which is now retired, so the old default would create a machine
nobody can choose and nothing on screen would explain why.

**Departments keep their open insert.** 0019's argument still holds there and adding a
department is not what drifted.

**"Other (specify)" is what replaces self-registration, and it registers nothing.** Picking it
reveals a required *Which equipment* field; what the user types is stored as that work order's
`asset_name`, prefixed `Other — `, while `asset_id` points at the plant's `Other` row so the
foreign key holds. The list, the detail page and the export all read `asset_name`, so the
record names the machine everywhere; the register gains nothing. The export's Equipment column
takes `asset_name` before resolving `asset_id` for exactly this reason — resolving the id
would print "Other (specify)".

`OTHER_PREFIX` is one constant in `RaiseWorkOrderForm` because it is written on submit and read
back off `asset_name` when editing, and the name is **not** recoverable from `asset_id` — that
points at the plant's shared `Other` row. Starting the field blank instead would make editing
anything else about such a work order silently demand the machine name again, and then fail
validation until it was retyped. The prefix is tested on the string rather than through
`assetById()` because the initialiser runs before the reference data has arrived.

**A retired plant cannot be chosen either.** 0031's central point is that a flag which only
filters a dropdown decides nothing, so `plants` joins the tables `si_guard_retired_reference()`
covers, keyed on `plants.status` — the column 0001 created — rather than on a second flag.
`PLT001` is retired rather than deleted: `departments.plant_id`, `users.plant_ids` and every
work order raised before today point at it. Measured as a technician straight at PostgREST:
raising a work order against `PLT001` comes back *"That plant is no longer in use…"*.

`plants` is in `ReferenceDataProvider` and in `NEVER_EMPTY`, unlike departments and assets. A
site with no equipment registered yet is a valid starting state; a database with no plant row
is not, so an empty `plants` means the same thing an empty `priorities` does — the fetch ran
unauthenticated.

### P7, and an SLA whose stages start when the last one finished (0048, 0050)

**P7 is a long-term task**: planned work with no immediate production impact, measured in days.
It arrives with a production impact of its own — `impact_levels.long_term` → `P7` — because
since 0036 nobody picks a priority, and a priority with no impact deriving it would be a value
the raise form could never reach. The impact → priority mapping stays exactly 1:1.

**Why P7 and not P5.** Rank 1 is most severe, and a long-term task sits well below "cosmetic or
routine" rather than one step below it. Leaving 5 and 6 unused keeps room for a priority
between P4 and P7 without renumbering, which matters because `priorities.rank` is what
`si_derive_priority()` compares with `least()` and what every escalation ceiling resolves
through.

**Two migrations, and the order is forced.** 0048 adds the two enum labels (`si_priority.'P7'`,
`si_impact.'long_term'`) and nothing else; 0050 seeds the rows that name them. Postgres refuses
to let a transaction *use* an enum value the same transaction added and the CLI wraps each file
in a transaction — the same trap 0035/0036 documents.

**Its three targets are sequential: assigned within 5 days, `repairing` within 3 days of that,
closed within 7 days of that.** So the numbers stored are *stage durations*, not offsets from
the raise time.

**P1-P4 are untouched.** Their numbers were authored as totals from creation — a P1 is 5
minutes to acknowledge and 4 hours to resolve, both from the fault — and making them
sequential would have made every one of them quietly more generous than it has been since
0006. Which model applies is therefore **data, not code**: `sla.targets_are_sequential`, one
code path with the row deciding, the way the permitted transitions are 22 rows in
`wo_status_transitions`. An `if priority = 'P7'` in two trigger bodies would be a second
definition of the same rule, which is what this file already complains that
`suggestPriority()` vs `si_derive_priority()` costs.

**"Acknowledge" and "response" now have to mean something exact.** The FSD defined acknowledge
(creation → leaving `Open`) and resolution (creation → `Closed`) and never defined **response**:
`sla.response_target_minutes` was added by 0009 as a third number the detail page prints, and
nothing ever measured it. Now:

```
acknowledged_at  <- first time the work order reaches 'assigned'
responded_at     <- first time it reaches 'repairing' (work under way)
```

Both are `coalesce`d, so they record the FIRST arrival and never move. The trail is
deliberately non-monotonic (0038): a decline sends `assigned` back to `open` and the next
assignment must not restart the acknowledge clock, and `testing → repairing` on a second
attempt must not restart the resolution one. `accepted` was the other candidate for response
and is the weaker one — on a long-term task it would start the 7-day resolution window three
days before anybody is at the machine.

Both columns are backfilled from `work_order_history`, first occurrence of each status,
**filtered to `event_type = 'transition'`** — 0043's photo-replaced rows carry the work order's
current status in `to_status`, so a photo swapped while a job was assigned would otherwise read
as the moment it was assigned. Same trap `lib/historyEvents.js` exists for.

**A P7 has no resolution deadline until work starts, and that is correct.**
`sla_resolution_due_at` stays NULL on a sequential priority until `responded_at` is stamped,
and nothing had to change to make it safe: 0004's breach and warning sweeps both already guard
on `sla_resolution_due_at is not null`, `si_dashboard_card_rows` already orders `nulls last`,
and `si_stamp_work_order`'s `closed` branch already tests for null before setting
`sla_breached`. A deadline that has not started cannot be missed, and inventing one from the
raise time would be the from-creation model wearing the sequential model's numbers.

`si_sla_targets(si_priority)` replaces `si_sla_target_minutes`'s two values with four. **It
keeps EXECUTE for `authenticated`, and must**: `si_stamp_work_order` is SECURITY **INVOKER**,
so a function it calls has its EXECUTE checked against the signed-in user — revoked, every
status change in the app would fail with *"permission denied for function si_sla_targets"* for
every role, exactly as `si_guard_protected_user` did before 0013. It discloses nothing
`sla_select` does not already publish. The old function is left in place rather than dropped:
nothing in this repository calls it, but it has been granted to PUBLIC since 0003 and dropping
a function is not the way to find out what else reaches it.

The sequential block in `si_stamp_work_order` sits **above** the `completed`/`closed` stamps,
because the `closed` branch decides `sla_breached` by reading `sla_resolution_due_at` and has
to read the value the same statement just computed.

**Every SLA countdown in the client now reads the stored deadline** instead of recomputing
`created_at + resolution_target_minutes`. That arithmetic was duplicated in three places — the
list, the detail header and `RoleDashboard`'s overdue/at-risk buckets — and 0050 made it wrong
in a way that could not be papered over: an open P7 would have shown a 7-day countdown from the
raise time, which is a promise nothing in the database makes, on the one priority where the gap
between the two is measured in days. `slaRemainMs(wo)` and `slaWindowMs(wo)` in `constants.js`
are the one definition now. Null means no deadline has started, and every caller already
handled null — `fmtDue(null)` is "—" and both dashboard buckets test for it. Exercised against
the real source: a P7 with no deadline reads "—" and counts as neither overdue nor at risk; a
started one reads "6d 23h"; a breached P1 reads "2h 0m overdue".

`slaWindowMs` is `due - created_at`, which mirrors `si_sla_warning_sweep()`'s
`(sla_resolution_due_at - created_at) * 0.25` exactly rather than deriving the window from
`resolution_target_minutes` — on a sequential priority the window spans the stages before it,
so the two would otherwise put the warning threshold in different places.

The trade-off is accepted and is the FSD's rule rather than a regression: relabelling an SLA
target in Admin → Settings no longer retroactively moves the countdown of a work order already
raised. A deadline is a promise made when it was raised. An Administrator's re-grade is the one
thing that moves one (0051), and it moves the stored column, so all three read it correctly.

**The dashboard learns about P7 explicitly**, because its priority row is four hardcoded keys
rather than a loop over the table. `si_compute_dashboard_stats` gains `p7_long_term` and
`si_dashboard_card_rows` a branch; without them a P7 would be counted in `total_open` and in no
band, so the four cards would visibly stop adding up — and long-term work, exactly the kind
that sits unattended, would be the work with no figure watching it.

**P7's colour is off-palette on purpose.** Every in-palette candidate collides: slate `#64748B`
is what `priorityColor()` returns when a lookup *fails*, so a P7 badge would be
indistinguishable from a broken one; both navies are P4's own family; green reads as completed.
A priority badge has one job, which is to be told apart at a glance in a list, so P7 is violet
— and it is a seed value in an editable table, so Admin → Settings can recolour it.

### An Administrator may re-grade a priority (migration 0051)

Since 0036 the priority was unchangeable by anybody. That is right for the requester, the
supervisor and the manager, and wrong for the Administrator: a breakdown that turns out to be a
rebuild is correctly *reported* and incorrectly *prioritised*, and no edit to its production
impact describes that honestly. **Administrator only, reason required, live work orders only.**

Not a `role_permissions` toggle like work-order delete (0018) — the priority is what the SLA
clock is computed from, so this sits with 0031's retire-reference-data rather than with
capabilities that get handed out.

**An override column, not a writable `priority`.** The obvious version — let an Administrator
write `priority` and have the derive trigger leave it alone — cannot work, because the trigger
has no way to tell a deliberate value from the same value arriving in
`updateWorkOrderFields()`'s arbitrary `fields` object, which is exactly why 0036 fires on every
UPDATE rather than `update of impact, …`. So `si_force_derived_priority` reads
`coalesce(new.priority_override, si_derive_priority(...))`, which makes the override **sticky**
for free — and it has to be, or a later edit of the impact would silently undo it.

The other tempting shortcut was to skip the column and have the Administrator set the
*impact*, letting the existing derivation carry the priority. It is unsound in one direction:
the safety and environmental escalations are `least()` caps, so a work order flagged for a high
safety risk derives P1 whatever its impact says, and an Administrator asking for P7 on it would
silently get P1 with no error. Setting the impact reaches only the priorities the flags allow;
an override has to reach all of them. Measured: `si_derive_priority('long_term', {flag:true,
severity:'High'}, …)` returns **P1**.

**Overriding to P7 moves the impact with it — and only to P7.** P7 is not a severity, it is a
kind of work, so "Full production stoppage · P7" is a contradiction rather than a re-graded
job. Overrides between P1 and P4 leave the impact exactly as the requester chose it: those four
*are* severities, the requester's answer is an observation they made at the machine, and the
Administrator is disagreeing with the grading rather than with the observation. Rewriting it
would destroy the input the derivation is computed from and leave nothing on the row showing it
had ever been different. The displaced value is in the audit row either way.

**The SLA is recomputed from `created_at`, not from now.** A work order raised on Monday and
re-graded on Wednesday gets its new marks counted from Monday — the fault is as old as it is,
and restarting the clock would reward re-grading a job that is already late. Sequential
priorities keep their staged shape: response due from `acknowledged_at`, resolution due from
`responded_at`, so a stage not yet reached stays NULL. `sla_breached` is recomputed in both
directions and `sla_warning_sent` is reset only when the new deadline is still ahead — re-arming
it on an already-breached job would send a warning after the breach. This is a deliberate
exception to the FSD's "once set, does not clear itself": that rule protects a breach from being
erased by the passage of time, and what clears it here is a named Administrator with a recorded
reason.

**The assignee and the phase do not move, and the omission is the mechanism.** The UPDATE names
the four override columns, the impact and the five SLA columns, and deliberately does not name
`status` or `assigned_to_id` — a re-grade changes what is expected of a work order, not who is
doing it or how far along it is. Three things make that hold rather than merely appear to:
`si_stamp_work_order` opens with `if new.status = old.status then return new`, so on this UPDATE
it does nothing — which matters most for the decline branch just below it, the thing that clears
the assignee; `si_notify_work_order_update` opens with the same test, so a re-grade announces
itself once as `priority_changed` and never as a `status_change` or a fresh `assigned` row; and
the transition guard's self-assignment and assignee-eligibility checks both open with
`new.assigned_to_id is distinct from old.assigned_to_id`, so an unchanged assignee skips them.

Measured across every phase an override is allowed in — open, assigned, accepted, repairing,
waiting_spare_part, testing, completed — 72 assertions: assignee, status, `acknowledged_at`,
`responded_at`, `resolved_at` and `decline_count` byte-identical either side; the ack deadline
moved every time; the resolution deadline moved wherever work had started and stayed null where
it had not; the only notification written was `priority_changed`, once to the assignee and once
to the requester. **Do not add `status` or the assignee columns to that UPDATE.**

**Three enforcement points, because `work_orders` cannot lose its UPDATE policy.** 0043's answer
for `attachments` — no UPDATE policy at all — is unavailable here, since every transition and
every edit needs one. Instead:

- `si_guard_priority_override` (BEFORE INSERT OR UPDATE) refuses **any** change to the four
  override columns unless the RPC's door is open, so a direct PATCH from an Administrator's own
  token is refused and the reason and the audit row cannot be skipped by anyone at any rank.
  Measured: *"Priority can only be changed by an Administrator, with a reason."*
- `si_override_work_order_priority` (SECURITY DEFINER) is that door, re-checking `si_is_admin()`
  and the status in its own body because RLS does not apply inside it.
- The door is `current_setting('si.allow_priority_override')`, read by `si_priority_override()`
  — a copy of `si_protected_override()`'s shape from 0013/0016. `set local` means it dies with
  the transaction, so a pooled connection cannot carry it into the next statement.

The guard is named `a000_` so it fires ahead of 0036's `a00_derive_work_order_priority`, which
reads the column it protects. Every digit sorts below `_` in ASCII — the same fact that stops a
migration being numbered between two existing ones.

**`p_priority => null` clears the override** and hands the work order back to the derivation. A
reason is still required: going back is a decision too, and the audit row is the only place it
is recorded.

**Logged three ways, like 0043's photo replacement.** The four columns carry the standing
decision; one `work_order_history` row with `event_type = 'priority_override'` puts it on the
timeline the rest of the work order is read from; and `si_notify` tells the assigned technician
and the requester, excluding whoever made the change and deduplicated because on a small site
they can be the same person. Deliberately **not** the whole ops chain the way 0038 fans accept
and decline out — `notifications` still has no retention and no per-account mute, and a
re-grade is not a routing problem anybody else has to act on.

`lib/historyEvents.js` gains the label, and `NOTIFICATION_META` plus `NotificationBell`'s
`ICONS` gain `priority_changed` / `ArrowUpDown`. A type added server-side and not there renders
as a grey generic bell, which is how a new notification type goes unnoticed.

**`priority_touched` is left alone.** It records *the requester overriding a suggestion*, can
only read false since 0036, and the export's "Priority Overridden" column reads "No" forever.
The re-grade is three new export columns instead. They are different events and folding them
together would make one heading mean two things.

`canOverridePriority(wo, currentUser)` in `constants.js` decides what to *show* and restates
both halves — Administrator, and not `verified`/`closed`. The RPC re-checks both, so the two
disagreeing means an error rather than a silent success.

`buildReferenceValue(data, error)` is now exported from `lib/referenceData.js` and the provider
is only the subscription half. Pure — rows in, helpers out, no React and no Supabase — for the
same reason `exportWorkOrders.js`, `historyEvents.js` and `attachmentPhases.js` are shaped that
way: it is what let the raise form and the priority dialog be exercised against the real
context without a session.

### A handover tells the technician it happened (migration 0052)

**Only the first assignment ever notified the technician. Every reassignment notified nobody** —
not pre-acceptance, not at `accepted`, not mid-repair.

Two correct decisions meeting. `si_notify_work_order_update` opens with
`if new.status = old.status then return null`, the same early return that makes 0051's re-grade
keep quiet about phases it did not move. And a reassignment does not move the status: FSD
Business Rule 6 preserves it at `accepted` or later so ownership changing does not restart the
flow, and a pre-acceptance one re-enters `assigned` from `assigned`. Either way the function
returned before reaching its own assignment branch, so the one transition whose entire purpose
is to change who owns the work order was the one that announced nothing.

Measured on test before the fix: handing a work order from one technician to another wrote
**zero** notification rows for the new assignee at `assigned`, `accepted` and `repairing`. The
`open → assigned` first assignment did notify — which is why it went unnoticed, since the path
everybody exercises daily is the one path that worked.

**The fix is where the test is, not what the test is.** The branch moves ABOVE the status guard
and keys on `new.assigned_to_id is distinct from old.assigned_to_id`. Strictly more accurate in
both directions: it fires for a handover, and it stops firing when the status becomes `assigned`
with the *same* assignee — reachable, because the pre-acceptance `assigned → assigned` row does
not require the assignee to change, so that used to re-notify somebody about a job they already
held. Widening the guard instead would have let every branch below it run on an UPDATE that
moved no status, and a priority re-grade would start emitting accept and decline notifications;
the early return is load-bearing for everything after it, and only this one branch belongs in
front of it.

`is distinct from`, not `<>`: a first assignment moves the column from NULL and `null <> 'uuid'`
is NULL, which is not true. A decline sets the assignee to NULL, which the `is not null` test
skips — decline keeps its own branch. And nobody can be handed a work order by themselves, since
the transition guard refuses self-assignment above the admin bypass, so there is no actor to
exclude the way 0038's fan-outs do.

**Two wordings, because a handover is not an assignment.** A first assignment has an Accept step
waiting; a handover at `repairing` does not, so telling them to accept would send them looking
for a button the workflow will never offer. The status label is read from `wo_statuses` rather
than printing the raw enum, so it says "Repairing" and follows a relabelling.

### The Assign button responds to being pressed, and says what it sent

Three things were wrong with pressing **Assign**, and only the third was cosmetic.

**`busy` was one boolean for the whole roster**, so a press disabled every button and put a
spinner on none — the pressed one gave no response at all, and the only signal anything had
happened was the row turning amber a round trip later when Realtime delivered the change back.
It now holds the technician's id, so the pressed button reads "Assigning…" / "Reassigning…" and
the others simply go quiet.

**`Button`'s spinner never spun.** A dozen call sites across the app pass
`icon={busy ? Loader2 : Check}`, and `Button` rendered `<Icon size={14} />` with no className —
so every one of them showed a *motionless* spinner glyph while waiting. The only things that
actually span were the three pages that hand-roll `<Loader2 className="animate-spin" />`. A
frozen spinner is worse than none: it reads as a hung screen. `Button` now takes `loading`
(spins, and disables itself so a second press cannot fire the same request), and it also spins
any `Loader2` passed as `icon` — which fixes all dozen without touching them. Measured in the
browser: `animationName` is `spin` on the loading button and `none` on the idle one.

**And there was no confirmation.** `SentDialog` is a modal receipt naming the technician, because
assignment is the moment responsibility for a fault transfers to a named person, and the amber
row is both late and possibly off-screen on a phone. Its two wordings mirror 0052's two
notifications: a pre-acceptance assignment says they can accept or decline and that a decline
comes back here unassigned; a handover says the work order stays at its current phase and there
is no acceptance step. `PRE_ACCEPTANCE` in `AssignPanel` mirrors `PRE_ACCEPTANCE_STATUSES` in
`lib/workOrders` and exists only to word the dialog — **change them together.**

The landed-on status is computed from the row already in hand rather than awaited from Realtime,
so the dialog is right the moment it opens.

### The work order detail page: what it says about itself

Four changes, all on `WorkOrderDetail` and the panels under it.

**Each SLA target is printed beside what that stage actually took.** `lib/slaStages.js` pairs
them, and it is a module rather than three expressions in the component because **each actual
has to be measured the same way its own target is.** P1-P4's targets are offsets from the raise
time; P7's are stage durations starting when the previous stage was met (0050). Measuring a
sequential stage from `created_at` compares a seven-day promise against a fifteen-day elapsed
and reports a breach that never happened. Exercised in Node on the same instants both ways: the
sequential reading is `6d` and met, the from-creation reading would have been `9d` and a
breach. Green under target, red over, and an unfinished stage prints `···` rather than a zero —
"not yet" is a different answer from "no". `fmtElapsed()` lives there rather than beside
`fmtDue()` because `fmtDue` formats a *countdown* and appends "overdue" to a negative, which an
elapsed time never wants.

**The header carries who raised it and when**, beside the SLA chip. Both are the first things
anyone asks of a work order they have just opened, and an SLA countdown is meaningless without
the "when" it counts from. `fmtDateTimeMY`, so it reads the same in plant time on every device.

**Comments and photos are one thread.** `CommentsPanel` merges `comments` and `attachments` by
timestamp — different tables, no join, sorted ascending because a conversation is read downwards
— and renders it as chat: own messages right in navy, everyone else's left in grey, with date
dividers and the author's role badge. The picture of the fault and the sentence describing it
were previously never on screen together, and on a phone the tab strip is a scrolling row where
Attachments started off-screen entirely.

The Photos tab **stays**, holding the phase-grouped gallery (0039) and the replace flow (0043).
`AttachmentViewer` is exported so the chat opens the same viewer instead of growing a second
one, and the chat passes `replaceable={false}` — **a boolean, not a predicate**: the viewer tests
`replaceable &&`, so `() => false` is truthy and would put a live Replace control on every photo
in the thread. Replacing stays a Photos-tab action because re-stamping `wo_status` reorders the
phase groups the viewer indexes into, and that state machine belongs with the grid that owns
them. Tabs relabelled Conversation and Photos; **the keys are unchanged**, since they are the
panel ids.

**The Conversation tab carries an unread count**, over both new comments and new photos, from
either being enough. It lives in `localStorage` keyed on uid *and* work order — no read-receipt
table, because that would be a row per person per work order per read in a database whose
`notifications` table already has no retention, and an unread count is a per-person convenience
rather than a fact about the work order. Keyed on the uid for the reason `draftRecovery.js` is:
a shared workshop terminal has more than one person signing into it. Every access is wrapped,
because Safari in private mode throws on the accessor itself.

**Two things there are load-bearing.** `CommentsPanel` is now **mounted whichever tab is
showing, and it is the only panel that is** — every other one is behind `tab === t.key`, and
unmounting this one would stop the count updating the moment you looked at anything else, so the
badge would never appear at all. It costs two live subscriptions for the life of the page, which
is what a chat badge is. And because being mounted no longer means being on screen, it reads an
`active` prop rather than inferring it — otherwise it marks a thread read while nobody is
looking at it. Your own messages never count, and nothing counts while the tab is open.

`Button` gained `loading`, which spins and disables. It also spins any `Loader2` passed as
`icon`, which fixes the dozen existing call sites that were rendering a **motionless** spinner —
see the note in that file.

### Dates and times

**`lib/datetime.js` pins `Asia/Kuala_Lumpur`. Everything older in the app does not.** Every
other date in the codebase is `toLocaleString(undefined, …)` — the *device's* locale and zone,
with no year — so one work order reads `8/12, 2:56 PM` on a laptop set to US English and
`12/08, 14:56` on a British one. The plant is in Malaysia; plant time is the only correct
answer. The old call sites are unchanged and still wrong in that way; new work should use this
module.

Two things there look like over-engineering and are not:

- **Display strings are assembled from `formatToParts`, not handed to `toLocaleString("en-MY")`.**
  `en-MY` is not guaranteed to exist — Node without full ICU falls back to en-US and silently
  returns MM/DD/YYYY. A date that reads `08/12/2026` in one place and `12/08/2026` in another is
  worse than either, because nothing looks broken. Only the *timezone* is delegated to Intl.
- **Range boundaries are computed in Kuala Lumpur.** `new Date().setHours(0,0,0,0)` is the
  obvious "start of today" and it is wrong here: on a UTC browser it lands at 08:00 KL, so a job
  raised at 7am files under yesterday and "Today" under-reports the morning shift.

`to` is **exclusive** everywhere, paired with `.lt()` and never `.lte()`. An inclusive
`23:59:59` end drops anything in that last second, and drops every row whose timestamp carries
milliseconds — which every `now()` default does.

`toExcelDate()` shifts an instant so its UTC fields hold the KL reading. An Excel serial carries
no timezone; handing it the raw instant makes every cell display UTC, eight hours adrift, on a
column that still sorts correctly and therefore never looks wrong.

### Exporting work orders

`lib/exportWorkOrders.js` builds a four-sheet workbook — **Work Orders** (one row per work
order, 57 columns), **Status History**, **Comments**, **Export Info** — via
`write-excel-file`. Everything above `downloadWorkOrderExport()` is pure: plain data in, plain
arrays out, no Supabase and no React, which is what makes it testable in Node, the only place
this repo can run a test. Reference-data lookups arrive as a `labels` argument.

`write-excel-file`, not `xlsx`: npm's `xlsx` is frozen at 0.18.5 because SheetJS left the
registry, and carries the prototype-pollution and ReDoS advisories. Its API is v4's
`writeXlsxFile(sheets).toFile(name)` — v3 took `{ fileName }` as an option, and that call still
*succeeds* against v4 while writing no file at all. The import is dynamic, so the writer sits in
its own 84KB chunk rather than in the bundle every user downloads.

Three details in the shaping:

- **Lifecycle timestamps come from `work_order_history`, first occurrence of each status.** A
  real trail is not monotonic — reassignment produces several `assigned` rows and statuses do go
  backwards. `verified` exists only in the trail, never as a resting state, which is the whole
  reason the lifecycle is read from history rather than from the work order's own columns.
  `verified_by` is a uuid with no name on the row; the name comes from the `verified` history
  row's actor.
- **Durations are hours as numbers with the unit in the header**, so they average and pivot
  instead of being text that merely looks numeric.
- **Attachments are a count, not a sheet of links.** The bucket is private behind one-hour
  signed URLs (0005), so any URL written into a saved workbook is dead before anyone opens it.

`fetchWorkOrdersForExport()` in `lib/workOrders.js` is deliberately **not** capped at the list's
300 rows, and paginates with `.range()` until a short page: Supabase caps a response at 1000
rows *silently*, and ten history rows per work order overflows that at three hundred work
orders. It shares `scopedWorkOrderQuery()` with `listenWorkOrderList` so the file cannot drift
from the list it was taken from, and the priority/status/search predicate is defined once in
`WorkOrderList` and reused by both. The `Test Data` column is gone with the concept it
reported (migration 0047); every row the query returns is in the file.

The date filter narrows **server-side**, which is a correctness fix rather than a performance
one: the system-wide branch is `.limit(300)` on newest-first, so filtering a loaded array for
"January" would search the newest 300 rows and report whichever few of January's were among
them.

### Status flow

```
open → assigned → accepted → on_the_way → on_site → repairing
     → waiting_spare_part ⇄ repairing → testing → completed → verified → closed
```

Plus `assigned → open` (decline), `testing → repairing`, `completed → repairing`. No status
may be skipped.

The permitted moves are **data, not code** — 22 rows in `wo_status_transitions` recording
which roles may perform each move, which fields it requires, and whether it demands a
different assignee. `si_guard_work_order_transition()` (BEFORE UPDATE trigger) enforces it,
because an RLS policy cannot compare OLD to NEW. `admin` is deliberately exempt so stuck
records can be corrected.

All transitions go through the private `transition()` helper in `lib/workOrders.js`, which
calls the `si_transition_work_order` RPC: one transaction, work order + history row together,
with `actor_id`/`actor_name`/`actor_role` read server-side from `auth.uid()` rather than
taken from arguments. Add new transitions there, not as raw updates.

**Decline is the one exception, and migration 0037 is why.** A technician declining an
assigned job was refused with a raw `new row violates row-level security policy for table
"work_orders"` — which `describeError()` correctly hides, so what they actually read was
"You don't have permission to do that." Accept, from the same session on the same row,
worked.

Nothing was wrong with either policy. **Postgres applies the SELECT policy to an UPDATE's
NEW row**, because the statement has to read the table — and a decline is implemented by
`si_stamp_work_order` clearing `assigned_to_id`, so `work_orders_select`'s technician
branch compares NULL to `auth.uid()` and refuses the technician sight of the row they have
just handed back. It is the only transition that deliberately ends outside the caller's own
scope, which is why it is the only one that failed. Proven by `alter policy
work_orders_select ... using (true)` inside a rolled-back transaction, and it is not the
`returning *`: the bare UPDATE fails identically.

So `declineWorkOrder()` calls **`si_decline_work_order` (SECURITY DEFINER)** instead of
`transition()`. Three things about that door:

- **The matrix is still the boundary.** Triggers read `auth.uid()` and the JWT, not the
  database role, so `a_guard_work_order_transition` fires on this UPDATE exactly as on any
  other. Measured after the migration: a *different* technician, a Requester and a
  Supervisor are all refused, so is declining from `accepted`, so is a blank reason, and a
  technician still cannot reassign. Anon cannot call the function at all.
- **Visibility is restated in the body** — a copy of `work_orders_select`, not a summary of
  it. RLS does not apply inside, so without it the function would reach any work order and
  leave the trigger as the only check. If that policy changes, this changes with it, the same
  way the three enforcement points on `users` do.
- **The client leaves the page.** Once declined, the row is correctly invisible to the
  technician *and* Realtime stops delivering its changes, so `WorkflowPanel` would sit on a
  frozen copy still offering Accept. It routes back to `/work-orders/`, where the job is
  gone and the Supervisor's "needs reassignment" notification has been written.

Widening `work_orders_select` was the tempting fix and is the wrong one: it would change
what the queue shows everybody in order to repair one write. Making
`si_transition_work_order` SECURITY DEFINER would fix decline by removing RLS from all
twenty-two transitions.

### Accepting and declining leave a trace now (migration 0038)

Both transitions used to happen in near-silence. Three separate things caused that, and only
one of them was in the database.

**The timeline structurally could not show a decline.** `StatusTimeline` renders a fixed
ladder of `statusFlow` and matched each rung with `history.find(h => h.to_status === s)`.
A decline is `assigned → open`, so it collided with the work order's *original* `open` row
and lost to it — `.find()` returns the first match. The decline, its reason and every
re-assignment after it were sitting in `work_order_history` the whole time and rendered
nowhere. It now collects **all** rows per rung: `events[0]` is the first arrival, the rest
render as indented amber sub-entries. One rule, three fixes — `testing → repairing` and
`completed → repairing` were invisible for exactly the same reason and come out right
without a branch of their own.

The sub-entry is labelled with the transition (`Assigned → Open`), not with a word for its
direction. "Back from X" was the obvious label and it is wrong for half these rows:
`repairing → testing` on a second attempt is a step *forward* that merely revisits a rung.
Verified against a deliberately non-monotonic eleven-row trail.

**The fan-out told one side each.** Accept notified the Requester only, decline the
department Supervisors only, on 0003's reasoning that Manager and Admin watch the Dashboard.
That holds for volume statistics; it does not hold for the two moments a work order either
starts moving or comes back unstarted. Now:

```
accept  -> Requester (unchanged wording) + Supervisors + Managers + Admins
decline -> Supervisors (unchanged) + Managers + Admins, and NOT the Requester
```

The asymmetry is deliberate. A decline is an internal routing problem the ops chain fixes in
minutes, and telling the person who raised the fault that nobody has taken it invites a
second work order for the same fault — they can still see it in full on the timeline, which
is what the change above makes true. Three details:

- **Deduplicated by id.** Since 0020 an account holds a *set* of roles, so a
  Supervisor+Manager is in two of the three source sets and the naive version writes two
  identical rows for one event. `distinct on (id) … order by id, rk desc` keeps one and
  stamps `recipient_role` with the highest role held. Measured: Priya holding
  `{supervisor,manager}` gets exactly one row, stamped `manager`.
- **The actor is excluded.** `auth.uid()` is readable inside the trigger even though
  `si_decline_work_order` is SECURITY DEFINER — that changes the database role, not the JWT.
  Without it a Supervisor+Technician accepting their own assignment is informed by the system
  that a technician accepted it. On decline there is no other way to identify them:
  `b_stamp_work_order` has already cleared `assigned_to_id` before this AFTER trigger runs,
  which is the whole reason 0037 exists.
- **`si_admins()` is new**, mirroring `si_managers()`. It says `'admin' = any(roles)` rather
  than leaning on `si_is_admin()`, so a Superuser is included — they hold the role, and being
  invisible in Admin → Users is not a reason to stop their own notifications reaching them.

`NOTIFICATION_META` gains an `accepted` entry, and `NotificationBell`'s `ICONS` map gains
`ThumbsUp` with it. A type added server-side and not here renders as a grey generic bell,
which is how a new notification type goes unnoticed.

**A recipient may finally clear a notification.** `notifications_delete` had been
`si_is_admin()` since 0002, whose header calls it "manual correction only" — so the
fastest-growing table in the schema had no retention, no cron sweep, and no client of any
role but Admin could remove a row. It is now `recipient_id = auth.uid() or si_is_admin()`.

Hard delete, not an `is_cleared` flag: that is the only version that reclaims anything, and a
flag would add a column to every row of that table in order to hide rows that are already
hidden. `si_guard_notification_update` is BEFORE UPDATE and needs no amendment — there is no
column to protect on a row that is going away. Worth contrasting with 0030's `users_delete`,
where hiding a row through the SELECT policy did *not* stop a delete because a DELETE policy's
`USING` is evaluated independently; here that independence is exactly what is wanted.

Deleting a notification destroys no audit trail — `work_order_history` is the record of what
happened and a notification is only ever a copy of it addressed to somebody. That is why this
is allowed where deleting a `users` row with history is refused outright.

Two things about the client half:

- **`clearReadNotifications()` filters on `recipient_id` and `status` as well as the id list**,
  though RLS already narrows the first. The ids come from a list rendered seconds ago; a row
  marked unread since should match nothing rather than rely on the policy. Unread rows are out
  of reach by construction, so one mistyped tap cannot destroy something nobody has read.
- **RLS refusing a DELETE removes no rows and raises nothing** — measured: a delete aimed at
  another recipient's notification returns `[]` with no error. So both functions select what
  they deleted and throw when it is empty, the same shape `deleteWorkOrder()` uses.

**The notification row is no longer a single `<button>`.** The dismiss control cannot live
inside one — nested buttons are invalid HTML and both handlers fire — so the row is a flex
container with two sibling buttons.

**And decline gained a confirm step, accept a toast.** Decline is the one transition that ends
outside the caller's own scope and cannot be undone from that screen, so it reads the typed
reason back before it goes; accept does not, because a technician does it many times a day on
a phone. The decline confirmation cannot be a toast in `WorkflowPanel` — that component routes
away and unmounts — so it travels through `lib/toastHandoff.js` (sessionStorage, read-once) and
is shown by `/work-orders`. Not a query parameter: that survives a refresh and a shared link,
and a stale "Declined — WO-123 sent back" reappearing days later is worse than no confirmation.

### What the database owns (do not send these from the client)

`wo_number` allocation, SLA deadlines, `resolved_at`/`closed_at`/`verified_at`/`sla_breached`,
notification fan-out, `decline_count` and assignee clearing on decline, SLA warning/breach
sweeps (pg_cron, 5 min), dashboard aggregates (`si_compute_dashboard_stats`, 15 min).

### Error handling

`describeError()` deliberately **surfaces the server's message** rather than replacing it —
the trigger and policy messages are written to be read by the person who hit them. Only raw
constraint/RLS text is filtered into a friendly stand-in. Don't wrap database errors in
generic "try again" copy.

### Reference data

Statuses, priorities, SLA, impact levels, WO types, safety severities, departments and
equipment are **editable tables**, not literals. The first six are keyed on Postgres enums, so
migration 0009 grants UPDATE only — they can be relabelled but not added to. Departments and
assets can be added freely and appear on the raise form immediately.

Adding a value to one of the enum-keyed six therefore takes a migration, and **it takes two
files, not one**. Migration 0035 adds `repairing` to `si_wo_type` (WO types are now
Breakdown 1, Inspection 2, Project 3, Repairing 4) and does nothing else, because Postgres
refuses to let a transaction *use* an enum value the same transaction added — the
`insert into wo_types` naming it fails with *"unsafe use of new value"* — and the Supabase
CLI wraps each migration file in a transaction. 0036 seeds the row. Nothing in the client
hardcodes a type list, so a new type is otherwise purely additive: form, list and export
all read the table.

Note the vocabulary collision, which is deliberate: `repairing` is also a work order
**status** in the 0001 flow. Different enums (`si_wo_status` vs `si_wo_type`), nothing
joins them, and the type answers "what kind of job" where the status answers "how far has
it got".

**Any signed-in user may register a department (0019)**, because the raise form offers
"+ Add new" in that picker — the person on the floor with a fault to report is the one who
notices the bay is missing. Insert only; the other verbs stay where they were (update Manager+,
delete Admin). **Renaming is the dangerous half**: `id` is what `work_orders` reference, so a
rename rewrites how existing records read. Removing is 0031's business.

**Equipment is no longer one of them.** 0032 opened `assets_insert` the same way and 0049 closed
it again — the register is the three 2026 master lists now, `assets_insert` is `si_is_admin()`,
and "Other (specify)" is what somebody with an unlisted machine chooses instead. `createAsset()`
is gone; `upsertAsset()` in Admin → Settings → Equipment is the only way in, and it requires a
plant. See "Four plants" below.

`createDepartment` is `.insert()`, never `.upsert()`. PostgREST turns an upsert into
`insert … on conflict do update`, which needs the UPDATE policy too — so RLS already refuses
it — but stating it as an insert is what makes a collision come back as *"that already
exists"* rather than as a policy error.

**Equipment is offered from the chosen PLANT, not from the chosen department** — migration
0049 replaced one narrowing with the other, and the two are not the same shape. See "Four
plants, and equipment that belongs to one" below for why an unanswered plant offers nothing
where an unanswered department offered everything. `includingCurrent()` still applies, so an
asset already selected can never drop out of its own picker while editing a work order raised
against a machine since retired.

The form asks **Department → Plant → Equipment**. It asked for equipment *first* and filled the
department in from the machine until 0036 swapped the first two; 0049 put the plant between
them, because a list you have to scope is unusable until the thing that scopes it has been
answered.

### Retiring reference data (migration 0031)

**Taking a value out of use is a different operation from deleting it, and the difference is
the whole migration.** 0009 gave the enum-keyed lookups no DELETE policy because "a status
with no transition rows would be a broken status". Right about deleting; not an argument
against ever retiring.

`is_active` on `priorities`, `impact_levels`, `wo_types`, `safety_severities` and
`departments`; equipment reuses `assets.status`, which 0001 created with a `decommissioned`
value and nothing had read since. A retired row **stays** — every work order that already
references it keeps its label and its colour forever — and simply stops being offered.
Reversible.

The reason it has to be retire rather than delete is that `work_orders.status`, `.priority`,
`.type` and `.impact` are **enum columns with no foreign key onto the lookup tables**.
Postgres would not stop you deleting `P1`; every P1 work order ever raised would just start
rendering a blank grey badge, and nothing would look wrong until somebody opened a board.

Six tables, and three excluded on purpose: `wo_statuses` (nobody *picks* a status — the
workflow moves through them, so the equivalent is editing `wo_status_transitions`), `sla`
(one row per priority, retired with its priority), `role_permissions` (the boolean already
is the switch).

**A trigger, not a policy.** `si_guard_reference_retire` is the only thing that can gate one
column: `departments_update` is `si_is_manager_or_admin()` and `assets_update` is
`si_is_admin()`, and both have to stay open for ordinary edits. Measured as an ordinary
Administrator straight at PostgREST: `PATCH priorities?id=eq.P4 {is_active:false}` → 403,
*"Only the Superuser can retire or restore reference data."*

**The flag is not advisory, and that is the point.** `users.status` decided nothing for four
migrations because the admin screen wrote it and no policy, trigger or predicate read it
(0026). A retirement that only filtered a dropdown would be that bug again — anything
speaking to PostgREST directly would carry on using the value. `si_guard_retired_reference`
on `work_orders` is where it is actually enforced, and it checks **only values being set**:
an existing work order carrying a retired priority has to stay acceptable, repairable and
closable, since those records are what retiring exists to protect.

Two consequences that look like oversights and are not. The client keeps loading **every**
row, retired included, because that is what makes a retired P4 still resolve to "Low" and
green; only the `active*` lists filter. And `includingCurrent()` adds the value already on a
work order back into its picker **when editing** — the raise form is also the edit form, and
a `<select>` whose current value has dropped out silently rewrites a field nobody touched.
Not when raising: `type` starts on a hardcoded `"breakdown"`, which would otherwise re-offer
a retired type to every new work order.

**Removing a row outright** is the other half, and only reaches rows nothing has ever used.
Superuser for the four lookup tables (new `*_delete` policies); departments and assets keep
the `si_is_admin()` policy 0002 gave them, because taking an existing capability away would
have been a regression dressed as a feature. `si_guard_reference_delete` counts the
references and raises a sentence, the shape 0030 used — measured: *"Utilities is still used
by 2 pieces of equipment. Removing it would leave those records without a label, so it is
refused. Retire it instead."* Four of the six have no foreign key protecting them, so for
those the trigger is not a better message than the constraint, it is the only thing there.

`deleteDepartment()` is gone from `lib/admin.js`; it counted the same references in the
browser, which raced a concurrent insert and duplicated a rule that belongs in the database.
`upsertAsset()` no longer pins `status: 'active'` — that would have put a decommissioned
machine back on the raise form the next time an Administrator corrected its name.

### Notification delivery outside the app

`notifications` rows are written server-side and read by `listenNotifications`.
`lib/osNotifications.js` is the presentation half: Android status bar via
`@capacitor/local-notifications` on a high-importance channel, the Notification API plus a
synthesised Web Audio chime on the web. `NotificationBell` drives it off the subscription it
already owns, so there is no second websocket.

Delivery reaches exactly as far as that websocket. App backgrounded → status-bar notification
with sound; app in the foreground → chime only, because the badge on the bell is already the
notification and duplicating it is what gets alerts muted; **app swiped away or browser
closed → nothing.** That last case needs a server to push to the device and `output: "export"`
means there isn't one — the FCM/Web Push path is written up in `app/DATA_AND_STORAGE.md` §5.

On the web the notification is shown through `public/sw.js` when a registration is available
and falls back to the `new Notification()` constructor. That is not preference, it is iOS:
WebKit implements `registration.showNotification()` and **not** the constructor, so without
the worker an iPhone throws instead of notifying. The worker is registered lazily, on opt-in
rather than on mount, and **has no `fetch` handler on purpose** — a cache in front of a Next
static export serves last week's chunks against this week's HTML and fails as a blank screen.
It also has no `push` handler, for the same reason there is no push at all.

WebKit gives an *uninstalled* iOS site no Notification API whatsoever, so the bell's opt-in
button cannot appear in a Safari tab. `iosNeedsInstallForAlerts()` separates that fixable
"unsupported" from a genuinely incapable browser, and the panel shows Add-to-Home-Screen
instructions in its place.

Two things that fail silently if changed carelessly. The permission request must originate in
a user gesture on both platforms, which is why the opt-in is a button in the bell panel rather
than a call on mount. And the Web Audio context must be resumed while the page has had a
gesture or the chime plays nothing, with no error — hence `primeNotificationSound()` on the
first `pointerdown`.

The first batch from the subscription is a baseline, never announced: it is whatever was
already waiting at sign-in. New rows are identified by created_at watermark **plus** an id
set, because `si_notify()` fans one event out to several recipients in a single transaction
and those rows share an identical `created_at`.

### Attachments

The `attachments` bucket is private. `attachments.file_url` stores the **object key**;
`listenAttachments()` mints a one-hour signed URL on read. 50MB cap with a mime allowlist,
enforced by the bucket.

**Photos are compressed in the browser before upload, and video is no longer accepted
(migration 0036).**

`lib/compressImage.js` decodes, draws to a canvas scaled to a 1920px long edge, and
re-encodes as JPEG down a quality ladder (0.75 → 0.6 → 0.45), stopping as soon as the
result is under half the original. Measured: a 4032×3024 photo came out **92.9% smaller**;
a text-heavy transparent PNG, the adversarial case, only reached 49.6% — JPEG is bad at
sharp text and PNG is good at it, and no rung of the ladder halves it without making the
text unreadable.

Four things there are load-bearing:

- **It is called inside `addAttachment()`, not at the two call sites.** That function is
  the chokepoint the raise form and the Attachments tab already share, so "the original is
  never stored" is structural rather than something each caller remembers: only the
  returned file is ever uploaded, which is also why `file_size_bytes` records the stored
  size and not the camera's. There is no original to delete afterwards because none is
  written.
- **It never throws and never rejects.** Every failure returns the original file: an
  undecodable format, a null blob, or a result that came out *larger* than the input. That
  is what makes "any format works" true — HEIC, the iPhone default, has no decoder in
  Chrome or Firefox at all (it decodes on Apple devices, and iOS usually hands over a JPEG
  anyway when a photo is picked through `accept="image/*"`), so on those browsers a HEIC
  uploads untouched rather than failing.
- **JPEG, not WebP**, though WebP is smaller at equal quality and the bucket allows it.
  These photos get opened on whatever is to hand in a plant; JPEG is the one raster format
  nothing fails to decode.
- **The canvas is filled white before the draw.** JPEG has no alpha, so without it every
  transparent pixel composites against transparent black and a light HMI screenshot
  arrives looking like a photo of a switched-off monitor. Verified by sampling the output:
  RGBA 254,254,254,255.

Video is **upload-removed, not read-removed**. 0036 drops `video/mp4`, `video/quicktime`
and `video/webm` from the bucket allowlist, so it is a rule rather than a hidden button —
but `si_file_type` keeps its `'video'` value (rows reference it, and an enum value cannot
be removed anyway), the read policy is untouched, and `AttachmentsPanel` keeps its
`<video controls>` branch. The Videos column renders only when the work order actually has
one. Deleting the playback branch would have made those files unreachable from the app
that stored them.

### Replacing a photo (migration 0043)

**The person who uploaded a photo may swap it for another, destroying the original.** Not
"a technician" — whoever put the file there, which includes a Requester fixing a blurry
photo on a fault they raised. There is no admin bypass: Managers and Administrators keep
the delete they have always had and do not gain the power to replace someone else's photo
with one of their own choosing. Only while the work order is live; at `verified` or
`closed` the photos are part of a finished record and freeze. Photos only — not documents,
not the legacy `video` rows.

**`attachments` still has no UPDATE policy, and must not get one.** `si_replace_attachment`
(SECURITY DEFINER) is the only door, the shape 0037 used for decline, so the table stays
immutable to anything talking to PostgREST directly — measured: a direct `PATCH` changes
zero rows. RLS does not apply inside, so `work_orders_select` is restated in the body as a
copy rather than a summary, and the new object key is checked to be under
`work_orders/{id}/` *and* owned by the caller — without that pair the argument is a way to
point your own attachment row at somebody else's file and mint signed URLs for it.

**The storage delete widened by data, not by trust**: you may delete your own object only
once no `attachments` row names it. So the sequence is repoint-then-remove — the function
moves the row onto the new key, which orphans the old one, and only then can the browser
delete it. A technician can neither delete a file that is still part of a live record nor
orphan a row by deleting the file under it. Both measured, both directions. The `not
exists` is safe from 0029's fail-open trap only because `attachments_select` is
`si_signed_in()`; narrow that policy and this needs a SECURITY DEFINER helper.

**Logged three times, because a replacement destroys evidence.** `attachment_replacements`
holds the full before/after in the same transaction; `attachments.replaced_at` /
`replace_count` let the panel mark a swapped photo without a second query; and one
`work_order_history` row puts it on the timeline the rest of the work order is read from.
The audit row deliberately has **no foreign key on `attachment_id`** — a Manager deleting
the photo must not delete the record that it was once replaced.

**`work_order_history.event_type` exists because the obvious encoding is wrong here.**
"Not a transition" looks like `from_status = to_status`, and on this schema that is a real
transition: `('assigned','assigned', …, 'Reassign (pre-acceptance)')` is row 3 of 0003's
matrix. A reader using it would have silently reclassified every reassignment as a photo
swap. The column defaults to `'transition'`, which is what every row ever written is and
what any row omitting it will be — `si_transition_work_order` is untouched. `lib/historyEvents.js`
owns the test; three readers use it and each was wrong without it:

- `StatusTimeline` matches a rung on `to_status` alone. Raising a work order writes **no**
  history row, so `open` has none until it is left — a photo replaced before then would
  have become the work order's "Open" entry, attributed to whoever swapped the photo.
- `indexHistory()` in the export counts `to_status = 'assigned'` as a reassignment, so a
  photo swapped while assigned added an imaginary one to `Times Reassigned`. The Status
  History sheet gains an **Event** column; the rows stay in it, they are only kept out of
  the arithmetic.
- The third reader this note used to name — a `waiting_spare_part` banner built from the
  *last* history row's remarks — **is not in the code**, and looking for it costs a hunt.
  `WorkflowPanel`'s banner is a static sentence and the reason comes from
  `work_orders.spare_part_reason`, its own column. The hazard it described is real and the
  column is what avoids it: nothing renders "the latest history row", so neither a replaced
  photo nor an Administrator's priority re-grade (0051) can retitle a banner.

Three client details worth not undoing. The replacement goes through `compressImage` in
`replaceAttachment()` rather than relying on `addAttachment`'s chokepoint, which this path
never reaches — measured end-to-end in the browser: a 3.9MB camera-sized JPEG stored at
992KB, 74.9% smaller. **The control lives in the full-size viewer, not on the thumbnail** —
the thumbnail is already a single `<button>` and nesting one inside it is the invalid-HTML
problem 0038 hit on the notification row. And **the warning is read before the camera
opens**: on a phone the file picker is a full-screen takeover, so a confirmation on the
other side of it arrives when the reader has already committed, about a photo they can no
longer see. Choosing the file is the agreement, which is why there is no second Confirm.

`uploaded_at` and `wo_status` are **re-stamped**, so a photo replaced during testing moves
into the Testing group — the picture on screen is the new one, and `wo_status` means "the
phase this photo documents" (0039). What the old one said is in the audit row. The
consequence is that a replaced photo's timestamp no longer says when the fault was first
photographed, which is why both the grid and the viewer mark it.

### Deleting user accounts (migration 0030)

The second irreversible operation in the module, and **Superuser-only** — not a
`role_permissions` toggle like work-order delete, because a toggle is a thing that can be
flipped.

**The audit trail is the boundary, and it already was.** Six of the ten foreign keys onto
`users(id)` are `ON DELETE NO ACTION` — `work_orders.requester_id` / `assigned_to_id` /
`verified_by`, `work_order_history.actor_id`, `comments.author_id`,
`attachments.uploaded_by_id` — so Postgres refuses to delete anyone who has done anything.
0030 added **no cascades**; it made the refusal legible. `si_guard_user_delete` counts the
references and raises a sentence, because `describeError()` surfaces server messages
verbatim so a trigger can be the copy. Measured: *"Arun Kumar has 1 work order, 6 history
rows, 1 comment. Deleting the account would break that audit trail, so it is refused.
Deactivate the account instead."* Deactivation stays the answer for a person who has worked.

**`admin-users` deletes `public.users` as the CALLER, not on the service role.** Three
things depend on it: `users_delete` stays the boundary (so the rank rule still stops peer
deletion and still protects the rank-6 Superuser), the refusal message reaches the right
person, and `z_archive_deleted_user` can stamp `deleted_by` from `auth.uid()` — which is
NULL on a service-role connection, so the alternative files an audit row recording nobody.
`auth.users` goes second, on the service role, because only the Admin API reaches it.
Verified: a real deletion recorded `deleted_by_name: SI Superuser`, and the `auth.users`
row was gone with no orphan left behind.

`public.users.id` references `auth.users(id) on delete cascade`, so the reverse order would
also work and would even be atomic. It is deliberately unused: the cascade arrives as the
service role, so the archive records nobody and `si_guard_test_account`’s null-uid early
return skips the test-account check entirely.

`user_deletions` hides test-account deletions from non-Superusers. Without that clause it
would hand an Administrator the name of every fixture ever removed — the same side-door
leak 0029 closed on the technicians roster. Measured as an ordinary Administrator: `[]`,
while the row is there.

**0030 also closed a hole 0028 left.** 0028 amended `users_select` and `users_update` and
not `users_delete`, and declared its guard `before insert or update`. A DELETE policy’s
`USING` clause is evaluated independently of the SELECT policy, so hiding a row never
stopped anyone deleting it, and the rank rule did not cover fixtures because they rank <= 4.
Not theoretical: Vikram Shah is a fixture with zero references, so any Administrator
holding his uuid could have destroyed him. The other fixtures were shielded by the foreign
keys — by luck, not design. The DELETE branch sits **above** the mark check, because a
DELETE changes no columns and would otherwise fall through every test and be allowed.

### Deleting work orders (migration 0018)

Irreversible, like deleting an account above, but the only capability here that is **granted
rather than inherent**. `role_permissions` holds one row per `si_role` value; only a
Superuser may write it (`role_permissions_update` is `using (si_is_superuser())`), and it
ships with Admin allowed and everyone else not — where 0002 left it. Admin → Settings →
Permissions is the toggle-then-apply screen.

Two things the toggle deliberately cannot do. It does not widen *scope*:
`work_orders_delete` restates `work_orders_select`'s predicate, so a granted Supervisor
reaches their own department, not the plant. And it does not reach the Superuser:
`si_can_delete_work_orders()` is true for them unconditionally, so the account holding the
switches cannot flip its own way out of fixing a mistake.

The delete itself is a plain RLS-enforced `DELETE` from `deleteWorkOrder()`, not an RPC —
RLS is the boundary, so nothing needs to restate it. A BEFORE DELETE trigger
(`si_archive_deleted_work_order`, SECURITY DEFINER) snapshots the row into
`work_order_deletions` and removes the comments, attachments and notifications that
reference it polymorphically; history cascades on its FK. Storage objects are outside all
of that and are removed client-side, best-effort, before the row goes.

RLS refusing a DELETE removes no rows and raises nothing, so `deleteWorkOrder()` selects
what it deleted and throws when that comes back empty. A rejected write should look like a
rejected write.

### Admin operations

Three mechanisms by need: plain UPDATE for profile fields and status (column guard limits
non-admins to their own name/phone/photo); RPC `si_set_user_roles` for role changes (also
enforces supervisor department scoping); Edge Function `supabase/functions/admin-users` for
password changes, **sign-in address changes**, account creation and **account deletion**,
since all four write `auth.users` and need the service-role key. That function re-checks the
caller is an active admin *from the database*, not from the JWT claim.

`delete_user` is the odd one out and is described under migration 0030 above: it uses the
service role for `auth.users` only, and deletes the `public.users` row with the *caller’s*
token so RLS, the history guard and the archive’s `deleted_by` all still work.

**Setting somebody else's password, and changing somebody else's sign-in address, are
both Superuser-only** (migration 0025 onwards). The rank rule was not enough: it stopped
an Administrator taking over a *peer* and said nothing about their subordinates, and an
Administrator who can set a subordinate's password holds that person's credential.

The two are restricted together, and that pairing is load-bearing rather than tidy.
Repoint a subordinate's address at a mailbox you control, run the **public** self-service
reset at `/forgot-password`, and you have their password without ever calling
`set_password`. Restricting one without the other would have been theatre.

Your own account is exempt from both — correcting your own address is not an escalation,
and your own password is `/change-password`.

What an Administrator uses instead is `send_recovery_link`: ordinary rank rule, because
nothing about it puts a credential in the sender's hands. It refuses a placeholder address
**loudly**, because `resetPasswordForEmail` succeeds against `tech.arun@example.com` and
delivers nothing — and an administrator told it worked believes the person has been
helped. It needs `SITE_URL` set as an Edge Function secret and refuses to send without it.

**End-to-end delivery was proven on 2026-08-20** and is no longer a question mark: `SITE_URL`
and `NEXT_PUBLIC_SITE_URL` are `https://si-cmms.vercel.app`,
`https://si-cmms.vercel.app/reset-password/` is in Authentication → URL Configuration →
Redirect URLs, and a link sent to a real `@pmw-group.com` address arrived, opened
`/reset-password` and set a new password. Everything before that had been *configured* for
a while; nothing had ever been *delivered*, and `ok: true` from the function only means
Supabase accepted the request. The built-in sender is still rate-limited to a handful of
messages an hour and drops the rest, so a single silent failure is not evidence of a broken
configuration.

`create_user` marks the new account as owing a password change, for the same reason
`set_password` does: the password was chosen by whoever created the account.

### Password reset

`resetPasswordForEmail` needs an absolute redirect, and `window.location.origin` is wrong in
the APK: Capacitor serves the same export from `https://localhost`, so a link built from it
points the user's mail client at their own phone. `NEXT_PUBLIC_SITE_URL` overrides it and
must also be listed under Authentication → URL Configuration → Redirect URLs.

`/reset-password` accepts all three link shapes, because which one arrives is project
configuration this app does not control: the implicit fragment (`#type=recovery`, consumed
by `detectSessionInUrl`), `?token_hash=…&type=recovery` (needs `verifyOtp`), and `?code=…`
(PKCE, needs `exchangeCodeForSession`). It still refuses to unlock on an ordinary signed-in
session with no recovery token — otherwise an unattended browser is a password change.

### Static export constraints

`output: "export"` + `trailingSlash: true` in `next.config.js`. No server routes, no API
routes, no `next/image` optimization, no middleware. The same `out/` is served by Vercel and
packaged into the APK, so web and Android ship identical UI — rebuild the APK after any web
change. Adding a server-side feature means giving up the Android build path.

### Installing on iOS

iOS has no APK equivalent here: a native build needs a Mac, Xcode and a paid Apple Developer
account, so the iPhone install is **the same export, added to the Home Screen from Safari**.
That is `public/manifest.webmanifest` (`display: standalone`, the three PNGs `npm run icons`
writes into `public/icons/`) plus the `appleWebApp` block in `app/layout.jsx`.

Three things there are load-bearing and look redundant if you don't know why:

- `apple-mobile-web-app-capable` is set by hand through `metadata.other`. Next 16 renders
  only the standardised `mobile-web-app-capable` for `appleWebApp.capable`, and that is the
  one iOS below 16.4 — which also ignores the manifest — does not read. Without it those
  versions install an icon that opens inside Safari's chrome.
- `statusBarStyle` is `"default"`, not `"black-translucent"`. Translucent draws the clock in
  white over AppShell's white header.
- `src/app/apple-icon.png` is flattened onto the brand navy. iOS composites a touch icon over
  black, so `icon.svg`'s rounded corners would come out as four black notches.

Unlike the APK, nothing needs re-packaging: an installed web app fetches `out/` over the
network, so a Vercel deploy reaches every iPhone on next launch. Full walkthrough and the
Safari-vs-installed storage differences are in `app/BUILD_AND_DEPLOY.md` §6.

## Adding a feature — sequence that works

1. Migration first (schema + RLS policy + any trigger), applied via `npm run db:push`.
2. `npm run db:types` to regenerate types.
3. A `listenX`/write function in the matching `lib/` file.
4. Component consuming it via the listener contract.
5. Client predicate in `constants.js` only to hide UI the policy would reject anyway.

Any new function in `public` is an anon-callable RPC by default (Postgres grants EXECUTE to
PUBLIC, PostgREST publishes it). Migrations 0007, 0008 and 0011 exist because of this. Revoke
explicitly and run the Supabase security advisor after any migration that adds a function.

Two traps if you ever audit this statically instead of running the advisor — both were hit,
and both produced findings that did not exist:

- **`search_path` is often pinned by `alter function`, not in the `create` header.** 0007
  pins eleven functions that way (lines 65-75). Grepping the `create function` body alone
  reports them as unpinned. Order matters too: a later `create or replace` resets options an
  earlier `alter` set, so the two have to be replayed in sequence, per file, in filename order.
- **`revoke` statements here are schema-qualified inconsistently.** The token hook is
  `revoke execute on function public.custom_access_token_hook(jsonb)`, while most others omit
  the `public.`. A pattern that does not allow the prefix reports the single most
  security-critical function in the schema as world-callable, which it has never been.

And the deliberate exemptions are documented in 0007's own header comment, not inferable from
the statements: `si_role()`, `si_department_id()`, `si_is_*()`, `si_in_same_department()` and
`si_signed_in()` stay granted to `authenticated` **because policy expressions are evaluated
with the querying user's privileges**. Revoking `si_signed_in()` would break ten policies in
0002 alone. Read that comment before "fixing" a grant.

Measured 2026-08-20, migrations 0001-0029: 54 functions, 28 SECURITY DEFINER, **zero**
without a pinned `search_path`; 23 tables, all RLS-enabled; no views. The dashboard advisor
agreed — no issues, warnings and info only. 0030, 0031 and 0033 add eight more functions, all
SECURITY DEFINER with `search_path` pinned and `revoke all ... from public, anon`. 0033's three
are revoked from `authenticated` too, since all three are trigger bodies with no caller in the
app. 0034 adds none — it replaces 0033's stamp function and both dashboard functions in place,
and re-issues their grants, which it has to: a later `create or replace` resets options an
earlier `alter` set, the same trap described above.

0036 adds two — `si_derive_priority` and `si_force_derived_priority` — both SECURITY DEFINER
with `search_path` pinned and `revoke all ... from public, anon, authenticated`, the trigger-body
shape 0033 used. Verified from the browser's own anon key: `rpc('si_derive_priority')` returns
*permission denied for function si_derive_priority* — HTTP 401, code `42501`, against a control
call that returns 200, so the probe distinguishes "revoked" from "everything fails". 0035 adds
none.

**Not yet re-run after 0048-0051.** Those add five functions, and two are deliberate
`authenticated` grants that the advisor will report under `Signed-In Users Can Execute SECURITY
DEFINER Function` — `si_override_work_order_priority`, an RPC the browser calls which re-checks
`si_is_admin()` and the work order's status in its own body, and `si_sla_targets`, which
**cannot** be revoked because `si_stamp_work_order` is SECURITY INVOKER and calls it (see 0050).
`si_reference_is_retired` keeps the grant it already had. The other two —
`si_guard_priority_override` and `si_priority_override` — are revoked from `public, anon,
authenticated`. Everything in 0049-0051 pins `search_path` in the `create` header and re-issues
its grants immediately after each `create or replace`, which the dashboard functions in 0050
also do because a later replace resets what an earlier grant set.

**Advisor run 2026-08-30 after 0043, on PRODUCTION: 0 errors, and the baseline plus exactly one
row — `si_replace_attachment`, under `Signed-In Users Can Execute SECURITY DEFINER Function`.**
That is the row this migration was always going to add and it must not be "fixed": the browser
calls that RPC directly, so revoking `authenticated` would stop the feature working for
everybody. It sits with `si_set_user_roles` and `si_refresh_dashboard_stats` for the same
reason — an RPC the client calls, which re-checks its caller in its own body rather than
leaning on the grant. Three times over here: the uploader test, the closed-work-order test,
and `work_orders_select` restated.

Where it is *absent* is the part worth reading. It is not under `Function Search Path Mutable`,
which confirms the pin independently of the file; and it is not anon-callable — measured
straight at production's anon key, `42501 permission denied for function
si_replace_attachment`. `si_decline_work_order` also appears now and is not new fallout: 0037
grants it to `authenticated` deliberately, and it simply post-dates the run recorded below.

**Advisor run 2026-08-21 after 0036: 0 errors, 7 warnings, 2 info — the same seven warnings as
the 0034 run below, entity for entity, and not one of them names either new function.** Five are
the deliberate `authenticated` grants on `si_can_delete_work_orders`, `si_is_test_account`,
`si_reference_is_retired`, `si_refresh_dashboard_stats` and `si_set_user_roles`; one is
`si_rank`, still `Function Search Path Mutable`, still the function that exists in the database
and in no migration; one is `Leaked Password Protection Disabled`. The info count is unchanged at
two, contents not inspected. So 0035/0036 introduced nothing — which is the only thing this run
establishes, and the useful reading of it is that the count did not move rather than that the
count is low.

Worth knowing for the next migration that adds a trigger function: **`si_force_derived_priority`
cannot be probed the way `si_derive_priority` was.** PostgREST answers `PGRST202` ("could not
find the function") for it — and does the same on the **service role**, and on 0003's
`si_stamp_work_order`, so functions returning `trigger` are not published as RPCs at all.
`PGRST202` from the anon key therefore proves nothing about grants on its own; check it against
a privileged caller before reading it as "revoked".

A note on `si_derive_priority` for anyone auditing statically: it is `stable`, not
`immutable`, because it reads three lookup tables — marking it immutable would let Postgres
cache a result across a relabelling. And its body failed on first push with *"operator does
not exist: si_impact = text"*, because `impact_levels.code` is `si_impact` and the original
wrote `i.code = p_impact::text`. plpgsql bodies are not parsed until called, so that was a
runtime error in a function that created cleanly. **A successful `db push` is not evidence
that a plpgsql function works** — exercise every branch. All ten of this one's were, on the
live project: the four impacts alone, each safety severity, the environmental flag, both
together, and a null impact.

**Advisor run 2026-08-20 after 0034: 0 errors, 7 warnings, 2 info — none of them from 0031,
0033 or 0034.** Five warnings are the deliberate `authenticated` grants on SECURITY DEFINER
functions (`si_can_delete_work_orders`, `si_is_test_account`, `si_reference_is_retired`,
`si_refresh_dashboard_stats`, `si_set_user_roles`) — the first three because a policy
expression evaluates with the caller's privileges, the last two because they are RPCs the
client calls and they re-check the caller internally. That warning class will always fire on
this schema; read the 0007 header before acting on it. One is `Leaked Password Protection
Disabled`, which is auth configuration and not in any file.

**And one is a function that exists in the database and in no migration: `si_rank(p_role
si_role, p_protected boolean)`, with `search_path` unset.** It appears nowhere in this
repository — not a migration, not a client call, only in the generated `database.types.ts`,
which is read from the live schema. It is a superseded duplicate of `si_account_rank(text,
boolean)`: same semantics, enum argument instead of text, and nothing calls it, because the
rank chain in 0015 goes through `si_role_rank()`. Almost certainly drafted in the dashboard
while 0015 was being written and never captured. Left in place rather than dropped blind — its
body has never been read, so "nothing calls it" is established from the files and not from the
database.

That is worth more than the finding itself: **it is a live demonstration of why the static
audit above is not a substitute for the advisor.** Replaying the migrations reports zero
unpinned functions and is right about every function the files describe. The advisor found a
64th. This has happened before on this project and is what 0013 exists to fix.

One grant is deliberate and worth not "fixing" blindly:
`si_reference_is_retired(text, text)` keeps EXECUTE for `authenticated`, and its only callers
are SECURITY DEFINER triggers, so it could be revoked — it discloses nothing the six tables'
own SELECT policies do not. What the files still cannot show, and the advisor can:
auth configuration (leaked-password protection, MFA, OTP expiry), extensions in `public`,
live grants rather than intended ones, and anything changed directly in the dashboard — which
has happened on this project, and is what 0013 exists to fix.

## Docs worth reading

- `docs/SI_WorkOrder_FSD.md` — authoritative functional spec. **Where it and the code disagree
  on behaviour, the FSD is correct.**
- `docs/SI_Design_System.md`, `docs/SI_WorkOrder_Screens_UIUX.md` — colours, components, all 9
  screens field by field.
- `docs/SI_Enterprise_Firestore_Architecture.md`, `docs/SI_WorkOrder_Firestore_Design_v3.md` —
  still describe the model in Firestore terms. Entities/fields/relationships carried over
  unchanged; mechanisms did not (collections → tables, rules → RLS + triggers). Design intent
  only; migrations are the implementation.
- `app/DATA_AND_STORAGE.md` — plan quotas and which one fills first (storage and egress, not
  the database), the SQL to check each, what grows unbounded (`notifications` has no retention
  and, until migration 0038, no client could delete it — a recipient may now clear their own
  read rows, but there is still no server-side retention), cleanup that reclaims space rather
  than just marking it dead,
  and the backup/export commands. **Free includes no backups at all.**
- `app/BUILD_AND_DEPLOY.md` — includes three machine-specific Gradle problems on this PC.
- `app/GO_LIVE.md` — env values, migrations, the access-token hook, seeding users.
- `app/TEST_ENVIRONMENT.md` — the two projects, the switch, what the config clone does and
  does not copy, the Vercel Preview split that gives a staging site, and the ways test
  deliberately differs from production - most importantly that test still has the six
  bootstrap fixtures, which migration 0046 removed from production.

## Known gaps

- **The fixtures live on the test project only, and nothing hides them there any more.**
  Migration 0046 deleted the five on production; the six on test survive it, because 0028
  never marked them and 0046 keys on that mark. With 0047 applied they are ordinary
  accounts - they show in Admin > Users, in the technician roster, and the demo work order
  counts in the test project's dashboard statistics. That is the intended end state rather
  than a gap to close: test is where you want to see the seeded data, and production now has
  none of it.
- `npm run seed:demo` had been broken since migration 0021 and is fixed. It selected
  `users.role`, which 0021 dropped, and PostgREST answers a select naming a missing column with
  an error rather than a null — so it failed on its first lookup. Nothing read the value:
  `actor_role` on the history rows comes from the script's own hardcoded event list. Worth
  knowing because it means the demo work order cannot have been seeded on any project built
  after 0021 until now.
- Editing a work order's core fields while Open writes no history row (transitions are fully
  audited; the edit path isn't).
- `verified` is a history state, not a resting state — `completed → closed` happens in one
  move with `verified_by`/`verified_at` stamped.
- **Facility has no equipment list of its own.** F1, F2 and F3 came from the 2026 master
  lists; Facility ships with only "Other (specify)", so every Facility work order names its
  equipment as free text until a list is supplied. Deliberate — a guessed list would be worse
  than none — but it means the Facility rows in an export cannot be grouped by machine.
- **The imported machines carry no department and no criticality of their own.** All 134 are
  `department_id` null and `criticality` 'medium', because the master lists record neither.
  Criticality is what the raise form's machine-facts strip prints, so it currently says
  "medium" about every imported machine — honest as a default, not as a fact. An Administrator
  can set both in Admin → Settings → Equipment.
- **YEAR OF PURCHASED was dropped on import.** The only column for it is `install_date
  timestamptz`, and turning "2013" into a timestamp invents a day and a month nobody recorded.
  `model` was kept where the sheet had one.
- `@capacitor/cli` pulls a `tar` version with a critical advisory; fixing it needs a Capacitor
  6 → 8 major upgrade. It is the only advisory in the tree — `write-excel-file` brings one
  transitive dependency (`fflate`) and neither is flagged.
- **Dates outside `lib/datetime.js` still render in the device's locale and timezone**, with no
  year: `notifications/page.jsx`, `DashboardModule`, `NotificationBell`, `CommentsPanel` and
  `StatusTimeline` all call `toLocaleString(undefined, …)`. The export, the work order list's
  Raised column and the date filter are pinned to `Asia/Kuala_Lumpur`; those five are not, so
  the same timestamp can read differently on two screens of the same app. Mechanical to fix —
  swap the call for `fmtDateTimeMY` — and deliberately left alone here to keep this change to
  what was asked for.
- **Image compression is best-effort by design, and two cases fall short of halving.** A
  format the browser cannot decode uploads at full size — in practice HEIC on Chrome and
  Firefox, which have no decoder for it; and a text-heavy PNG reached only 49.6% smaller in
  testing, because JPEG is poor at sharp text and no rung of the quality ladder halves it
  while keeping the text readable. Both return the original rather than failing, which is
  the intended trade: never lose a photo of a fault to compression. Closing the HEIC half
  would mean bundling libheif (~1.5MB of wasm) and was declined.
- **Nothing recompresses what is already in the bucket.** Compression happens before upload,
  so photos stored before migration 0036 are still full-size. A backfill script was
  considered and declined: it would rewrite files that are part of a work order's record.
- **Clearing notifications is manual, and 0038 made there be more of them to clear.** Every
  Manager and every Administrator now gets a row per accept and per decline, plant-wide —
  roughly two per work order each, on top of what they already received. That was chosen
  deliberately over the narrower fan-out, but there is still no server-side retention, no
  cron sweep and no per-account mute, so the only thing that ever shrinks `notifications` is
  somebody pressing **Clear read**. A retention sweep is the obvious next step and is not
  written.
- **Only the work order form survives a forced sign-in.** Session recovery holds the page
  for every screen, so nothing is lost on the recoverable path anywhere. But on the
  unrecoverable path only the raise/edit form snapshots itself: an unsent comment, the
  WorkflowPanel's completion notes and decline reason, and any in-progress admin form are
  still lost. Each is a `registerDraftSource` call away — the mechanism is general and the
  scope was the deliberate part.
- **A recovery faster than a paint still flashes the banner.** Measured recoveries against
  the test project completed inside the initial mount, so the strip appears and vanishes
  within a few hundred milliseconds. Honest, and arguably useful, but it is a flash rather
  than a message. Suppressing it below ~400ms would need a delay timer and was not written.
- **Most accounts cannot receive email.** The seeded ones are all `@example.com`, which
  `si_is_placeholder_email` correctly refuses to send recovery links to — so for those
  accounts the *only* credential route is the Superuser issuing a temporary password. That
  is the accepted trade-off of Superuser-only resets working as designed, but it is more
  absolute than intended until real addresses are set. Not a code gap; a data one.
