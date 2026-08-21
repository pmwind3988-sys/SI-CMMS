# SI — Data & Storage: limits, checks, cleanup, backups

What this system can hold, how to see how full it is, and what to do about it. Everything
below is Supabase-side; nothing here is configurable from inside the app.

---

## 1. The limits

Two separate quotas, counted separately, with separate consequences. **Database** is the
Postgres data. **Storage** is the `attachments` bucket — photos and PDFs, which never
touch Postgres beyond a row holding their object key. (Videos uploaded before migration
0036 are still in there; the bucket no longer accepts new ones.)

| | Free | Pro |
|---|---|---|
| Database size | **500 MB** | 8 GB disk included, then $0.125/GB |
| File storage | **1 GB** | 100 GB included, then $0.0213/GB |
| Egress / month | **5 GB** | 250 GB, then $0.09/GB |
| Per-file upload | 50 MB (and this app's bucket caps at 50 MB — migration 0005) | 500 MB |
| Daily backups | **none** | 7 days |
| Point-in-time recovery | not available | +$100/mo per 7 days |
| Idle project | **paused after 1 week of inactivity** | never paused |
| Monthly active users | 50,000 | 100,000 |

Three of those rows matter more than the size numbers people worry about:

- **Free has no backups at all.** If the project is on Free, the only copy of this data is
  the one you take yourself (§4). This is the single most important line on the page.
- **Free projects pause after a week idle.** A plant that does not raise a work order over
  a shutdown week comes back to a dead app until someone un-pauses it in the dashboard.
- **Egress is per month and is what this app spends fastest.** See §2.

### What happens when it fills

Exceeding **500 MB of database size** puts the project into **read-only mode**: every
`insert` and `update` fails, so the app still signs people in and still shows history, and
every raise, assign and status change errors. Recovery is upgrade, or delete data *and*
reclaim the space (§3 — deleting rows alone does not shrink the database).

Exceeding **file storage** fails new uploads only; the rest of the app is unaffected.

Exceeding **egress** does not break Free projects mid-month — Supabase bills or throttles
rather than hard-stopping — but it is the quota this app is most likely to blow through.

---

## 2. What actually grows here, in order

**Attachments dominate, by two orders of magnitude**, though far less than they used to.
A phone photo off a plant Android is 2–5 MB *as taken*; since migration 0036 it is
resized to a 1920px long edge and re-encoded in the browser before it is uploaded
(`lib/compressImage.js`), which measured **92.9% smaller** on a 4032×3024 photo — so what
lands in the bucket is a few hundred KB, not a few MB. New video is refused outright.

The old arithmetic was: three photos on a work order is ~10 MB against a 1 GB Free quota,
so **Free ran out of file storage at roughly 100 work orders**. At ~400 KB a photo that
becomes closer to 800. The same 100 work orders still use well under 3 MB of *database*,
so if storage is filling and you are looking at table sizes, you are looking in the wrong
place — but it now takes a great deal longer to fill.

**Egress is next, and it is amplified by design.** `attachments.file_url` holds an object
key and `listenAttachments()` mints a one-hour signed URL on every read (CLAUDE.md,
"Attachments"), so viewing a work order re-downloads its photos rather than serving them
from a durable cached URL. At 12 MB of photos per view, 5 GB of Free egress is ~400 work
order views per month across all users. Separately, `liveQuery` re-runs its whole query on
every relevant `postgres_changes` event instead of patching a local cache — correct for RLS,
and it means a busy work order costs one full re-fetch per change, per subscriber.

Within Postgres, ranked by how fast they grow:

| Table | Rows per work order | Bounded? |
|---|---|---|
| `notifications` | ~20–40 (one per recipient per event; supervisors and managers fan out) | **No.** Nothing deletes them — see below |
| `work_order_history` | ~11, one per transition | Cascades when the work order is deleted |
| `comments` | variable | Deleted with the work order (0018 trigger) |
| `work_orders` | 1, but a wide row with many indexes | — |
| `work_order_deletions` | 1 per *deleted* work order, holding a snapshot of it | **No.** Nothing prunes the archive |
| `cron.job_run_details` | n/a — ~670 rows/day from the three pg_cron jobs | **Check it.** See §3 |
| `stats` | fixed at 2 rows | Yes |
| `apk_builds` | 1 per recorded build | Trivial |

All-in, including index overhead, budget **~20 KB of database per work order**. Against
Free's 500 MB less ~60 MB of baseline extensions and system schemas, that is on the order of
**20,000 work orders** before read-only — years, for most plants. Pro's 8 GB is ~400,000.

**The unbounded ones are the ones to watch, not the biggest ones.** `notifications` has no
retention policy and, deliberately, no client can clear it: `notifications_delete` is
`using (si_is_admin())`, and the update guard permits changing nothing but `status` to
`'read'`. "Mark all read" flips a status; it does not remove a row. So the table grows for
the life of the project regardless of what users do in the UI.

> There is no cron job pruning any of this. If you want one, say so — it is a small
> migration alongside the existing sweeps in 0004. It is not in the repo because a scheduled
> `delete` is a data-loss policy, and that is a decision to make on purpose.

---

## 3. Checking, and clearing

### Check — dashboard

- **Database size** — Reports → Database, or Settings → Usage.
- **Storage** — Storage → the `attachments` bucket footer, and Settings → Usage.
- **Egress** — Settings → Usage. Watch this one monthly on Free.

### Check — SQL (SQL Editor)

Database total, which is the number the 500 MB limit is measured against:

```sql
select pg_size_pretty(pg_database_size(current_database())) as database_size;
```

Biggest tables, data vs indexes, so you can see whether the fix is fewer rows or fewer
indexes:

```sql
select relname as table_name,
       pg_size_pretty(pg_total_relation_size(c.oid))                                as total,
       pg_size_pretty(pg_relation_size(c.oid))                                      as heap,
       pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid))      as indexes_toast,
       n_live_tup as live_rows,
       n_dead_tup as dead_rows
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_user_tables s on s.relid = c.oid
 where n.nspname = 'public' and c.relkind = 'r'
 order by pg_total_relation_size(c.oid) desc;
```

Storage footprint, per bucket and per uploader, straight out of the storage catalog:

```sql
select bucket_id,
       count(*)                                                     as objects,
       pg_size_pretty(sum((metadata->>'size')::bigint))             as bytes
  from storage.objects
 group by bucket_id;

-- The 20 largest objects: usually where a surprise 1 GB actually went.
select name,
       pg_size_pretty((metadata->>'size')::bigint) as size,
       created_at
  from storage.objects
 where bucket_id = 'attachments'
 order by (metadata->>'size')::bigint desc
 limit 20;
```

pg_cron's own log, which is outside `public` and therefore invisible to the query above:

```sql
select count(*), pg_size_pretty(pg_total_relation_size('cron.job_run_details'))
  from cron.job_run_details;
```

Three jobs run here — two SLA sweeps every 5 minutes and the dashboard aggregate every 15
(migration 0004) — so this accrues ~670 rows a day whether or not anything happened. Check
it before assuming an application table is at fault.

### Clear

Everything below is destructive and none of it is reversible without a backup from §4.
**Take the backup first.** Run these in the SQL Editor, which connects as `postgres` and so
is not bound by the RLS that stops the app from doing any of it.

Notifications older than 90 days, read or not — the highest-value cleanup, and the safest,
since a notification is a delivery record and not the audit trail:

```sql
delete from notifications where created_at < now() - interval '90 days';
```

Read notifications older than 30 days, if you would rather keep unread ones indefinitely:

```sql
delete from notifications where status = 'read' and created_at < now() - interval '30 days';
```

pg_cron run log, keeping a week:

```sql
delete from cron.job_run_details where end_time < now() - interval '7 days';
```

Deletion archive, if you no longer need snapshots of work orders someone removed:

```sql
delete from work_order_deletions where deleted_at < now() - interval '1 year';
```

**Do not hand-delete `work_orders` rows to save space.** Use the app's delete
(Admin/Superuser — migration 0018): it fires `si_archive_deleted_work_order`, which snapshots
the row and clears the comments, attachments and notifications that reference it
polymorphically, and `deleteWorkOrder()` removes the storage objects client-side first. A raw
SQL `delete` cascades history but leaves the bucket objects orphaned — costing you the
storage you were trying to reclaim, with no row left pointing at them.

Old attachments, oldest-first, when the bucket is what is full:

```sql
-- Identify first. Copy the `name` values out before deleting anything.
select o.name, pg_size_pretty((o.metadata->>'size')::bigint) as size, o.created_at
  from storage.objects o
 where o.bucket_id = 'attachments' and o.created_at < now() - interval '2 years'
 order by o.created_at;
```

Then remove the objects with the CLI (a `delete` on `storage.objects` alone can leave the
bytes behind), and delete the matching `attachments` rows so the app stops offering a link
to something that is gone:

```bash
npx supabase storage rm ss:///attachments/<object-key> --linked
```

### Reclaiming the space you just freed

**A `delete` does not shrink the database.** Postgres marks the rows dead and reuses the
space for future inserts; the size the 500 MB limit measures stays where it was. Autovacuum
keeps it reusable, not smaller. To actually give the space back:

```sql
vacuum full analyze notifications;
```

`vacuum full` takes an exclusive lock on the table and rewrites it — nothing can read or
write it until it finishes, and it needs free space equal to the table's live size while it
runs. Do it in a quiet window, one table at a time, biggest first. And note the asymmetry:
on Pro the *disk* that was provisioned for you does not scale back down afterwards, so
reclaiming database size stops the read-only threat but does not reduce the bill.

---

## 4. Backups and export

### If the project is on Free, this section is not optional

Free includes no backups of any kind. Take one on a schedule you can live with losing.

### Full logical backup (schema + data)

From `app/`, with the project linked (`npx supabase link --project-ref <ref>`):

```bash
npx supabase db dump --linked -f backup-schema.sql
```

```bash
npx supabase db dump --linked --data-only --use-copy -f backup-data.sql
```

Two files rather than one because they restore differently and expire differently: the schema
is already in `supabase/migrations/`, and the data is the part that is irreplaceable.
`--use-copy` matters at size — `COPY` restores an order of magnitude faster than a file of
`INSERT`s.

Roles, needed only for a restore into a brand-new project:

```bash
npx supabase db dump --linked --role-only -f backup-roles.sql
```

Note what a logical dump does **not** contain: `auth.users` is in a protected schema and is
not included, and neither is anything in the storage bucket. A restore from these files
gives you every work order with no accounts able to sign in and no photos attached. Which
is why the next two subsections exist.

### Storage bucket

```bash
npx supabase storage cp -r ss:///attachments ./backup-attachments --linked -j 4
```

This is the big one — plan for it to be most of your backup size and most of its runtime.
It also counts against egress.

### Restoring

```bash
psql "$DATABASE_URL" -f backup-data.sql
```

Restore into a project that already has the migrations applied (`npm run db:push`), then
`npm run bootstrap:users` to recreate the six role accounts, then re-check
**Authentication → Hooks → Customize Access Token** is enabled — a restored project with the
hook off signs people into an empty app, because `user_role` is missing from every token and
every policy denies (CLAUDE.md, "The role claim").

Upload the bucket back with the same `cp` reversed:

```bash
npx supabase storage cp -r ./backup-attachments ss:///attachments --linked -j 4
```

### Export for someone who wants a spreadsheet, not a restore

The SQL Editor's result grid has **Download CSV**, which is the whole mechanism for ad-hoc
exports. A denormalised work order sheet that reads without the reference tables:

```sql
select w.wo_number, w.title, w.description, w.status, w.priority, w.wo_type,
       d.name as department, a.name as asset,
       w.requester_name, w.assigned_to_name,
       w.created_at, w.sla_resolution_due_at, w.sla_breached,
       w.resolved_at, w.verified_at, w.closed_at
  from work_orders w
  left join departments d on d.id = w.department_id
  left join assets a      on a.id = w.asset_id
 order by w.created_at desc;
```

The audit trail, which is what an auditor actually asks for:

```sql
select w.wo_number, h.from_status, h.to_status,
       h.actor_name, h.actor_role, h.note, h.created_at
  from work_order_history h
  join work_orders w on w.id = h.work_order_id
 order by w.wo_number, h.created_at;
```

### Pro-plan backups

Pro adds 7 days of automated daily backups, restorable from **Database → Backups**. They are
whole-project restores to a point in the past — they do not extract one table and they do not
merge. For "someone deleted a work order this morning", the archive in
`work_order_deletions` is the better answer and it already holds the row.

---

## 5. The notification gap this pairs with

`src/lib/osNotifications.js` delivers status-bar and desktop notifications with sound while
the app's Realtime websocket is alive — foreground or backgrounded. It cannot deliver
anything once the app is swiped away or the browser is closed, because a notification with
no process running has to be pushed *to* the device, and pushing requires a sender holding
credentials. `output: "export"` means this app has no server of its own anywhere.

Closing that gap is roughly:

1. A Firebase project, `google-services.json` in `android/app/`, and
   `@capacitor/push-notifications` replacing the local-notification path on native.
2. A `device_tokens` table (user, token, platform, last_seen) with RLS letting a user write
   only their own rows, plus registration on sign-in and cleanup on sign-out.
3. An Edge Function alongside `admin-users` holding the FCM service account, called by a
   database webhook on `insert into notifications`, which looks up the recipient's tokens and
   posts to FCM v1. Web Push needs the same function plus a VAPID key pair and a service
   worker in the export.

Two of those three steps need console access and secrets that only you can create, which is
why they are written down here rather than half-built in the repo.
