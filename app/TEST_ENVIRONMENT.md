# SI — Service Inside · The test environment

There are two Supabase projects. Everything about working with them is here.

| | Production | Test |
|---|---|---|
| Name | `SI-CMMS` | `SI-CMMS-test` |
| Ref | `iclphobvhjwdinxnqexw` | `vfkozckhthrrmxaewnlt` |
| Region | ap-northeast-1 | ap-northeast-1 |
| Values in | `app/.env.prod.local` | `app/.env.test.local` |
| Holds | real people, real work | six `@example.com` fixtures, one demo work order |

Both files are gitignored by the existing `.env*.local` rule. **`app/.env.local`
is now a generated file** — it is overwritten by the switch, so edit the two
source files instead and re-run the switch.

---

## Day to day

```bash
npm run env:which        # which project am I pointed at?
npm run env:test         # point everything at test
npm run env:prod         # point everything back
```

The switch moves **two** things together, and that is the whole reason it
exists as a script rather than a note telling you to edit a file:

1. `app/.env.local` — what the app and everything in `scripts/` reads
2. `supabase/.temp/project-ref` — what `db push` and `db:types` **write to**

Move only the first and `npm run db:push` applies your untested migration to
production while the app in front of you reads test. Both commands succeed.
Nothing warns you. So the switch does both or reports failure and exits
non-zero; `env:which` exits non-zero if it ever finds them disagreeing.

**Restart `npm run dev` after switching.** Next inlines `NEXT_PUBLIC_*` at build
time, so a running dev server keeps the old project and the switch looks as
though it did nothing.

`npm run check:env` proves the keys actually reach the project they name.

### The guard on the two writing scripts

`bootstrap:users` and `seed:demo` refuse to run when `.env.local` points at
production:

```
REFUSED — seed:demo writes data, and .env.local points at PRODUCTION (iclphobvhjwdinxnqexw).
```

Production is identified by the `SI_PROJECT_REF` in `.env.prod.local`, not by a
ref hardcoded in the script, so it survives the project being moved or rebuilt.
`-- --force` overrides it deliberately. If `.env.prod.local` is missing the
scripts warn and continue, because with nothing to compare against a guard that
blocked would just be in the way.

Nothing guards `db:push`, and nothing should — pushing migrations to production
is the normal end state of a migration, not an accident.

---

## Keeping test in step

### After writing a migration

```bash
npm run env:test
npm run db:push          # try it here first
npm run db:types
# exercise it in the app, then:
npm run env:prod
npm run db:push
```

A plpgsql body is not parsed until it is called, so **a successful push is not
evidence that a function works** — exercise every branch. That is the whole
value of having somewhere to be wrong.

### After reference data changes on production

```bash
npm run clone:config -- --dry-run   # see what would change
npm run clone:config                # departments, equipment, labels, SLA
npm run clone:config -- --prune     # also drop what production no longer has
```

Copies `plants`, `departments`, `assets`, `priorities`, `impact_levels`,
`wo_types`, `safety_severities`, `wo_statuses`, `sla` and `role_permissions`.

Copies **no people and no work**: `users`, `technicians`, `work_orders`,
`work_order_history`, `comments`, `attachments`, `notifications`,
`login_attempts`, `stats` and `counters` are left alone. No real person's name,
address or password hash leaves production.

Three properties worth not undoing:

- It reads `.env.prod.local` and `.env.test.local` **directly**, never
  `.env.local`, so which way the switch is currently thrown cannot reverse it.
- The direction is hardcoded. No flag makes it write to production.
- It refuses to start if the two files name the same project.

It upserts by primary key and deletes nothing unless you pass `--prune`. What
`--prune` is for is migration 0006's seed data: a fresh project gets
`DEPT-QUALITY` and five `AST-0***` machines that production replaced long ago,
and they sit in the pickers looking real. A row a test work order already
references survives `--prune` anyway — its foreign key refuses the delete, which
is correct, and the refusal is printed rather than thrown.

---

## The staging site

Vercel holds different values per environment, so no second Vercel project is
needed:

