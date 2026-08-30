-- ===========================================================================
-- SI — Service Inside · migration 0043
-- The person who uploaded a photo may replace it.
--
-- Attachments have been immutable since 0002, deliberately: no UPDATE policy at
-- all, and both the row delete and the storage-object delete are
-- si_is_manager_or_admin(). That is right for a record and wrong for the moment
-- it is being made — a technician photographs a fault on a phone, in a plant,
-- and the picture is dark, or framed on the wrong side of the machine, or of
-- the wrong machine. Today the only repair is to upload a second photo and
-- leave the bad one sitting beside it forever, because nobody below Manager can
-- remove anything.
--
-- WHAT THIS ADDS, and what it deliberately does not:
--
--   * The UPLOADER replaces their own photo. Not "a technician": whoever put
--     the file there, which includes a Requester fixing a blurry photo on a
--     fault they raised. There is no admin bypass — Managers and Administrators
--     keep the delete they have always had, and do not gain the power to swap
--     somebody else's photo for one of their own choosing. That is a different
--     operation with a different meaning, and this schema's habit is to name
--     the operation rather than widen an existing one (0031 on retire vs
--     delete).
--
--   * Only while the work order is still live. Once it is `verified` or
--     `closed` the photos are part of a finished record and freeze.
--
--   * Photos only. Documents are not replaced, and the legacy `video` rows
--     (upload-removed in 0036) are not either — there is no path to create a
--     new one, so a "replacement" could only ever downgrade them.
--
-- NO UPDATE POLICY IS ADDED TO `attachments`. The table stays immutable to
-- anything talking to PostgREST directly; this SECURITY DEFINER function is the
-- only door, the same shape 0037 used for decline. RLS does not apply inside
-- it, so work_orders_select is restated in the body — a copy of the policy,
-- not a summary of it. If that predicate changes this changes with it, exactly
-- as the three enforcement points on `users` do.
--
-- THE OLD FILE IS DESTROYED, which is the point ("replace" and "keep both" are
-- the two things that were possible before, and the second one already works).
-- Storage objects live outside Postgres, so the actual removal is a client
-- call, best-effort, the way deleteWorkOrder() already removes a work order's
-- files. That means the storage DELETE policy has to widen — and it widens by
-- DATA rather than by trust:
--
--     you may delete your own object only once no attachment row names it.
--
-- So the sequence is repoint-then-remove: this function moves the row onto the
-- new key, which orphans the old one, and only then can the browser delete it.
-- A technician cannot delete a file that is still part of a live record, and
-- cannot orphan a row by deleting the file out from under it. Both halves are
-- properties of the policy, not of the client obeying an order.
--
-- LOGGING is three things, because a replacement destroys evidence and one
-- record of it is not enough:
--
--   * attachment_replacements — the full before/after, written in the same
--     transaction as the swap.
--   * attachments.replaced_at / replace_count — enough for the panel to mark a
--     photo as replaced without a second query.
--   * one work_order_history row, so it appears on the timeline the rest of the
--     work order's life is read from.
--
-- THAT HISTORY ROW IS THE FIRST THAT IS NOT A TRANSITION, and saying so takes a
-- column. The tempting encoding is from_status = to_status — "something
-- happened, the status did not change" — and it is WRONG on this schema:
-- ('assigned','assigned', …, 'Reassign (pre-acceptance)') is row 3 of the
-- matrix in 0003, so every reassignment already looks like that. A reader using
-- it would have silently reclassified real reassignments as photo swaps.
--
-- So `work_order_history.event_type` says it outright, defaulting to
-- 'transition' — which is what every row ever written is, and what any row that
-- omits the column will be. Two client readers then learn one rule:
-- StatusTimeline matches a rung on to_status alone and would have rendered this
-- as a status the work order had reached, and indexHistory() in the export
-- counts to_status = 'assigned' as a reassignment — so replacing a photo while
-- assigned would have inflated the reassignment count in the exported workbook.
-- Neither would have raised anything; both would just have been wrong.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1  The audit table.
--
-- Two foreign-key decisions, both deliberate:
--
--   * work_order_id CASCADEs. Deleting a work order is already archived whole
--     into work_order_deletions (0018) and takes its attachments, comments and
--     notifications with it; leaving replacement rows behind would be debris
--     pointing at a record that no longer exists.
--
--   * attachment_id carries NO foreign key. A Manager deleting the photo must
--     not destroy the record that it was once replaced — "this file was swapped
--     out" is a fact about what happened, and it outlives the row it happened
--     to. Same reasoning that keeps actor_name on work_order_history when the
--     account behind it is gone.
--
-- Readable by any signed-in user, mirroring attachments_select. No INSERT,
-- UPDATE or DELETE policy exists, so the only writer is the definer function
-- below — the table cannot be forged or tidied from a browser.
-- ---------------------------------------------------------------------------
create table if not exists attachment_replacements (
  id                  uuid primary key default gen_random_uuid(),
  attachment_id       uuid not null,
  work_order_id       uuid not null references work_orders(id) on delete cascade,
  old_storage_path    text not null,
  old_file_size_bytes bigint,
  old_uploaded_at     timestamptz,
  old_wo_status       si_wo_status,
  new_storage_path    text not null,
  new_file_size_bytes bigint,
  replaced_by_id      uuid not null references users(id),
  replaced_by_name    text,
  replaced_by_role    si_role,
  replaced_at         timestamptz not null default now()
);

