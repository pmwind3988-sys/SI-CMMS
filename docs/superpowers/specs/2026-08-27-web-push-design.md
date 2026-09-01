# Web Push — alerts that arrive when the app is closed

**Date:** 2026-08-27
**Status:** design, approved in chat, not implemented
**Migration:** 0042 (next free number. This branch was cut before 0039-0041
landed on main and has since been merged up; 0041 is now the last on disk)

---

## The problem

`lib/osNotifications.js` delivers a status-bar notification with sound while the
app's Realtime websocket is alive — foreground or backgrounded. It cannot deliver
anything once the app is swiped away or the browser is closed, because a
notification with no process running has to be pushed *to* the device, and pushing
requires a sender holding credentials. `output: "export"` means this app has no
server of its own.

A technician who closes the app receives nothing. An SLA breach at 2am reaches
nobody. That is the gap this closes.

## What this is not

**It is not a loud alarm, and it cannot be made into one.** A web push plays the
device's default notification tone at the device's own volume. There is no web API
for a custom sound, no way to raise the volume, and no way past silent mode or Do
Not Disturb. What is available is a vibration pattern on Android,
`requireInteraction` on desktop, and `renotify` so a second alert re-alerts rather
than silently replacing the first. If genuinely loud is ever non-negotiable, that
is a native Android build and nothing else — the APK path that was dropped.

**Permission cannot be forced.** Each person must tap Allow once per device. There
is no admin switch and nothing deployed can grant it remotely. "Forced" here means
the app refuses to be used until they have been asked; it does not and cannot mean
the answer is guaranteed.

## Scope

Web only — Vercel, and the iPhone home-screen install. The native
`@capacitor/local-notifications` path is untouched: `isNativeApp()` already gates
it, and the APK is not shipped.

Every notification type is pushed. No urgent tier, no per-type filtering. The
volume problem this creates for Managers and Admins — roughly two extra rows per
work order each since 0038 — is real and is deliberately left as a fan-out problem
to solve at the fan-out, not a delivery problem to solve by dropping messages. A
delivery path that silently declines to deliver some things is the harder bug to
find later.

---

## 1. The gate

### Behaviour

After sign-in, before anything else, a full-screen gate:

> SI needs to alert you when work is assigned to you. This app dispatches
> breakdown repairs — alerts are not optional.

One button: **Enable alerts**. It calls the existing
`requestOsNotificationPermission()`, which already handles the user-gesture
requirement and the service-worker-registration race that Safari otherwise
rejects.

| Permission state | What the gate shows | Passable |
|---|---|---|
| `prompt` | The Enable button | only by tapping it |
| `granted` | nothing — gate does not render | n/a |
| `denied` | Per-browser OS-settings instructions, plus **Continue anyway** | yes, via the escape |
| `unsupported`, iPhone in Safari tab | Add-to-Home-Screen instructions | no |
| `unsupported`, genuinely incapable browser | A sentence saying so, plus **Continue anyway** | yes, via the escape |
| native app | gate does not render | n/a |

**The `denied` escape is not weakness, it is the only correct behaviour.** Chrome
and Safari both remember a refusal and ignore every subsequent
`requestPermission()` call. A gate with no escape at `denied` is a person who
cannot work and has no route out from inside the app. They meet the gate again on
every sign-in, which is the pressure that remains available.

**The iPhone-in-Safari case has no escape**, because it is the one unsupported
state the user can actually fix, and installing to the Home Screen is a
thirty-second action. `iosNeedsInstallForAlerts()` already separates this from a
genuinely incapable browser; that distinction is what makes an escape-less gate
defensible here and not elsewhere.

### Where it lives

`RequireAuth`, above the role gate and beside the `must_change_password` redirect,
for the same structural reason recorded in CLAUDE.md: an inner gate would race it
rather than defer to it.

It must render **after** `loading` resolves and **never** while
`sessionState === SESSION_RECOVERING`. Recovery already holds the page, and
stacking a second full-screen hold on top of it would show the gate to somebody
whose token is merely being refreshed.