- **Production** env vars → `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  for `iclphobvhjwdinxnqexw`
- **Preview** env vars → the same two names, for `vfkozckhthrrmxaewnlt`

Then a branch push builds a staging site on the test database and `main` deploys
production, untouched. Values are baked in at build time, so changing one needs
a redeploy.

Two things to do once a preview hostname exists: add it to the **test** project's
Authentication → URL Configuration → Redirect URLs, and put it in
`NEXT_PUBLIC_SITE_URL` in `.env.test.local`.

**The staging site is visually identical to the live app.** Same login screen,
same everything, no banner — that was a deliberate choice. Know it before you
hand somebody the link.

---

## Standing up a project from scratch

In order. Steps 1–6 are scripted; step 7 is not.

```bash
npm run env:test
npx supabase db push                          # all migrations
npx supabase functions deploy admin-users
npx supabase functions deploy auth-signin
npx supabase config push                      # enables the access-token hook
npm run bootstrap:users                       # the six fixtures
npm run clone:config -- --prune               # real departments and equipment
npm run seed:demo                             # one work order, raise to closed
npm run check:env
```

### `config push` is the dangerous one

It does **not** push only what `supabase/config.toml` states. It pushes the
entire auth config, filling everything unstated from CLI defaults, silently
overwriting the dashboard. Measured against the test project on 2026-08-21:
MFA TOTP enrol and verify `true → false`, email confirmations `true → false`,
`max_frequency` `1m0s → 1s`, `otp_length` `8 → 6`.

Irrelevant on a test project. On production that is MFA off and email
confirmation off, unannounced. **Never run it while linked to production.**
There is deliberately no `npm run config:push`.

### Verify the hook fired

Without it users sign in successfully and see an empty app, because `si_roles()`
returns nothing and every policy evaluates false. It is the failure that looks
like a permissions bug.

```bash
curl -s -X POST "https://<ref>.supabase.co/auth/v1/token?grant_type=password" -H "apikey: <anon key>" -H "Content-Type: application/json" -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
```

The decoded `access_token` payload must carry `user_role`, `user_roles` **and**
`is_protected` beside `"role": "authenticated"`. Measured on test after
`config push`: `user_role=admin`, `user_roles=["admin"]`, `is_protected=false`.

### Step 7, by hand in the dashboard

Only needed for password-recovery email, so it can wait:

- Authentication → URL Configuration → Site URL and Redirect URLs
- Edge Functions → Secrets → `SITE_URL` (`send_recovery_link` refuses to send
  without it)

---

## Things that are true of test and not of production

**The six fixtures are not marked `is_test_account` on test.** Migration 0028
backfills that flag from `seed_source` as a one-time UPDATE, and on a fresh
project it runs before `bootstrap:users` has created anybody. So on test the
fixtures are visible in Admin → Users and in the technician roster, and the demo
work order carries `is_test_data = false` and therefore **counts in the dashboard
statistics**.

Convenient — a demo work order you can actually see on the dashboard — but it
means the one thing you cannot test on the test project is the test-account
hiding itself. The tell is `technicians`: production returns `[]` to an
Administrator, test returns the fixtures.

**Auth settings differ**, as listed under `config push` above.

**The free plan pauses a project after 7 days with no activity.** Restoring is a
button in the dashboard and takes a couple of minutes, but a staging link handed
out on a Friday may need waking on the Monday. Two active projects is also the
free ceiling, so this is the last one.

---

## The migration drift this uncovered

`supabase/migrations/` could not build a database. Pushing into the new project
stopped at 0013:

```
ERROR: function public.si_guard_protected_user() does not exist (42883)
```

`users.is_protected`, `si_protected_override()` and `si_guard_protected_user()`
were created directly in the dashboard years before this directory existed, and
0013's own closing note said so and was never acted on. Eight migrations assume
they are already there.

They are now reconstructed at the top of `0013_fix_protected_user_guard.sql`,
**from the contract those migrations describe rather than copied from
production** — production's bodies have never been read, because that needs
`supabase db dump` (Docker), psql, or a management API token, and this machine
has none of the three. Every statement is conditional on the object being
absent, so it changes nothing on production and creates a working equivalent on
a fresh project. `create or replace` would have overwritten the real guard with
the guess, which is worse than the drift.

To replace the guess with the real thing, run this in the **production** SQL
editor and paste the result over the conditionals:

```sql
select pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('si_protected_override', 'si_guard_protected_user');

select tgname, pg_get_triggerdef(oid)
  from pg_trigger
 where tgrelid = 'public.users'::regclass and not tgisinternal;
```

Until then the test project's protected-account guard is behaviourally
equivalent as far as the contract goes, and not known to be identical.

### Why a new migration file could not carry it

It had to run after 0001 and before 0013, and the CLI makes that impossible.
Migration files sort by **filename**, and every digit is below `_` in ASCII — so
`00125_…` sorts *before* `0012_…`, not after, and it desynchronises the
applied-version pairing so the CLI then wants to re-apply 0012. A letter suffix
(`0012a_…`) sorts correctly and is **ignored outright**, because the version
parser takes digits only. Both measured. 0013 was the only home left, and it is
already applied on production, so it can never re-run there.
