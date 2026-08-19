# Multi-role accounts — design

**Date:** 2026-08-19
**Status:** approved, not yet implemented
**Scope:** sub-project 2 of 4 (see "Sequence" at the end)

---

## The problem

`public.users.role` is a single `si_role` value. One account is exactly one of
requester, technician, supervisor, manager, admin. A working supervisor who also
picks up jobs cannot exist: they are either able to assign work or able to do it,
never both.

This makes an account's roles a **set** rather than a value, and defines what the
union of two roles means for authorization, for the audit trail, and on screen.

## Decisions taken

Recorded because each closes off an alternative that a later reader might
otherwise assume was overlooked.

| Decision | Choice | Alternative rejected |
|---|---|---|
| Which combinations | **Any** | Hardcoded supervisor+technician; "anything below manager" |
| What holding two roles means | **Union of permissions, always in force** | An active-role switch that gates what you may do |
| Self-assignment | **Blocked** | Allowed; allowed-but-flagged |
| Two dashboards | **Land on highest, switcher to the others** | One merged dashboard; highest only |
| Storage | **`users.roles si_role[]`** | Keep `role` as a maintained primary; a `user_roles` join table |

### Why an array and not a join table

A join table is the textbook shape and is wrong here specifically. The
`users_update` policy compares ranks with no subquery, because the row being
checked carries both the role and the `is_protected` flag being compared —
CLAUDE.md calls this out, and it is what keeps a policy *on* `users` from having
to read `users`. A join table reintroduces exactly that read. An array column
keeps the row self-describing and the policy recursion-free.

### The consequence of blocking self-assignment

If one person is simultaneously the only active Supervisor and the only active
Technician, work orders cannot be assigned at all: they cannot take the job
themselves and nobody else can give it to them. A Manager or Administrator can
always assign, so there is a route out, and this was accepted knowingly. It is
recorded here because the failure looks like "the assign button does nothing
useful" rather than like a policy decision.

---

## 1. Schema

```
alter table users add column roles si_role[];                    -- nullable first
update users set roles = array[role];                            -- backfill
alter table users alter column roles set not null;               -- then constrain
alter table users add constraint users_roles_not_empty check (cardinality(roles) >= 1);
alter table users drop column role;
create index users_roles_gin on users using gin (roles);
```

The column is added nullable and tightened afterwards, because `add column …
not null` with no default fails on a table that already has rows. It is
deliberately left **without a default**: `default '{}'` would satisfy `not null`
and then immediately violate the check, so an insert that forgets `roles` would
fail with a confusing constraint error instead of a clear "null value in column".
Every insert must name the roles explicitly.

`role` is dropped rather than kept. Two columns describing one fact drift, and
the readers that matter are membership tests (`where role = 'supervisor'` in the
notification fan-out), for which a "primary role" answers the wrong question.

The GIN index serves the `'supervisor' = any(roles)` lookups in the fan-out
helpers, which run inside SLA sweeps on every overdue work order.

**Not changing:** `work_order_history.actor_role`, `comments.author_role`,
`attachments.uploaded_by_role`, `notifications.recipient_role` stay singular
`si_role`. Each records a role in a moment, not an account's capabilities, and a
moment still has exactly one. `wo_status_transitions.roles` is already `si_role[]`
and already means "any of these" — its meaning is unchanged, only what it is
matched against.

## 2. Claims, and the rollout hazard

`custom_access_token_hook` emits **both**:

- `user_roles` — the array
- `user_role` — the highest-ranked role held, retained so that anything not yet
  migrated keeps reading something true

```
si_roles() returns si_role[]:
  coalesce(claim 'user_roles' as si_role[], array[claim 'user_role'], '{}')
```

**The fallback is load-bearing, not defensive tidiness.** Access tokens live up
to an hour. Every user signed in when this migration is applied is carrying a
token minted by the old hook, with `user_role` and no `user_roles`. If
`si_roles()` returned empty for those, every policy would deny and the entire
plant would be locked out until each token happened to refresh — and it would
fail *silently*, in the same way the missing `is_protected` claim did before
migration 0017. With the fallback, a pre-migration token simply behaves as the
single role it was issued for, and gains the extra roles at its next refresh.

Same reasoning in the opposite direction: an account with no usable claim yields
an empty array, every membership test is false, and it can act on nothing. Fail
closed, as `si_role_rank()` already does for an unrecognised role.

