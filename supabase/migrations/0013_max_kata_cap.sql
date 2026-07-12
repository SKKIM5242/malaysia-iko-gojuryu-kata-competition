-- A participant may compete in at most 3 kata events per competition.
-- (Rejected registrations don't count against the cap.)

create or replace function public.ic_registration_count(p_ic text, p_competition uuid)
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int
  from participants p
  join registrations r on r.participant_id = p.id
  where p.ic_passport = p_ic
    and r.competition_id = p_competition
    and r.payment_status <> 'rejected';
$$;

create or replace function public.ic_has_kata(p_ic text, p_competition uuid, p_kata_base text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from participants p
    join registrations r on r.participant_id = p.id
    join categories c on c.id = r.category_id
    where p.ic_passport = p_ic
      and r.competition_id = p_competition
      and r.payment_status <> 'rejected'
      and split_part(c.name, ' — ', 1) = p_kata_base
  );
$$;

grant execute on function public.ic_registration_count(text, uuid) to anon, authenticated;
grant execute on function public.ic_has_kata(text, uuid, text) to anon, authenticated;
