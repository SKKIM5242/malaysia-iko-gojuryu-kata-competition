-- Outbound feedback that Admin / Organizer / Participant Support send to a
-- participant, over Telegram DM or email, plus a permanent record of what
-- was actually sent.
--
-- Deliberately stores the message CONTENT and the resolved destination
-- (email address / telegram chat id) as they were at send time, rather than
-- only pointing at the participant row: the whole purpose is an audit trail
-- of "what did we tell this person, and where did it actually go", and a
-- participant later changing their email must not silently rewrite history.
--
-- Failures are recorded too (status = 'failed' with the reason), because
-- "we tried to tell them and it bounced" is exactly the case an organizer
-- needs to see — a table that only logs successes would quietly hide it.

create table if not exists participant_messages (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id) on delete set null,
  recipient_user_id uuid,
  recipient_name text,
  recipient_email text,
  recipient_telegram_chat_id text,
  channel text not null check (channel in ('email', 'telegram')),
  subject text,
  body text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  sent_by uuid,
  sent_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists participant_messages_participant_idx
  on participant_messages (participant_id, created_at desc);

alter table participant_messages enable row level security;

-- Staff-only, both directions. Participants never read this table from the
-- client: they receive the message itself in their inbox or in Telegram.
drop policy if exists "participant_messages_staff_select" on participant_messages;
create policy "participant_messages_staff_select" on participant_messages
  for select
  using (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and p.role in ('admin', 'organizer', 'staff', 'customer_support')
    )
  );

drop policy if exists "participant_messages_staff_insert" on participant_messages;
create policy "participant_messages_staff_insert" on participant_messages
  for insert
  with check (
    exists (
      select 1 from profiles p
      where p.user_id = auth.uid()
        and p.role in ('admin', 'organizer', 'staff', 'customer_support')
    )
  );
