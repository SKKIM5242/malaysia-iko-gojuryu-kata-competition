-- Participant Support reward scheme: per-resolved-ticket bounty. Questions
-- (usually copied from the Telegram topics, answered back in the same
-- group) are logged as tickets classified advance / intermediate /
-- general. The reward pool is 10% of total PAID participant registration
-- fees, shared among Participant Support by weighted resolved tickets
-- (advance 3 : intermediate 2 : general 1). Tickets from the supporter's
-- own school / own students don't count, and every complaint received is
-- -1 USD.
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  telegram_group text,
  category text not null default 'general' check (category in ('advance', 'intermediate', 'general')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  answered_by uuid references auth.users(id) on delete set null,
  answer text,
  own_school boolean not null default false,
  complaint boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table support_tickets enable row level security;

drop policy if exists "support_tickets_staff" on support_tickets;
create policy "support_tickets_staff" on support_tickets
  for all to authenticated using (public.is_staff_any()) with check (public.is_staff_any());
