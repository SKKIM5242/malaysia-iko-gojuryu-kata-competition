-- Lets Admin/Organizer attach a photo/scan of the actual bank transfer
-- receipt to a commission or winner payout, right next to the Paid button
-- on /admin/commissions -- so "Paid" isn't just a checkbox with no proof
-- behind it.
alter table commission_payouts add column if not exists receipt_path text;
alter table winner_payouts add column if not exists receipt_path text;

-- Private storage bucket, same shape as the existing "certificates" bucket
-- (0006_address_certificate.sql): uploads happen from the admin panel by an
-- already-authenticated staff member, real authorization is enforced in the
-- server action (requireCompetitionManager), and reads go through
-- short-lived signed URLs generated server-side -- RLS here just needs to
-- not be the blocker.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payout-receipts', 'payout-receipts', false, 10485760,
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "payout_receipts_insert_auth" on storage.objects;
create policy "payout_receipts_insert_auth" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payout-receipts');

drop policy if exists "payout_receipts_read_auth" on storage.objects;
create policy "payout_receipts_read_auth" on storage.objects
  for select to authenticated
  using (bucket_id = 'payout-receipts');
