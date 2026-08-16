-- Categorizes each technical issue report by the kind of problem it is,
-- matching the 3-way "or" in the report form's own heading ("Report any
-- inconsistency in viewing the page, site, app, recording window
-- (portrait/landscape), or a technical issue that needs fixing") -- lets
-- staff triage at a glance instead of reading the free-text fields first.
--
-- Defaulted to 'technical' purely to satisfy `not null` on rows filed before
-- this column existed (there's no way to infer their real category after
-- the fact); the form itself always requires an explicit pick going forward.
alter table issue_reports
  add column issue_type text not null default 'technical'
    check (issue_type in ('viewing', 'recording_window', 'technical'));

alter table issue_reports alter column issue_type drop default;
