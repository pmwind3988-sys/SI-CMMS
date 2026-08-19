# Employee-ID sign-in and credential handling — design

**Date:** 2026-08-19
**Status:** approved, not yet implemented
**Scope:** sub-project 3 of 4 (see "Sequence" at the end)

---

## The problem

Four requirements arrived together, and they turn out to be one subject:

1. Sign in with an employee ID as well as an email address.
2. Temporary passwords for accounts that cannot receive email.
3. A forced password change when a credential was issued by somebody else.
4. Password resets restricted to the Superuser.

They are one subject because each of them asks the same question the schema
currently cannot answer: **is this account entitled to be used right now, and by
whom?** `users.status` exists and decides nothing. `users.password_changed_at`
exists and is read only by a dashboard badge. Sign-in has exactly one identifier
and no server of ours in the path.

## Decisions taken

Recorded because each closes off an alternative a later reader might otherwise
assume was overlooked.

| Decision | Choice | Alternative rejected |
|---|---|---|
| Where the employee ID comes from | **Existing HR number, entered by an administrator, nullable** | App-generated sequence; derived from the email local-part |
| ID → email resolution | **Inside an Edge Function; discloses nothing** | Anon-callable RPC returning the address |
| Credential delivery, normal case | **Supabase recovery link; the person sets their own** | Temporary password for everyone |
| Credential delivery, no mailbox | **Superuser-issued temporary password, shown once** | Require a real mailbox for every account; shared mailboxes |
| Who may set a password | **Superuser only** | Rank rule as today; admins for subordinates |
| Who may change a sign-in address | **Own account, or Superuser** | Rank rule as today |
| Enforcement of account state | **Withhold role claims at token issue** | RLS policy changes; client gate alone |

### Why an alias address was rejected

Storing `emp-1042@…` as the GoTrue email removes the lookup entirely: the client
derives the address from the typed ID and signs in normally, with no oracle and
no function in the path. It is the cheapest design and it is unusable here,
because GoTrue sends recovery mail **to the auth email**. An alias is not
deliverable, so choosing it would silently disable the recovery-link path that is
the primary credential route. Rejected before it was offered.

### Why not an anon RPC for the lookup

The anon key ships inside the browser bundle, so any endpoint granted to `anon`
is a public endpoint. A function mapping employee ID to email address is then a
staff directory and a credential-stuffing target list, walkable in a loop. Exact
match, rate limits and hashing all still leave an oracle: the caller learns which
IDs exist. Resolution therefore happens where the service-role key already
lives, and a wrong ID is indistinguishable from a wrong password.

### The consequence of Superuser-only resets

An administrator can send a reset link but cannot set a password. An account with
no working mailbox and a forgotten password therefore waits for the Superuser —
including on a night shift. Accepted knowingly: the point is that no
administrator ever holds a credential belonging to someone else.

This is only true if sign-in **addresses** are locked down at the same time. With
the rank rule left in place on `set_email`, an administrator repoints a
subordinate's address at a mailbox they control, runs the self-service reset, and
has the password without ever calling `set_password`. CLAUDE.md already states
that an address change is as privileged as a password reset; this makes the two
agree. Own-account changes stay open, because changing your own address is not an
escalation.

---

## 1. Schema

Migration `0025_employee_id_and_credentials.sql` — the columns, the index, the
self-update guard and the trigger statement in §4. The hook is migration 0026,
applied and verified on its own (§2).

```sql
alter table users add column if not exists employee_id text;
alter table users add column if not exists must_change_password boolean not null default false;

-- Case- and whitespace-insensitive, because the number is copied off a badge.
create unique index if not exists users_employee_id_key
  on users (upper(btrim(employee_id))) where employee_id is not null;
```

Nullable and partial: every existing row has no employee ID, several accounts
never will, and `null` must not collide with `null`.

Both columns join the rejected set in `si_guard_user_self_update`, alongside
`role`, `status` and the seed columns, for the reason those are there: **an
account must not be able to clear its own flag** or claim an ID belonging to
somebody else. An administrator still can, which is the escape hatch.

`employee_id` is added to the Edge Function's `create_user` payload and to the
plain-UPDATE profile path for administrators. It is not a column a non-admin may
write about themselves.

