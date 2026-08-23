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

### Test accounts (migrations 0028, 0029)

`users.is_test_account` marks a fixture: an account that exists to be signed into while a
change is being tried, not to do work. The five bootstrap users carry it (backfilled from
`seed_source`), and it is **the Superuser's alone** — both halves of that.

*Invisible.* `users_select` adds `id = auth.uid() or si_is_superuser() or not is_test_account`,
the same shape the `is_protected` clause already had. An Administrator therefore does not see
these rows in Admin → Users, in any count, or in any picker — including the technician roster
on the assign panel. Deliberate: a fixture that appears in a live picker is one somebody
eventually assigns real work to.

*Invisible means the `users` row, not the name.* Measured as an ordinary Administrator going
straight at PostgREST with a fixture's exact uuid: `users?id=eq.<uuid>` returns `[]`, both
PATCHes return `[]`, and `users?select=name` returns two rows. But `technicians?select=name`
*used to return* all three fixtures, because `technicians_select` was `using (si_signed_in())`
and 0028 touched only `users`. The name is also denormalised onto `work_orders.requester_name` /
`assigned_to_name`, `work_order_history.actor_name` and `comments.author_name`.

None of that was a privilege — the uuid buys nothing, as the empty PATCHes show — but the
claim is "cannot be seen or administered as an account", not "the name appears nowhere". The
history columns *must* keep the name; an audit trail that hides who acted is not an audit
trail. `technicians` was the one that was wrong rather than necessary, and **migration 0029
fixes it**: `technicians_select` gained the same three-branch shape, so that table now returns
`[]` to an Administrator and all three fixtures to a Superuser — both measured, the second
against the assign panel itself.

0029 is worth reading for the trap in it. The obvious policy inlines the test as
`not exists (select 1 from users u where u.id = technicians.user_id and u.is_test_account)`,
and that does **nothing**: a policy expression evaluates with the querying user's privileges,
so the subquery is filtered by `users_select`, which already hides test accounts from this
exact caller. It finds no row, `not exists` is true, and the row stays visible to precisely
the people it was meant to be hidden from. It fails open, silently, and reads as correct.
Hence `si_is_test_account()`, SECURITY DEFINER — the same reason every other guard here is.

*Switchable by nobody else.* `users_update` excludes them from non-Superusers, and
`si_guard_test_account` (BEFORE UPDATE, SECURITY DEFINER) refuses a `status` change and refuses
any change to the mark itself. Two enforcement points rather than one because the policy does
not cover `si_set_user_roles` — SECURITY DEFINER changes the database *role*, not `auth.uid()`,
so the trigger still reads the caller's JWT and still refuses. `admin-users` is the third and
restates the rule in TypeScript, because a service-role connection has `auth.uid() = null` and
every check here is invisible to it. Same three points as every other rule about a `users` row;
the loosest path wins.

The guard refuses `status` and the mark, **not every write**. The first version refused
everything, which would have stopped a fixture editing its own name or phone — exactly the
thing you sign into it to test. Self-activation was never reachable anyway:
`si_guard_user_self_update` already refuses a self `status` change for everyone, Superuser
included.

`auth.uid() is null` returns early, so the bootstrap and seed scripts still run. That is the
same door `si_protected_override()` opens for system writes, and it has the same shape of risk:
it is safe only because a null uid means a service-role connection, which has already been
authenticated as trusted somewhere else.

### Test data and the dashboard (migrations 0033, 0034)

**The rule, and it is one sentence: statistics exclude test data; lists show everything,
tagged.**

`si_compute_dashboard_stats()` aggregated `from work_orders` with no predicate at all, and
`npm run seed:demo` walks one work order raised by `requester@example.com` and assigned to
`tech.arun@example.com` — both fixtures — the whole way to `closed`. So it fed
`completed_today`, both averages, `monthly_work_orders`, `department_breakdown`,
`machine_breakdown` and `technician_performance`, which groups by `assigned_to_name`: the
fixture's **name**, rendered on the Manager and Admin charts. The same side door 0029 closed
on the technicians roster, reopened where nobody thought to look.

**`work_orders.is_test_data` keys on the requester, not on either party.** 0033 stamped it
`requester or assignee` and that was too broad by one word — measured on the live project it
caught a real work order Amirul had raised and merely assigned to a fixture, and since the
only other row was the demo seed, every card went to zero and every chart to `[]`. **0034
narrows it**: whether the fault was real is decided by who raised it. The two outputs whose
*subject* is the technician — `technician_performance` and `active_technicians` — additionally
test `si_is_test_account(assigned_to_id)`, because those credit a person. Volume, department
and machine breakdowns, open counts and SLA all keep the row.

Recorded rather than hidden: the two timing averages still include a row a fixture worked,
because they measure the work order's journey rather than crediting anyone. There is no
reading of that pair where both halves are right.

**Not `si_dummy_flags`.** The dashboard already carries a demo-accounts warning card built on
it, and reusing it here would have been the tempting thing — but that column is a *heuristic*
(placeholder email, still on the seeded password, profile never edited). A real person who had
not yet changed the password they were given would have had their work silently dropped out of
every statistic. 0028's mark is deliberate and set only by a Superuser.

**A denormalised column rather than a join, because the client cannot do the join.** The
aggregate is SECURITY DEFINER and could read `users` directly; `users_select` hides a fixture's
row from everyone but the Superuser, so no client-side filter is even expressible. That is what
`RoleDashboard` needed — it computes the Supervisor's cards from `listenWorkOrderList()`, whose
scope is `() => true` since 0019 — and what the export needed. One column answers all three.

Three consequences worth knowing:

- **`si_dashboard_card_rows()` changed in the same migration, necessarily.** It exists (0012)
  so a card and its drill-down share one definition of "open"; adding the predicate to the
  aggregate alone reproduces exactly the disagreement it was written to prevent. Its
  `active_technicians` branch is also where a fixture's name escaped despite 0028: `left join
  users u` nulls for a row the caller may not see, and the coalesce falls through to
  `max(w.assigned_to_name)`, the denormalised copy.
- **The stamp trigger fires on every UPDATE, not `update of requester_id, assigned_to_id`.**
  RLS grants *rows*, not columns, so a column list would leave `update work_orders set
  is_test_data = false` unguarded — and `updateWorkOrderFields()` forwards an arbitrary
  `fields` object, so that is a live path. It is named `c_stamp_work_order_test_data` because
  Postgres fires BEFORE triggers alphabetically and 0003's `b_stamp_work_order` **clears
  `assigned_to_id` on a decline**; running before it would read the technician being declined
  away.
- **`work_orders_select` is untouched.** A demo work order that vanished from the list would be
  one nobody could find to delete, so `WorkOrderList` tags it "Demo" instead. `RoleDashboard`
  drops test rows from the single array its cards, recent list and drill-downs all share —
  filtering the counts but not the rows behind them would be the 0012 bug again.

**A deleted work order used to sit in the charts for up to fifteen minutes.** Nothing was wrong
with the arithmetic: `deleteWorkOrder()` hard-deletes (0018) and `stats` is a full rebuild, so a
*recomputed* aggregate was already right — but only pg_cron recomputed, every fifteen minutes.
`work_orders_recompute_stats_delete` is `after delete … for each statement` (once per statement,
not once per row). It has to be server-side: `si_refresh_dashboard_stats()` re-checks for
Manager/Admin, and 0018 lets a Superuser grant deletion to a Supervisor, who would then delete a
work order and be refused the refresh.

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

**`work_orders.priority` follows the production impact, and no longer can be overridden.**
It was a suggestion the requester could reject; the four priority buttons and the
`priority_touched` flag they set are gone from the raise form.

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
than a constant column.

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
order, 50 columns), **Status History**, **Comments**, **Export Info** — via
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
`WorkOrderList` and reused by both. A fixture's work order is **included and marked** in a
`Test Data` column rather than dropped — an export is a record, and silently omitting rows from
a record is worse than a column Excel's autofilter clears in one click.

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

**Any signed-in user may register a department (0019) or a piece of equipment (0032)**, because
the raise form offers "+ Add new" in both pickers — the person on the floor with a fault to
report is the one who notices the machine or the bay is missing. Insert only; the other verbs
stay where they were (departments: update Manager+, delete Admin; assets: update Supervisor+,
delete Admin). **Renaming is the dangerous half**: `id` is what `work_orders` reference, and
`name` is denormalised onto `work_orders.asset_name`, so a rename rewrites how existing records
read. Removing is 0031's business.

Both write paths are `.insert()`, never `.upsert()`. PostgREST turns an upsert into
`insert … on conflict do update`, which needs the UPDATE policy too — so RLS already refuses
it — but stating it as an insert is what makes a collision come back as *"that already
exists"* rather than as a policy error. `createAsset()` also refuses before it starts if no
department is chosen: `assets.department_id` is `not null`.

**Equipment is offered from the chosen department first**, with "Show equipment from every
department (n more)" underneath it. That is a display narrowing and nothing more: 0019's point
was about what may be *submitted*, the policy still accepts any asset, `handleAssetChange`
still moves the department to the machine's own, and the toggle resets when the department
changes so choosing one always narrows again. What it fixes is that every machine on site in
one flat list is a picker you scroll rather than a question you answer — and the department
has just been asked for, one field above. `includingCurrent()` applies here too, so an asset
already selected can never drop out of its own picker while editing a work order whose pair
was deliberately left disagreeing.

That last one used to be awkward and no longer is. The raise form asked for equipment
*first* and filled the department in from it — right for every other case and exactly
backwards for registering a machine, since the person adding one had to go back up for the
field they had just skipped. **The two are now swapped: department first, equipment
second.** `handleAssetChange` is unchanged and still overwrites the department from the
machine's own, which is the right way round — the asset is the more specific answer and
knows its own owner, and the field stays editable afterwards for when the registered owner
is not who should handle this particular fault.

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
  deliberately differs from production (the fixtures are **not** marked `is_test_account`
  there, so the demo work order counts in the dashboard statistics).

## Known gaps

- **The six fixtures on the test project are not marked `is_test_account`.** 0028 backfills
  that flag from `seed_source` in a one-time UPDATE, which on a fresh project runs before
  `bootstrap:users` has created anybody. So on test the fixtures show in Admin → Users and in
  the technician roster, and the demo work order carries `is_test_data = false` and counts in
  the dashboard statistics. Useful — a demo work order you can see — but it means the one thing
  the test project cannot exercise is the test-account hiding itself. The tell is `technicians`:
  production returns `[]` to an Administrator, test returns the fixtures.
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
- Single plant: `plant_id` is threaded everywhere but everything seeds to `PLT001` and no UI
  exposes plant selection.
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
- The dashboard's two timing averages (`avg_response_minutes`, `avg_repair_minutes`) still
  include work a fixture performed on a genuinely-raised work order — only
  `technician_performance` and `active_technicians` exclude a fixture assignee (migration 0034).
  Signing into a fixture and closing a real work order in four minutes puts four minutes in the
  average. Excluding it would instead lose a real resolution from the timing stats; 0034's
  header records why neither answer is wholly right.
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
