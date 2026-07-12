-- Batch-friendly version of the kata-count/dedupe check for the CSV bulk
-- importer (up to 10,000 rows) — one round trip for the whole file instead
-- of one per row.

create or replace function public.ic_registration_summary(p_ics text[], p_competition uuid)
returns table(ic text, cnt int, kata_bases text[])
language sql
security definer
set search_path = public
as $$
  select p.ic_passport, count(*)::int, array_agg(distinct split_part(c.name, ' — ', 1))
  from participants p
  join registrations r on r.participant_id = p.id
  left join categories c on c.id = r.category_id
  where p.ic_passport = any(p_ics)
    and r.competition_id = p_competition
    and r.payment_status <> 'rejected'
  group by p.ic_passport;
$$;

grant execute on function public.ic_registration_summary(text[], uuid) to anon, authenticated;
