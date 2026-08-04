-- Participant-reported technical issues ("Report any inconsistency in
-- viewing the page, site, app, recording window..."), raised from the
-- signed-in account page and worked through by staff in
-- /admin/issue-reports.
--
-- Screenshots live in their own private bucket rather than as bytes here:
-- a report can carry up to 20 images, which is far too much to sit in a
-- row that gets listed in a table.
create table if not exists issue_reports (
  id uuid primary key default gen_random_uuid(),
  -- Who reported it. Kept as a set_null reference plus a denormalised
  -- email/name copy so a resolved report stays readable in the admin table
  -- even if the account is later removed.
  reporter_user_id uuid references auth.users(id) on delete set null,
  reporter_email text,
  reporter_name text,

  -- The reporter-filled fields. Every one of these is required by the form
  -- (see components/IssueReportForm.tsx); they are nullable here only so a
  -- future admin-side edit can blank one without fighting the schema.
  subject text not null,
  page text not null,
  section text not null,
  what_wrong text not null,
  view_type text not null check (view_type in ('portrait', 'landscape', 'both')),
  device_name text not null,
  -- The picked dropdown value, or 'other' when the reporter's device isn't
  -- listed -- in which case screen_spec_other carries what they typed.
  screen_spec text not null,
  screen_spec_other text,
  expected_result text not null,

  -- Storage paths inside the issue-screenshots bucket, in upload order.
  screenshot_paths text[] not null default '{}',

  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'cannot_fix')),
  -- Staff's running notes on the report itself, distinct from the messages
  -- actually sent to the reporter (those are rows in the table below).
  staff_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists issue_reports_reporter_idx on issue_reports(reporter_user_id);
create index if not exists issue_reports_status_created_idx on issue_reports(status, created_at desc);

-- Every message staff compose against a report, on any channel. Saved
-- whether or not the send succeeded (ok/error), so a failed Telegram DM
-- leaves a visible trail instead of vanishing.
create table if not exists issue_report_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references issue_reports(id) on delete cascade,
  channel text not null check (channel in ('telegram_dm', 'telegram_group', 'email')),
  subject text,
  body text not null,
  sent_by uuid references auth.users(id) on delete set null,
  sent_by_name text,
  ok boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists issue_report_messages_report_idx
  on issue_report_messages(report_id, created_at desc);

alter table issue_reports enable row level security;
alter table issue_report_messages enable row level security;

-- Any signed-in user may file a report, but only as themselves.
drop policy if exists "issue_reports_insert_own" on issue_reports;
create policy "issue_reports_insert_own" on issue_reports
  for insert to authenticated
  with check (reporter_user_id = auth.uid());

-- Reporters can see their own reports (so the account page can show what
-- they've already sent); staff can see all of them.
drop policy if exists "issue_reports_select_own_or_staff" on issue_reports;
create policy "issue_reports_select_own_or_staff" on issue_reports
  for select to authenticated
  using (
    reporter_user_id = auth.uid()
    or exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and p.approved
        and p.role in ('admin', 'organizer', 'staff', 'customer_support')
    )
  );

-- Only staff triage them.
drop policy if exists "issue_reports_update_staff" on issue_reports;
create policy "issue_reports_update_staff" on issue_reports
  for update to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and p.approved
        and p.role in ('admin', 'organizer', 'staff', 'customer_support')
    )
  );

drop policy if exists "issue_report_messages_staff_all" on issue_report_messages;
create policy "issue_report_messages_staff_all" on issue_report_messages
  for all to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and p.approved
        and p.role in ('admin', 'organizer', 'staff', 'customer_support')
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and p.approved
        and p.role in ('admin', 'organizer', 'staff', 'customer_support')
    )
  );

-- The reporter can read the messages sent to them about their own report.
drop policy if exists "issue_report_messages_select_own" on issue_report_messages;
create policy "issue_report_messages_select_own" on issue_report_messages
  for select to authenticated
  using (
    exists (
      select 1 from issue_reports r
      where r.id = issue_report_messages.report_id
        and r.reporter_user_id = auth.uid()
    )
  );

-- ── Screenshot storage (private; server-signed URLs only, same shape as
-- the kata-videos bucket) ──────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-screenshots', 'issue-screenshots', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

drop policy if exists "issue_screenshots_upload_own_folder" on storage.objects;
create policy "issue_screenshots_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'issue-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "issue_screenshots_read_own_or_staff" on storage.objects;
create policy "issue_screenshots_read_own_or_staff" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'issue-screenshots'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from profiles p
        where p.user_id = auth.uid()
          and p.approved
          and p.role in ('admin', 'organizer', 'staff', 'customer_support')
      )
    )
  );