## 3. Authorization semantics

Authorization is the **union of the roles held**, evaluated server-side, always.
Nothing in the UI narrows it.

| Function | Becomes |
|---|---|
| `si_roles()` | new — the caller's roles, with the fallback above |
| `si_has_role(text)` | new — `$1 = any(si_roles())` |
| `si_role()` | the **highest** role held — see the note below |
| `si_is_requester/technician/supervisor/manager/admin()` | `si_has_role('…')` |
| `si_is_manager_or_admin()` | `si_has_role('manager') or si_has_role('admin')` |
| `si_role_rank(text)` | unchanged |
| `si_roles_rank(si_role[])` | new — max rank in the array, 0 if empty |
| `si_account_rank(si_role[], boolean)` | 6 if protected, else `si_roles_rank()` |
| `si_caller_rank()` | 6 if superuser, else `si_roles_rank(si_roles())` |
| `si_can_delete_work_orders()` | superuser, or **any** held role granted in `role_permissions` |
| `si_department_supervisors(text)` | `'supervisor' = any(roles)`, keeping 0019's no-supervisor fallback |
| `si_managers()` | `'manager' = any(roles)` |
| `si_compute_dashboard_stats` caller gate (0004) | membership instead of `si_role() not in (…)` |

Because rank is the **maximum** held, every existing hierarchy rule carries over
untouched: a Supervisor+Technician ranks 3, an Administrator who is also a
Requester still ranks 5, administrators still cannot edit each other, and only a
Superuser still creates an Administrator.

**On `si_role()`.** After this change it very likely has *no remaining SQL
callers*: every `si_is_*` is membership, rank goes through `si_roles_rank`, and
`actor_role` comes from `si_eligible_roles`. It is kept anyway, for two honest
reasons — it is what the hook derives the `user_role` claim from, and it is the
singular value the client needs for landing and display. It must not be used for
an authorization decision again; a decision that asks "what is this person"
instead of "may this person do this" is the bug this whole design removes.
The implementation should confirm the caller list is empty rather than assume it.

`si_account_rank(text, boolean)` is replaced by the array signature. The old one
is dropped explicitly — leaving both would let a future policy call the wrong
overload and silently compare a single role.

`si_in_same_department()` remains defined and uncalled, as migration 0019 left it.

### Policies touched

`users_select`, `users_insert`, `users_update`, `users_delete` change only where
they call `si_account_rank(role::text, is_protected)` — now
`si_account_rank(roles, is_protected)`. The rank logic itself is unchanged.

`si_guard_user_self_update` compares `roles` instead of `role`; the self-lock on
changing your own roles or status stays above the admin exemption, as 0015 wrote
it.

## 4. The transition trigger

The most substantive rewrite, because the current shape is actively wrong under a
union.

Today `si_guard_work_order_transition` rejects with:

```
if v_role = 'technician' and old.assigned_to_id is distinct from auth.uid() then raise
if v_role = 'requester'  and old.requester_id  is distinct from auth.uid() then raise
```

A Supervisor+Technician acting on a job that is not theirs qualifies **as
supervisor** — but `si_role()` may return `technician`, and the check would refuse
them. The scope tests have to stop asking "what is this person" and start asking
"is there a role under which this move is permitted".

New shared helper, so the trigger and the RPC cannot disagree:

```
si_eligible_roles(p_transition_roles si_role[], p_assigned_to uuid, p_requester uuid)
  returns si_role[]:
    take si_roles() ∩ p_transition_roles
    drop 'technician' when p_assigned_to is distinct from auth.uid()
    drop 'requester'  when p_requester  is distinct from auth.uid()
```

The trigger then:

1. `auth.uid() is null` → return (cron, service role, scripts) — unchanged.
2. **Self-assignment check** — see below. Placed *above* the admin bypass.
3. `si_has_role('admin')` → return (matrix bypass) — unchanged in effect.
4. No roles at all → the existing "sign out and back in" error.
5. Look up the `wo_status_transitions` row; not found → unchanged error.
6. `si_eligible_roles(t.roles, old.assigned_to_id, old.requester_id)`; empty →
   raise. The message must distinguish the two reasons, because they send the
   reader to different places:
   - the caller holds none of `t.roles` → "A %s may not perform …" (as today,
     listing the roles they hold)
   - they hold the role but not the record → "You can only act on work orders
     assigned to you / that you raised" (as today)
