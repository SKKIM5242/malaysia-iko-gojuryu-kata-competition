-- Certificate system: a singleton settings row holding the org-wide
-- branding assets every generated certificate uses (logo is already a
-- static file; signature + stamp/seal are the two assets that must be
-- admin-uploaded), plus a small public storage bucket to hold them.
-- Certificates themselves are rendered on demand (next/og), never stored --
-- same "computed live, nothing cached" philosophy as winners/rewards/
-- commissions in this app.

create table if not exists certificate_settings (
  id boolean primary key default true check (id),
  signer_name text,
  signer_title text,
  signature_path text,
  stamp_path text,
  updated_at timestamptz not null default now()
);
insert into certificate_settings (id) values (true) on conflict do nothing;
alter table certificate_settings enable row level security;

-- Same admin/organizer/staff set as requireCompetitionManager() in
-- app/actions/admin.ts -- narrower than is_staff_any() (which also allows
-- customer_support/referee), since only the same roles that manage
-- competitions should be able to change what appears on every certificate.
create or replace function public.is_competition_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid()
      and role in ('admin','organizer','staff')
      and approved
  );
$$;

drop policy if exists "certificate_settings_select" on certificate_settings;
create policy "certificate_settings_select" on certificate_settings
  for select to authenticated, anon using (true);

drop policy if exists "certificate_settings_write" on certificate_settings;
create policy "certificate_settings_write" on certificate_settings
  for all to authenticated
  using (public.is_competition_manager())
  with check (public.is_competition_manager());

-- Small public bucket for signature/stamp images -- branding assets, not
-- personal documents, so public read is simplest and avoids signed-URL
-- churn on every certificate render.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read" on storage.objects
  for select to public using (bucket_id = 'branding');

drop policy if exists "branding_staff_write" on storage.objects;
create policy "branding_staff_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'branding' and public.is_competition_manager())
  with check (bucket_id = 'branding' and public.is_competition_manager());
