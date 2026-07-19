-- Unslot / Forfeited / Give-up tracking for registrations, so Admin,
-- Organizer, and Referee/Judge accounts can flag and clean up participants
-- who miss the recording deadline, without granting them a general UPDATE
-- on the registrations table.

alter table registrations add column if not exists slot_status text not null default 'active'
  check (slot_status in ('active', 'unslotted', 'forfeited', 'given_up'));
alter table registrations add column if not exists slot_status_note text;
alter table registrations add column if not exists slot_status_changed_by uuid references auth.users(id) on delete set null;
alter table registrations add column if not exists slot_status_changed_at timestamptz;

create or replace function public.set_registration_slot_status(reg_id uuid, new_status text, note text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from profiles
    where user_id = auth.uid()
      and role in ('admin', 'organizer', 'staff', 'referee')
      and approved
  ) then
    raise exception 'not authorized';
  end if;
  if new_status not in ('active', 'unslotted', 'forfeited', 'given_up') then
    raise exception 'invalid status';
  end if;

  update registrations
  set slot_status = new_status,
      slot_status_note = note,
      slot_status_changed_by = auth.uid(),
      slot_status_changed_at = now(),
      payment_status = case when new_status = 'forfeited' then 'forfeited' else payment_status end
  where id = reg_id;
end;
$$;

grant execute on function public.set_registration_slot_status(uuid, text, text) to authenticated;