7. `requires_assignee_change` and the `requires` field loop — unchanged.

### Self-assignment

```
if new.assigned_to_id is distinct from old.assigned_to_id
   and new.assigned_to_id = auth.uid() then
  raise 'You cannot assign a work order to yourself. Ask another Supervisor or a Manager.'
```

**Above the admin bypass**, so it is uniform for every role including
Administrator and Superuser. The precedent is migration 0015, which put the
self-role-change lock above the admin exemption for the same reason: a rule
whose whole purpose is to stop you acting on yourself is worthless if the most
privileged account is exempt.

This is purely additive for single-role accounts. A plain Supervisor was never in
the `technicians` roster, so they could not have been assigned anything anyway.

### The audit trail gains a fact

`si_transition_work_order` (0010) currently reads `role` out of `users` into
`v_actor_role`. It will instead stamp **the highest eligible role** — the role
under which the move was actually authorised — by calling `si_eligible_roles()`.

So the history stops saying only *who* and starts saying *under which role*:
"Priya Nair · Supervisor" on the assign, "Priya Nair · Technician" on the accept.
For a single-role account this is identical to what is stored today.

## 5. Client

The contract in `context/AuthContext.js` gains `roles` and keeps `role`:

```
user = { …, roles: ['supervisor','technician'], role: 'supervisor' /* highest */ }
```

Keeping `role` as the highest is deliberate: the ~20 sites that use it for
*display* and *landing* want exactly one, and only the sites that make decisions
need converting to membership.

| File | Change |
|---|---|
| `lib/roles.js` | `hasRole(user, r)`, `highestRole(roles)`; `accountRank` takes an array; `ROLE_LABELS` unchanged |
| `context/AuthContext.js` | read `user_roles` claim with the same fallback as SQL; derive `role` |
| `components/RequireRole.jsx` | `allow` matches if **any** held role matches; elevated likewise |
| `lib/constants.js` | every predicate → membership (`isAssigneeOf`, `isRequesterOf`, `isSupervisor`, `isManagerOrAdmin`, `canAssign`, `canDeleteWorkOrders`) |
| `lib/workOrders.js` | `listenWorkOrderList` becomes a union: supervisor/manager/admin → all; otherwise `.or(requester_id.eq.…,assigned_to_id.eq.…)` across whichever of requester/technician is held |
| `lib/admin.js` | `setUserRole` → `setUserRoles(userId, roles, dept, plants)` |
| `components/admin/UsersAdmin.jsx` | role dialog becomes multi-select; create-user takes a set; the roles column renders all held roles |
| `components/AppShell.jsx` | nav is the union of what any held role gets; the badge shows every role |
| `components/dashboard/RoleDashboard.jsx` | takes the view's role as a prop instead of reading `user.role`; the three pages that render it (`/dashboard` requester, `/technician/dashboard`, `/supervisor/dashboard`) each pass their own. Manager and Admin render `DashboardModule` instead, so the switcher moves between two different components — which is why it links between routes rather than swapping a view in place |
| `components/dashboard/DashboardModule.jsx` | membership for the admin/refresh checks |
| `components/workorders/AssignPanel.jsx` | drop the signed-in user from the roster |
| `components/workorders/WorkflowPanel.jsx`, `WorkOrderList.jsx` | membership for the supervisor-like and technician branches |
| new `components/dashboard/RoleSwitcher.jsx` | links to each held role's dashboard; renders nothing for a single-role account |

### The switcher is a view control, not a security control

Landing stays `dashboardPathForRole(highest)`. The switcher links to the other
dashboards the account holds; the routes already exist and `RequireRole` will
admit them once it is membership-based.

**Which view is open never changes what the user may do.** The database grants
the union regardless. Anyone extending this must not add "current role" to the
JWT, to a policy, or to any write path — the moment the switcher gates a
capability it becomes a security boundary living in `localStorage`.

## 6. Privileged paths

Three enforcement points, per CLAUDE.md, and a rule added to one and not the
others is a hole:

1. **`users_*` policies** — the `si_account_rank` signature change above.
2. **`si_set_user_role` → `si_set_user_roles(p_uid uuid, p_roles si_role[], …)`**
   (SECURITY DEFINER, so every rule restated): caller holds supervisor/manager/
   admin; target not protected; target is not the caller; target's rank strictly
   below caller's; **every role being granted** strictly below the caller's rank;
   supervisor still confined to their own department. Grants a `technicians` row
   when `technician` enters the set. The old single-role function is dropped so
   no caller can reach the un-updated rules.