`/change-password` and `/login` are exempt. A flagged account holds no roles and
must reach the one page it is allowed to use; asking it for notification
permission first is the same shape of bug as putting `/change-password` behind
`RequireRole`.

---

## 2. Data model

### `push_subscriptions`

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid not null, references `users(id)` on delete cascade | |
| `endpoint` | text not null **unique** | the push service URL; identifies the browser |
| `p256dh` | text not null | client public key, from the subscription |
| `auth` | text not null | client auth secret, from the subscription |
| `user_agent` | text | for diagnosing a dead row |
| `created_at` | timestamptz not null default now() | |
| `last_seen_at` | timestamptz not null default now() | refreshed on every re-register |
| `failed_at` | timestamptz | set on a non-fatal send failure |
| `last_error` | text | |

One row per browser per person. A phone and a desktop are two rows and both are
sent to.

### `notifications.pushed_at timestamptz`

Nullable. Stamped when at least one push service has accepted the message.

This column is the entire safety net. Unstamped and older than two minutes is the
retry set; a growing count of them is the only alarm that push has broken. Its
absence is what makes approach C different from a fire-and-forget trigger — and
this repo has been bitten repeatedly by controls that decide nothing and fail
silently (`users.status` for four migrations, the retirement flag 0031 argues
about, the `is_test_account` side door 0029 closed). A delivery path with no
record of what it delivered is that same shape, and here the consequence is a
missed safety-flagged P1.

### RLS

`push_subscriptions`: read your own, delete your own. **No client INSERT or UPDATE
policy at all** — those go through the RPC below. The push sender reads on the
service role.

Deliberately *not* readable by an Administrator. A subscription row is a list of
which devices a person uses and when they last used them; nothing in Admin → Users
needs it, and adding it would be a new disclosure justified by nothing.

---

## 3. Registering a subscription

`si_register_push_subscription(p_endpoint text, p_p256dh text, p_auth text,
p_user_agent text)` — SECURITY DEFINER, `search_path` pinned, `revoke all from
public, anon`, granted to `authenticated`.

Body: delete any row with this `endpoint`, then insert one for `auth.uid()`.

**It is an RPC and not a client upsert, because of the shared workshop terminal.**
When a second person signs in on the same browser, the push endpoint is
byte-identical — it belongs to the browser, not the account. That row must move to
the new person, and a client-side insert-or-update cannot do it: RLS correctly
refuses to touch a row currently owned by somebody else, so the write fails and
the previous holder keeps receiving alerts on a machine they walked away from.
That is the same shared-terminal hazard `draftRecovery` designs around by putting
the uid in every draft key.

It also matches the repo's standing preference for stating a write as an insert
rather than an upsert: PostgREST turns an upsert into `insert … on conflict do
update`, which needs the UPDATE policy this table deliberately does not have.

`si_unregister_push_subscription(p_endpoint text)` — same shape, deletes the row
for `auth.uid()`. Called on explicit sign-out.

**Not called on session loss.** An expired token is not a user leaving the device,
and destroying their subscription over a token refresh would silently stop alerts
for someone who did nothing wrong. This is the same judgement
`isRetryableFailure()` makes: being offline is not being signed out.

### Client lifecycle

New `src/lib/pushSubscription.js`:

- `ensurePushSubscription()` — called after the gate is passed and on every
  subsequent sign-in. Reads the existing `PushSubscription` if there is one,
  creates one with the VAPID public key if not, and calls the RPC either way so
  `last_seen_at` stays current.
- `dropPushSubscription()` — called from sign-out, before the session is cleared,
  because the RPC needs a token.

Re-registering on every sign-in rather than only on first grant is what recovers a
subscription the browser rotated or that the retry sweep deleted as `410 Gone`.

---

## 4. Delivery

### The trigger

`AFTER INSERT ON notifications FOR EACH ROW` calls `si_enqueue_push()`, which
calls `net.http_post` (pg_net) against the `push-notify` Edge Function with the
notification's id.

Asynchronous by construction: `net.http_post` queues the request and returns, so a
slow or dead function cannot block or fail the transaction that raised the work
order. That is a requirement, not a convenience — a push outage must never stop
someone reporting a fault.