comment on table attachment_replacements is
  'One row per photo replaced through si_replace_attachment: what was there '
  'before, what took its place, and who swapped it. The old file itself is '
  'destroyed, so this is the only record that it ever existed (0043).';
comment on column attachment_replacements.attachment_id is
  'Deliberately not a foreign key: deleting the photo must not delete the '
  'record that it was once replaced.';

create index if not exists attachment_replacements_attachment_idx
  on attachment_replacements (attachment_id);
create index if not exists attachment_replacements_wo_idx
  on attachment_replacements (work_order_id, replaced_at desc);

alter table attachment_replacements enable row level security;

drop policy if exists attachment_replacements_select on attachment_replacements;
create policy attachment_replacements_select on attachment_replacements
  for select to authenticated using (si_signed_in());


-- ---------------------------------------------------------------------------
-- 2  Two columns on attachments, so the panel can mark a replaced photo
--    without joining the audit table on every read.
--
-- No replaced_by_name here, though the audit table records one. Only the
-- uploader may replace, so on the attachment row it would always equal
-- uploaded_by_name — a column that can only ever hold a copy of its neighbour.
-- The audit table keeps it because that row is read on its own.
-- ---------------------------------------------------------------------------
alter table attachments
  add column if not exists replaced_at   timestamptz,
  add column if not exists replace_count integer not null default 0;

comment on column attachments.replaced_at is
  'When the file behind this row was last swapped for another, or null if it '
  'is still the file originally uploaded (migration 0043).';
comment on column attachments.replace_count is
  'How many times this photo has been replaced. Non-zero is what the work '
  'order screen marks; the detail is in attachment_replacements.';


-- ---------------------------------------------------------------------------
-- 2b  work_order_history stops being only a status trail.
--
-- Defaulted rather than nullable, and defaulted to the thing every existing row
-- is: a backfill would have to guess, and here there is nothing to guess. A row
-- inserted by anything that does not know about this column — including
-- si_transition_work_order, which is left untouched — is a transition, which is
-- the fail-safe direction for a display rule.
--
-- Not an enum. si_wo_status and si_role are enums because policies and the
-- transition matrix compare against them; nothing compares against this, it is
-- read by two client functions to decide how to draw a row, and 0035 is a
-- standing reminder that adding a value to an enum here costs two migrations.
-- ---------------------------------------------------------------------------
alter table work_order_history
  add column if not exists event_type text not null default 'transition';

