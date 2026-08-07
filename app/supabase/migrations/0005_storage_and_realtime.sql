-- ============================================================================
-- SI — Service Inside · 0005 Storage bucket + Realtime publication
-- ============================================================================
-- Replaces Firebase Storage (storage.rules) and the onSnapshot listeners.
--
-- STORAGE — the bucket is PRIVATE, which is a deliberate change from Firebase.
-- getDownloadURL() returned a long-lived tokenised URL: anyone holding the link
-- could read the file forever, signed in or not, and that URL was then stored
-- in attachments.file_url where it outlived any access change. Here the object
-- key is stored instead (attachments.storage_path) and the client mints a
-- short-lived signed URL on read. Nothing durable in the database grants
-- access to a file any more.
--
-- REALTIME — Supabase Realtime respects RLS on postgres_changes, so a
-- technician subscribed to work_orders still only receives rows the SELECT
-- policy would have returned. That is the same guarantee onSnapshot had.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  52428800,  -- 50 MB; videos from a phone camera clear this comfortably
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'video/mp4','video/quicktime','video/webm',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Mirrors the attachments table policies in 0002: any signed-in user may read,
-- any signed-in user may upload, only Manager/Admin may delete, nobody updates.
create policy attachments_object_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments');

create policy attachments_object_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments');

create policy attachments_object_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and si_is_manager_or_admin());

-- ---------------------------------------------------------------------------
-- REALTIME — one entry per onSnapshot listener in src/lib/.
--   work_orders        -> listenWorkOrder, listenWorkOrderList
--   work_order_history -> listenWorkOrderHistory
--   comments           -> listenComments
--   attachments        -> listenAttachments
--   notifications      -> listenNotifications
--   stats              -> listenDashboardCards, listenDashboardCharts
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table work_orders;
alter publication supabase_realtime add table work_order_history;
alter publication supabase_realtime add table comments;
alter publication supabase_realtime add table attachments;
alter publication supabase_realtime add table notifications;
alter publication supabase_realtime add table stats;