The shared secret authenticating the call is read from **Supabase Vault**, so no
credential appears in a migration file.

**In a migration, not in the dashboard's Database Webhooks UI.** That UI creates
exactly this trigger and creates it *only* in the hosted project. CLAUDE.md
records what that costs: `users.is_protected`, `si_protected_override()` and
`si_guard_protected_user()` were created that way, went unrecorded for
twenty-three migrations, and left the schema unbuildable from its own files until
0013 reconstructed them.

### The function

`supabase/functions/push-notify`, deployed `--no-verify-jwt`.

Deployed with the flag rather than a `[functions.push-notify] verify_jwt = false`
block in `config.toml`, deliberately: `config.toml` is what `supabase config push`
sends, and CLAUDE.md forbids running that against production because it overwrites
the entire auth config from CLI defaults. Nothing about this feature should create
a reason to go near that command.

It:

1. Rejects any request whose shared-secret header does not match its own env
   secret. This is its only authentication — `verify_jwt` is off.
2. Loads the notification and the recipient's `push_subscriptions` rows on the
   service role.
3. Signs each message with the VAPID key pair and posts to each endpoint.
4. Stamps `pushed_at` if at least one endpoint accepted.

Payload: `{ id, title, body, type, path }` — the same fields the bell already
renders, plus the deep link `notificationclick` already knows how to follow.

### The guard that must be amended

`si_guard_notification_update()` (0002) refuses any change to a notification
except `status`, and checks it with a whole-row jsonb comparison:

```sql
if (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then
  raise exception 'Only the status of a notification may be changed.'
```

The push sender runs on the service role, where `auth.uid()` is null, so
`si_is_admin()` is **false** and the guard applies to it. Left alone, every
attempt to stamp `pushed_at` is refused, nothing is ever marked delivered, and the
retry sweep re-sends every notification forever — a duplicate-alert storm whose
cause is a trigger written thirty-six migrations ago.

The amendment is an `auth.uid() is null` early return at the top, the same
service-role door `si_protected_override()` opens and `si_guard_test_account()`
returns through. It carries the same accepted risk those do: it is safe only
because a null uid means a service-role connection, authenticated as trusted
elsewhere.

This is worth stating plainly because it is invisible from the feature's own code.
Nothing in the Edge Function or the new migration hints at it; the failure
surfaces only as notifications that arrive over and over.

### The retry sweep

`si_push_retry_sweep()` on `*/1 * * * *` — the same `cron.schedule` pattern as
0004's SLA sweeps and 0027's login-attempt sweep, and idempotent in the same way.

It selects notifications where `pushed_at is null` and `created_at < now() -
interval '2 minutes'`, capped, and re-posts them. The two-minute floor is what
keeps it from racing the trigger's own in-flight request.

Rows older than 24 hours are given up on and stamped, because a push about a work
order that moved on yesterday is noise, and an unbounded retry set is a queue that
only grows.

### Dead subscriptions

`410 Gone` or `404` from a push service means the browser discarded the
subscription — uninstalled, storage cleared, expired. That row is **deleted**, not
retried; it can never succeed again, and leaving it makes every future send for
that person slower and noisier.

Any other error stamps `failed_at` and `last_error` and leaves the row alone. A
push service returning `429` or `503` is a transient condition, and treating it as
a dead device would silently unsubscribe somebody during an outage.

---

## 5. The service worker

`public/sw.js` gains a `push` handler.

The file's existing comment says there is deliberately no push handler, because "a
push arrives from a server, and `output: export` means this app has none." That is
now false. **The comment is rewritten, not left in place** — a comment that
contradicts the code beside it is worse than no comment, and this repo's worst
historical failures are exactly things whose stated behaviour and real behaviour
had drifted apart.

There is still deliberately **no `fetch` handler**. That reasoning is unchanged
and stays: a cache in front of a Next static export serves last week's chunks
against this week's HTML and fails as a blank screen.

Options on `showNotification`:

- `tag: notification.id`, `renotify: true` — a second alert re-alerts rather than
  silently replacing the first.
- `vibrate: [200, 100, 200, 100, 400]` on Android.
- `requireInteraction: true` on desktop, so it stays on screen until dismissed.
- `data: { path }`, which the existing `notificationclick` handler already reads.

`notificationclick` needs no change.

---

## 6. Secrets

Generated locally and set by the user. None reach git.

| Where | Name | What |
|---|---|---|
| Edge Function secret | `VAPID_PUBLIC_KEY` | public half, base64url, 87 chars |
| Edge Function secret | `VAPID_PRIVATE_JWK` | private half — **the credential** |
| Edge Function secret | `VAPID_SUBJECT` | `mailto:` address, required by RFC 8292 |
| Edge Function secret | `PUSH_TRIGGER_SECRET` | shared with the trigger |
| Supabase Vault | `push_trigger_secret` | same value, read by `si_enqueue_push()` |
| Supabase Vault | `push_function_url` | so the URL is not hardcoded in a migration both projects share |
| `app/.env.*.local` | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public half again — the browser needs it to subscribe |

**The private key is a full JWK JSON string, not the 32-byte base64url scalar
the `web-push` npm ecosystem passes around.** `crypto.subtle.importKey` cannot
derive the public coordinates `x` and `y` from the private scalar `d`, so a bare
scalar is unusable in Deno and fails as an opaque `DataError` at signing time —
long after everything else looks correct. The generator emits the JWK directly
for this reason.

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is genuinely public: it is the key a browser
presents when subscribing, and it discloses nothing. The private half must never
be prefixed `NEXT_PUBLIC_`, never set in Vercel, and never leave the function —
the same rule `SUPABASE_SERVICE_ROLE_KEY` is already under.

Test and production get **different** key pairs. Sharing one would let the test
project's function send to production devices.

---

## 7. Verification

There is no test suite in this repo, so this is a manual protocol, run on
`SI-CMMS-test` before anything is pushed to production.

1. `npm run env:test`, `npm run db:push`, `npm run db:types`.
2. Deploy `push-notify` with `--no-verify-jwt`; set the three secrets.
3. Sign in on a real Android phone. Confirm the gate appears and cannot be
   dismissed. Tap Enable, allow. Confirm a `push_subscriptions` row exists.
4. **Close the browser completely** — swipe it out of the app switcher, not just
   background it.
5. From another account, assign a work order to the first.
6. Confirm the notification arrives in the status bar, that tapping it opens the
   right work order, and that `pushed_at` is stamped on the row.
7. Repeat on an iPhone installed to the Home Screen.
8. Sign a second account in on the same browser; confirm the `push_subscriptions`
   row moved and the first account stops receiving.
9. Deliberately break it: set `PUSH_TRIGGER_SECRET` wrong, raise a work order,
   confirm `pushed_at` stays null and is still unstamped after two minutes; fix
   the secret and confirm the sweep delivers it late rather than never.
10. Run the Supabase security advisor. This adds three functions and one table.

**Step 4 is the one that cannot be skipped or approximated.** Everything in this
feature works identically with the app merely backgrounded, which is the case that
already worked before it. Until a notification arrives at a browser that is
genuinely not running, nothing here is proven — the same distinction `GO_LIVE.md`
draws between recovery email being *configured* and being *delivered*.

---

## 8. What this does not cover

- **No per-account quiet hours and no mute.** Every notification is pushed to
  every device of every recipient, all night. Combined with 0038's fan-out, a
  Manager should expect roughly two pushes per work order. This is the accepted
  cost of the simple rule; the place to fix it is the fan-out.
- **No retention.** `notifications` still grows unbounded, and
  `push_subscriptions` only shrinks when a push service reports a device gone.
- **No admin view of who has alerts on.** Chasing the people who took the `denied`
  escape is not possible from inside the app.
- **A subscription outlives a deactivated account by up to an hour**, the same
  token latency every other access change here has. The row is removed by the
  cascade when an account is deleted, but a deactivated-not-deleted account keeps
  receiving until something removes the row.