comment on column work_order_history.event_type is
  '''transition'' for a status change — every row before migration 0043 — or a '
  'name for something else worth recording against the work order, currently '
  'only ''photo_replaced''. Readers that walk the status flow must skip '
  'anything that is not a transition: from_status = to_status does NOT '
  'identify these, because reassignment is assigned -> assigned.';


-- ---------------------------------------------------------------------------
-- 3  The swap itself. One transaction: audit row, repointed attachment,
--    history row.
--
-- The new object is checked to be under this work order's own prefix AND owned
-- by the caller, because without that pair the argument is a way to point your
-- own attachment row at somebody else's file — the row would then mint signed
-- URLs for it on every read. `owner` and `owner_id` are both tested: storage
-- deprecated the uuid column in favour of the text one and populates them
-- differently across versions, so testing only one is a check that silently
-- stops holding after an upgrade.
--
-- uploaded_at and wo_status are RE-STAMPED. The photo on screen is the new one,
-- taken now, and attachments.wo_status means "the phase of the job this photo
-- documents" (0039) — leaving it on the old value would file a picture of a
-- finished repair under "Before work". What the old one said is not lost; it is
-- in the audit row, which is why that table holds old_wo_status and
-- old_uploaded_at rather than just the path.
-- ---------------------------------------------------------------------------
create or replace function si_replace_attachment(
  p_attachment_id uuid,
  p_new_path      text,
  p_new_size      bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  a            attachments%rowtype;
  w            work_orders%rowtype;
  v_old_path   text;
  v_actor_name text;
  v_actor_role si_role;
  v_label      text;
begin
  select * into a from attachments where id = p_attachment_id;
  if not found then
    raise exception 'That photo no longer exists.' using errcode = 'no_data_found';
  end if;

  -- No admin bypass, on purpose. See this file's header.
  if a.uploaded_by_id is distinct from auth.uid() then
    raise exception 'Only the person who uploaded a photo can replace it.'
      using errcode = 'insufficient_privilege';
  end if;

  if a.file_type <> 'photo' or a.entity_type <> 'work_order' then
    raise exception 'Only a photo on a work order can be replaced.'
      using errcode = 'feature_not_supported';
  end if;

  select * into w from work_orders where id = a.entity_id;
  if not found then
    raise exception 'Work order not found.' using errcode = 'no_data_found';
  end if;

  -- work_orders_select, restated. RLS does not apply to the writes below, so
  -- without this the function would reach any work order in the plant.
  if not (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or (si_is_technician() and w.assigned_to_id = auth.uid())
    or (si_is_requester()  and w.requester_id  = auth.uid())
  ) then
    raise exception 'You do not have permission to change this work order.'
      using errcode = 'insufficient_privilege';
  end if;

  if w.status in ('verified', 'closed') then
    raise exception 'This work order is closed. Its photos are part of the finished record and can no longer be replaced.'
      using errcode = 'insufficient_privilege';
  end if;

  v_old_path := coalesce(a.storage_path, a.file_url);

  if p_new_path is null or p_new_path not like 'work_orders/' || w.id::text || '/%' then
    raise exception 'The replacement file is not stored against this work order.'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_new_path = v_old_path then
    raise exception 'The replacement is the file that is already there.'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'attachments'
       and o.name = p_new_path
       and (o.owner = auth.uid() or o.owner_id = auth.uid()::text)
  ) then
    raise exception 'The replacement file was not uploaded by you.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The highest role held, matching si_stamp_attachment and
  -- si_transition_work_order: the column is singular because it records a role
  -- in a moment, and a moment has one.
  select u.name,
         (select r
            from unnest(u.roles) r
           order by si_role_rank(r::text) desc
           limit 1)
    into v_actor_name, v_actor_role
    from users u
   where u.id = auth.uid();

  insert into attachment_replacements (
    attachment_id, work_order_id,
    old_storage_path, old_file_size_bytes, old_uploaded_at, old_wo_status,
    new_storage_path, new_file_size_bytes,
    replaced_by_id, replaced_by_name, replaced_by_role
  ) values (
    a.id, w.id,
    v_old_path, a.file_size_bytes, a.uploaded_at, a.wo_status,
    p_new_path, p_new_size,
    auth.uid(), v_actor_name, v_actor_role
  );

  update attachments
     set file_url        = p_new_path,
         storage_path    = p_new_path,
         file_size_bytes = p_new_size,
         uploaded_at     = now(),
         wo_status       = w.status,
         replaced_at     = now(),
         replace_count   = coalesce(replace_count, 0) + 1
   where id = a.id;

  -- Filenames the uploader would recognise: object key minus the folder and
  -- minus the epoch prefix addAttachment() puts on it. The same two steps
  -- fileLabel() takes in AttachmentsPanel. Both names, because the remark is
  -- also the Remarks cell in the exported Status History sheet, where it has to
  -- stand on its own without the row beside it.
  v_label := regexp_replace(regexp_replace(v_old_path,  '^.*/', ''), '^\d{10,}-', '')
          || ' with '
          || regexp_replace(regexp_replace(p_new_path, '^.*/', ''), '^\d{10,}-', '');

  -- Not a transition, and event_type is the only thing that says so — the
  -- statuses are both the current one because nothing moved. See the header for
  -- why from_status = to_status cannot carry that meaning here.
  insert into work_order_history
    (work_order_id, from_status, to_status, event_type,
     actor_id, actor_name, actor_role, remarks)
  values
    (w.id, w.status, w.status, 'photo_replaced',
     auth.uid(), v_actor_name, v_actor_role,
     'Replaced ' || v_label || '. The original file was deleted.');
end
$fn$;

revoke all on function si_replace_attachment(uuid, text, bigint) from public, anon;
grant execute on function si_replace_attachment(uuid, text, bigint) to authenticated;

comment on function si_replace_attachment(uuid, text, bigint) is
  'Swap the file behind one photo for another the same person just uploaded, destroying the old one. SECURITY DEFINER because attachments carry no UPDATE policy and are meant not to; the uploader check, the closed-work-order check and work_orders_select are all restated in the body. Writes an attachment_replacements row and a same-status work_order_history row in the same transaction (migration 0043).';


-- ---------------------------------------------------------------------------
-- 4  The storage object may now be deleted by the person who uploaded it —
--    but only once nothing references it.
--
-- The `not exists` is what makes this safe to widen. It is evaluated with the
-- CALLER's privileges, which is the trap 0029 documents: a subquery over a
-- table the caller cannot see finds nothing, `not exists` is true, and the
-- policy fails OPEN. It does not apply here, because attachments_select is
-- `si_signed_in()` — every signed-in user sees every attachment row, so the
-- reference is always found when it exists. Worth stating rather than leaving
-- to be re-derived: if attachments_select is ever narrowed, this policy needs a
-- SECURITY DEFINER helper the way 0029's si_is_test_account() does.
--
-- file_url is tested alongside storage_path because file_url held the object
-- key before storage_path existed (0005), and rows from then still carry it
-- there with storage_path null.
-- ---------------------------------------------------------------------------
drop policy if exists attachments_object_delete on storage.objects;
create policy attachments_object_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      si_is_manager_or_admin()
      or (
        (owner = auth.uid() or owner_id = auth.uid()::text)
        and not exists (
          select 1
            from public.attachments a
           where a.storage_path = storage.objects.name
              or a.file_url     = storage.objects.name
        )
      )
    )
  );
