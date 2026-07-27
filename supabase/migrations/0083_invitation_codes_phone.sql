-- Optional phone number on an invitation code, alongside its existing
-- required email -- captured on the Invitation Code creation form so the
-- organizer has a way to reach the invitee directly (Telegram DM itself
-- still requires that person to have already started a chat with the
-- bot -- the Bot API can't message an arbitrary phone number -- but this
-- gives the organizer a contact point to share the Telegram invite link
-- with, or reach them another way).
alter table invitation_codes add column if not exists phone text;