## 2. Claims, and the trap that looks like it works

Migration `0026_account_state_claims.sql`, on its own, containing nothing but the
hook. It is the only edit in this sub-project that can lock every user out of the
app at once, and separating it buys three things: 0025 lands and is verified while
authorization is still untouched; the diff a reviewer reads is one function; and a
rollback is reinstating 0020's hook body, with no columns to unwind and nothing
else in the migration to lose.

The hook grants role claims only to an account that is `active` **and** owes no
password change:

```
custom_access_token_hook:
  if status <> 'active' or must_change_password
      -> withhold user_roles AND user_role
  claims.must_change_password := must_change_password
```

Everything else follows without touching a single policy, because `si_roles()`
returning `{}` is already denied everywhere. One mechanism covers both the
inactive-account gap and the password gate.

**The trap.** Emitting `user_roles: []` is not enough. `si_roles()` aggregates
the array with `array_agg`, which returns `NULL` over zero rows, so an empty
array falls through the `coalesce` into the branch that reads `user_role` — and
the single role comes back. The hook must withhold **both** claims. Emitting an
empty array alone reads as correct, denies nothing, and raises nothing anywhere.

`si_is_superuser()` needs no change: with no roles, `si_has_role('admin')` is
false, so an inactive Superuser is not one either.

### What this does not do

Deactivation is not immediate. Tokens live about an hour, so an account
deactivated at 14:00 keeps working until roughly 15:00 unless it signs out. This
is the same latency a role change already has and is documented in CLAUDE.md;
revoking the live session was offered and deliberately not taken, to avoid making
deactivation depend on the Edge Function being reachable.

## 3. Sign-in

A **new** Edge Function, `supabase/functions/auth-signin`, deployed with
`verify_jwt = false`.

Not a new action on `admin-users`. That function's first act is to verify the
caller is an active administrator; an unauthenticated action inside it would sit
one `if` away from every privileged operation in the module. Separate function,
separate blast radius.

```
POST { identifier, password }

  identifier contains '@'  -> treat as the email
  otherwise                -> select email from users
                              where upper(btrim(employee_id)) = upper(btrim($1))

  -> POST GoTrue /auth/v1/token?grant_type=password
  -> 200: return the session verbatim
  -> anything else: { error: "Those details didn't match." }
```

One message for every failure — unknown ID, wrong password, inactive, no ID set.
The response must not vary in shape or timing enough to distinguish them.

**The lookup must not filter on `status`.** Adding `and status = 'active'` is the
obvious defensive move and it breaks the design: an inactive account would then
fail at resolution while a wrong password fails at GoTrue, and the two become
distinguishable. Inactive accounts authenticate normally here and are denied by
carrying no roles (§2), which is the only place that decision belongs.

The password is forwarded and never logged. `console.log` of the request body is
the failure mode to watch for in review.

**Email sign-in stays on the direct `signInWithPassword` path.** Routing
everything through the function would be more uniform and would make the function
a single point of failure for all access. Splitting means an outage costs
ID sign-ins only, and the accounts most likely to have a mailbox are the ones
still able to get in.

Client side, `signIn(identifier, password, remember)` picks the path on the
presence of `@`, then `supabase.auth.setSession(session)` for the function path.
Remember-Me stores the identifier **as typed**, so someone who signs in by number
is offered the number next time. The storage adapter's ordering constraint is
unchanged: the flag is written before either call.

### Rate limiting is weakened, knowingly

GoTrue throttles by origin. Every ID sign-in reaches it from the Edge Function's
egress address, so its per-IP counter sees one client for the whole plant: it will
either throttle everybody at once or protect nobody. The function therefore keeps
its own attempt counter and returns the same generic message when tripped.
Without this, adding the function makes brute-force protection worse than it is
today — a regression disguised as a feature.

An Edge Function is stateless, so the counter needs a home. It is a table, not
in-memory state — migration `0027_login_attempts.sql`, landing with the function
that uses it and with nothing before that reading it:

```sql
create table login_attempts (
  identifier   text        primary key,   -- lower(btrim(...)) as typed
  failed_count int         not null default 0,
  first_failed timestamptz not null default now(),
  locked_until timestamptz
);
```

