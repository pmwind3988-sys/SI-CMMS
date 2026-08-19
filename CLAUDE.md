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

### Test accounts (migration 0028)

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
returns all three fixtures, because `technicians_select` is `using (si_signed_in())` and 0028
touched only `users`. The name is also denormalised onto `work_orders.requester_name` /
`assigned_to_name`, `work_order_history.actor_name` and `comments.author_name`.

None of that is a privilege — the uuid buys nothing, as the empty PATCHes show — but the claim
is "cannot be seen or administered as an account", not "the name appears nowhere". The
history columns *must* keep the name; an audit trail that hides who acted is not an audit
trail. `technicians` is the one that is arguably wrong rather than necessary, and it is not
fixed: it is a live roster row, not a record of something that happened.

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
assets can be added freely and appear on the raise form immediately. Since 0019 *any* signed-in
user may insert a department, because the raise form offers "+ Add new" in its picker; renaming
and deleting one stay Manager+/Admin, which is the half that could damage existing records.

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

### Deleting work orders (migration 0018)

The only irreversible operation in the module, and the only capability that is **granted
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
password changes, **sign-in address changes** and account creation, since all three write
`auth.users` and need the service-role key. That function re-checks the caller is an active
admin *from the database*, not from the JWT claim.

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
  and no client may delete it), cleanup that reclaims space rather than just marking it dead,
  and the backup/export commands. **Free includes no backups at all.**
- `app/BUILD_AND_DEPLOY.md` — includes three machine-specific Gradle problems on this PC.
- `app/GO_LIVE.md` — env values, migrations, the access-token hook, seeding users.

## Known gaps

- Editing a work order's core fields while Open writes no history row (transitions are fully
  audited; the edit path isn't).
- `verified` is a history state, not a resting state — `completed → closed` happens in one
  move with `verified_by`/`verified_at` stamped.
- Single plant: `plant_id` is threaded everywhere but everything seeds to `PLT001` and no UI
  exposes plant selection.
- `@capacitor/cli` pulls a `tar` version with a critical advisory; fixing it needs a Capacitor
  6 → 8 major upgrade.
- **Most accounts cannot receive email.** The seeded ones are all `@example.com`, which
  `si_is_placeholder_email` correctly refuses to send recovery links to — so for those
  accounts the *only* credential route is the Superuser issuing a temporary password. That
  is the accepted trade-off of Superuser-only resets working as designed, but it is more
  absolute than intended until real addresses are set. Not a code gap; a data one.
- `send_recovery_link` is configured but **has never delivered a message**. `SITE_URL` and
  `NEXT_PUBLIC_SITE_URL` are both set to `https://si-cmms.vercel.app`, so the function no
  longer refuses — but the only account with a real address is Amirul's, so the first
  successful send will also be the first test of it. Two things are still unconfirmed until
  then: that `https://si-cmms.vercel.app/reset-password/` is listed under Authentication →
  URL Configuration → Redirect URLs (Supabase refuses the redirect otherwise, and the link
  dies *after* the mail arrives), and that the project's SMTP actually sends — the built-in
  sender is rate-limited to a handful of messages an hour.
