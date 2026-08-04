-- Records WHICH Telegram group a staff message was posted to, so the
-- message history on an issue report says "sent to Participants" rather
-- than just "sent to a group". Nullable because DM and email messages have
-- no group, and because rows written before this column existed have none.
alter table issue_report_messages
  add column if not exists target_label text;
