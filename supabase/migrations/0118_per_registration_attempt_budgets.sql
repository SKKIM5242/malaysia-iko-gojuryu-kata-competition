-- Re-record attempt budgets (the free 3, and any paid top-up) move from
-- shared-per-login to independent per linked registration -- a Sensei
-- managing several students shouldn't have one student's re-records burn
-- down a sibling's chances, and buying 3 more should top up the specific
-- student it was bought for, not the whole login's shared pool.

alter table profile_participants add column if not exists record_attempts int not null default 0;
alter table profile_participants add column if not exists bonus_record_attempts int not null default 0;

-- Backfill: the PRIMARY registration's row (the only one that ever had
-- individual attempt usage before this change, since attempts were shared
-- per login) inherits the login's current counts. Every other linked
-- participant starts fresh at 0/0 -- there is no prior "their own" usage to
-- preserve, since independent budgets didn't exist until now.
update profile_participants pp
set record_attempts = p.record_attempts,
    bonus_record_attempts = p.bonus_record_attempts
from profiles p
where p.user_id = pp.user_id
  and p.registration_id = pp.registration_id;

alter table attempt_purchases add column if not exists registration_id uuid references registrations(id);

-- Backfill existing purchases (pending or already paid) to the purchaser's
-- primary registration -- that's what they were implicitly for, back when
-- the bonus pool was shared per login.
update attempt_purchases ap
set registration_id = p.registration_id
from profiles p
where p.user_id = ap.user_id
  and ap.registration_id is null
  and p.registration_id is not null;

-- Both RPCs gain a registration parameter and now operate on
-- profile_participants instead of profiles -- the old zero-arg overloads
-- are dropped outright rather than left dangling, since nothing should
-- call them post-migration.
drop function if exists public.consume_delete_attempt();
create function public.consume_delete_attempt(p_registration_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v int;
begin
  update profile_participants
  set record_attempts = record_attempts + 1
  where user_id = auth.uid() and registration_id = p_registration_id
    and record_attempts < 3 + bonus_record_attempts
  returning record_attempts into v;
  return v is not null;
end;
$function$;
grant execute on function public.consume_delete_attempt(uuid) to authenticated;

drop function if exists public.increment_record_attempts();
create function public.increment_record_attempts(p_registration_id uuid)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v int;
begin
  update profile_participants
  set record_attempts = least(record_attempts + 1, 3 + bonus_record_attempts)
  where user_id = auth.uid() and registration_id = p_registration_id
  returning record_attempts into v;
  return coalesce(v, 3);
end;
$function$;
grant execute on function public.increment_record_attempts(uuid) to authenticated;