3. **`supabase/functions/admin-users`** (service role, bypasses RLS): its
   `ROLE_RANK` restatement takes the max over an array; `create_user` accepts a
   set and rejects any member at or above the caller's rank; `set_password` and
   `set_email` rank checks read `roles`.

`scripts/bootstrapUsers.js` writes `roles: ['x']`. `scripts/seedDemoWorkOrder.js`
passes role strings for history remarks only — unaffected.

`role_permissions` is untouched: still one row per `si_role` value, still
Superuser-only to write. Only its *reader* changes, to a union.

## 7. Ordering

The migration is one file and must be one transaction — a state where `roles`
exists but the hook still emits only `user_role`, or where the policies read
`roles` and the column is gone, is an outage.

1. Add `roles`, backfill, constrain, index, drop `role`.
2. Replace `custom_access_token_hook` (emits both claims).
3. New/replaced helpers: `si_roles`, `si_has_role`, `si_role`, `si_roles_rank`,
   `si_account_rank(si_role[], boolean)`, `si_caller_rank`, the five `si_is_*`,
   `si_is_manager_or_admin`, `si_can_delete_work_orders`,
   `si_department_supervisors`, `si_managers`, `si_eligible_roles`.
4. Drop `si_account_rank(text, boolean)` and `si_set_user_role(uuid, si_role, …)`.
5. Recreate the four `users_*` policies and `si_guard_user_self_update`.
6. Recreate `si_guard_work_order_transition` and `si_transition_work_order`.
7. Grants: revoke from `public, anon`, grant to `authenticated, service_role` for
   every new function. Any new `public` function is anon-callable by default —
   migrations 0007, 0008 and 0011 exist because of this.
8. `npm run db:types`, then the client and Edge Function changes.

Run the Supabase security advisor afterwards, per CLAUDE.md.

## 8. Risks

| Risk | Handling |
|---|---|
| Pre-migration tokens have no `user_roles` | `si_roles()` falls back to `array[user_role]`. **The single most important line in this design.** |
| A `public` function ships anon-callable | Explicit revoke/grant for every function added |
| Trigger and RPC disagree on the acting role | Both call `si_eligible_roles()`; neither reimplements it |
| Client predicate looser than policy | Predicates mirror membership; the policy still wins and raises |
| Sole supervisor-technician cannot be assigned work | Accepted (see "Decisions"). Manager/Admin can always assign |
| A future change gates a capability on the switcher | Called out explicitly in §5 |
| `si_account_rank` overload confusion | Old signature dropped, not left alongside |

## 9. Verification

No test suite exists (CLAUDE.md), so verification is `npm run build` plus a
manual pass on the dev server against the applied schema:

1. A single-role account of each of the five roles sees no change: same landing
   page, same nav, same dashboard, same work order list.
2. Grant Supervisor+Technician. Confirm: lands on the Supervisor dashboard; the
   switcher offers the Technician view; nav is the union.
3. As that account, assign a work order to **another** technician — permitted;
   history records `Supervisor`.
4. As that account, attempt to assign a work order to **themselves** — refused,
   and their own name is absent from the assign roster.
5. Have another supervisor assign them a job; accept it — permitted; history
   records `Technician`.
6. As that account, attempt a technician-only transition on a job assigned to
   **someone else** — refused with the "assigned to you" message, not with
   "a supervisor may not perform this".
7. Rank: confirm a Supervisor+Technician cannot edit a Supervisor, and that an
   Administrator still cannot edit another Administrator.
8. Revoke Technician; confirm the switcher disappears and the technician-only
   capabilities go with it after a token refresh.
9. Confirm the `technicians` row survives the revoke (skills are not lost).

## Sequence

Sub-project 2 of 4, per the agreed order:

1. ~~Area field + open equipment/department scope~~ — done, migration 0019.
2. **Multi-role** — this document.
3. Employee-ID login, temporary passwords, forced first-login change,
   Superuser-only reset.
4. Admin CRUD widening, bulk-delete checkboxes, admin self-edit.

Sub-project 4 builds the admin screens over the model this document defines,
which is why it comes last.
