-- Bug: resetting a registration's Slot Status back to "Active" only ever
-- touched slot_status — it never restored payment_status back to 'paid'
-- after the auto-cron (or a manual "Forfeited" click) had set it to
-- 'forfeited'. That left registrations stuck in a state where the Slot
-- Status badge read "Active" but payment_status was still 'forfeited',
-- silently blocking claim_registration/claim_registration_by_id (both
-- require payment_status = 'paid') even though nothing on-screen showed
-- why. Now resetting to "Active" also restores payment_status to 'paid'
-- when it had been auto/manually forfeited.
create or replace function public.set_registration_slot_status(reg_id uuid, new_status text, note text default null)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
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
      payment_status = case
        when new_status = 'forfeited' then 'forfeited'
        when new_status = 'active' and payment_status = 'forfeited' then 'paid'
        else payment_status
      end
  where id = reg_id;
end;
$function$;

-- One-time data fix: any registration already stuck in this inconsistent
-- state (Slot Status reset to Active by hand, but payment never restored)
-- gets corrected immediately rather than waiting for another slot-status
-- click to trigger the fixed function above.
update registrations
set payment_status = 'paid'
where slot_status = 'active' and payment_status = 'forfeited';