Written only with the service-role key, so `revoke all from public, anon,
authenticated` and no policies — nothing outside the function reads or writes it.
A pg_cron sweep clears rows older than a day, alongside the existing sweeps in
0004.

**Locking by identifier is a denial-of-service vector**: anyone who knows an
employee number can lock that person out by failing a few times. So the response
is a short escalating delay — measured in minutes, cleared on the first success —
rather than a lockout an attacker can pin. Tuning belongs in the plan; the
requirement here is that it expires on its own and never needs an administrator
to lift it.

## 4. Forced password change

`si_sync_auth_user_activity` (migration 0012) already fires on
`auth.users.encrypted_password` changing, and already stamps
`password_changed_at`. It gains one more statement: clear
`must_change_password`.

**Ordering is load-bearing.** Issuing a temporary password is itself a password
change, so the trigger fires and clears the flag. The Edge Function must
therefore write the flag **after** the password, not before. Reversed, the
feature is silently off: the account gets a temporary password and no obligation
to change it, with nothing anywhere reporting a problem.

The user changing their own password goes through `updateUser`, which returns a
fresh session — so the flag clears, new claims are minted immediately, and roles
appear without waiting for the hourly refresh.

A new `/change-password` page is the only thing a flagged account can usefully
reach. It is a courtesy, not the enforcement: the enforcement is that the token
carries no roles, so the rest of the app is empty anyway. Getting past the
redirect gains nothing.

**It must not sit behind `RequireRole`.** A flagged account holds no roles, so
every role gate rejects it — including the gate on the one page it has to reach.
The page needs a signed-in check and nothing more. Its own profile read still
works: `users_select` allows `id = auth.uid()` independently of any role, so the
name and email render normally.

Escape hatch if a flag sticks: a Superuser clears it in Supabase, the same place
`is_protected` is administered.

## 5. Privileged paths

Three enforcement points, as ever, and a rule added to one and not the others is
a hole.

| Operation | Rule | Where |
|---|---|---|
| `set_password` | caller `is_protected`; sets `must_change_password` after | Edge Function `admin-users` |
| `send_recovery_link` (new) | active admin, target strictly below caller's rank; refuses a placeholder address | Edge Function `admin-users` |
| `set_email` | target is the caller, or caller `is_protected` | Edge Function `admin-users` |
| `employee_id` write | admin only, uniqueness from the index | `users` policies + Edge Function |

`send_recovery_link` refuses `si_is_placeholder_email(target.email)` **loudly**.
Sending recovery mail to `tech.arun@example.com` succeeds at the API and delivers
nothing; a silent success here is the worst outcome, because the administrator
believes the person has been helped.

Client predicates mirror these and decide only what to show:
`canSetUserPassword` becomes a Superuser test, `canSendRecoveryLink` the rank
test, `canChangeUserEmail` self-or-Superuser.

## 6. Client

- Login field becomes "Company email or employee ID", `type="text"`,
  `autoComplete="username"`. The `COMPANY_EMAIL_DOMAIN` check applies only when
  the input contains `@` — otherwise it would reject every employee number.
- `AuthContext` user shape gains `mustChangePassword`, read from the claim.
- `/change-password`, reachable signed-in, and the redirect target while flagged.
- Admin → Users: an Employee ID column and field; "Password" visible to a
  Superuser only; "Send reset link" for administrators; the uniqueness violation
  surfaced through `describeError` rather than replaced.

## 7. Ordering

1. Migration 0025 — columns, index, self-update guard, and the
   `si_sync_auth_user_activity` statement from §4. Applied.
2. `npm run db:types`.
3. **Verify 0025 in isolation** (§9 steps 1–3). Authorization is untouched at
   this point, so anything failing here is a schema bug and only that.
4. Migration 0026 — the hook, alone. Applied.
5. **Verify 0026 before any function or client work** (§9 steps 4–6). Until this
   passes, stop: every later step assumes the hook is right, and a wrong hook
   denies silently rather than erroring.
6. Edge Function `admin-users`: the three rule changes plus `send_recovery_link`.
7. Migration 0027 (`login_attempts` and its sweep) and Edge Function
   `auth-signin`: new, `verify_jwt = false`.
