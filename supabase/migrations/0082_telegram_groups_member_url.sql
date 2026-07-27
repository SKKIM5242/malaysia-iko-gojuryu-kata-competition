-- The `url` column is the public invite link (https://t.me/+...) -- the
-- only kind that lets someone who isn't a member yet actually join. A
-- separate `member_url` holds a direct link into the group's Announcements
-- topic (https://t.me/c/<chat_id>/<topic_id>) for people who are already
-- members -- that format only opens for existing members, so it can never
-- replace the invite link, only supplement it. Notification emails now
-- show both: "join here" (url) for new members and "already in the group?
-- jump to Announcements" (member_url) for existing ones.
alter table telegram_groups add column if not exists member_url text;

update telegram_groups
set member_url = url
where category in ('school','participant','referee','staff','audience') and member_url is null;

update telegram_groups set url = case category
  when 'school' then 'https://t.me/+JjPOjCHLOzNlMzRl'
  when 'participant' then 'https://t.me/+mfpuPeHf6gs5Y2Rl'
  when 'referee' then 'https://t.me/+WfAyMh5t9t02N2Rl'
  when 'staff' then 'https://t.me/+pCKynJO6wLJmZjhl'
  when 'audience' then 'https://t.me/+15XLZ1AK8nAwNWFl'
  else url
end
where category in ('school','participant','referee','staff','audience');