8. Client: `AuthContext`, login page, `/change-password`, Admin → Users.

Every step is safe to stop after. 0025 changes no behaviour at all: two unused
columns, and a trigger statement that clears a flag nothing has set yet.

0026 is the one to read twice before applying. Its flagged half is inert on the
day it lands — nothing writes `must_change_password` until step 6 — but its
inactive half is live immediately, and that is the point of the change rather
than a side effect: **any account currently `status <> 'active'` loses access at
its next token refresh.** Intended, but it should be a list someone has looked
at, not a discovery. Check it before applying, not after.

The old client keeps working throughout. An account that is active and unflagged
gets exactly the claims it gets today, so nothing in steps 6–8 is needed for
steps 1–5 to be safe.

## 8. Risks

**The hook is the whole sub-project's risk.** It decides authorization for
everyone, the `array_agg` trap above makes a wrong version look right, and the
failure mode is silence — everyone signs in to an empty app. This project has
already had that failure once, when 0002's hook omitted `is_protected` and 0015
was written believing it was there. Verify a **freshly minted** token before and
after, not a cached one.

Its own migration and its own gate in §7 are the mitigation: it lands with
nothing yet depending on it, and with nothing else in the diff to distract the
review.

**A regression risk in the sign-in split.** Two paths mean two error surfaces.
The generic-message requirement applies to both, or the direct path leaks
"user not found" for emails while the function path does not.

**Placeholder addresses.** Five of seven current accounts cannot receive mail, so
the primary credential route does not work for them until real addresses are set.
This is demo data, not a design flaw, but it means testing the recovery-link path
needs a real mailbox.

**Deactivation latency**, as in §2.

## 9. Verification

**After 0025, before 0026.** Nothing here touches authorization, so all of it
should pass with the app behaving exactly as it does today.

1. Migration applies; every existing row has `employee_id = null`,
   `must_change_password = false`.
2. Two accounts, same ID in different case — the second is refused by the index.
3. An administrator writes `employee_id` on a subordinate; an account cannot
   write its own (the guard in §1). Sign-in, roles and dashboards unchanged.

**After 0026, before any function or client work.** This is the gate.

4. A **fresh** token for an active, unflagged account still carries
   `user_roles`, `user_role`, `is_protected` — sign out and in, do not read a
   cached token.
5. Deactivate an account, sign it out and in: it reaches an empty app, not its
   dashboard. Reactivate; access returns. **This is where the `array_agg` trap
   of §2 shows up** — a hook that emits `user_roles: []` but keeps `user_role`
   passes step 4 and fails here, with the deactivated account still holding its
   roles. Read the claims, not just the screen: a dashboard that looks empty for
   another reason would hide it.
6. Set `must_change_password` by hand on a test account, sign it out and in: no
   roles in the token and the claim true. Clear it; roles return. Separate from
   step 5 because the two conditions are separate: a hook that gates on `status`
   and forgets the flag passes 4 and 5 and fails only here.

**After the functions and the client.**

7. Set an employee ID on one account. Sign in with the number; land on the
   right dashboard. Sign in with the email; same result.
8. Wrong number, and right number with wrong password: identical message.
9. Superuser sets a temporary password. Confirm `must_change_password` is
   **true** afterwards — this is the ordering trap in §4, and true here is the
   whole test.
10. Sign in with that temporary password: redirected to `/change-password`, and
    the rest of the app is empty. Change it; roles appear without a sign-out.
11. An administrator: no "Password" button, "Send reset link" present, refused on
    a placeholder address with a message naming the problem.
12. An administrator cannot change another account's sign-in address; can change
    their own.
13. Trip the attempt counter on the function; confirm the same generic message
    and that a correct credential works again after the delay.
14. Supabase security advisor, as CLAUDE.md requires after any migration adding
    functions.

## Sequence

1. **Done** — Area field, equipment pickable from any department, department
   delete.
2. **Done** — multi-role accounts (migrations 0020, 0021).
3. **This spec** — employee-ID sign-in, credential handling, account-state
   enforcement.
4. **Next** — admin CRUD widening, checkbox multi-select bulk delete, admins
   editing their own details.
