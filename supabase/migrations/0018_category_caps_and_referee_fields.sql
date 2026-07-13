-- Per-sub-category participant caps (finer-grained than the per-competition
-- cap added in 0017), plus new required/optional Referee/Judge fields.

alter table categories add column if not exists max_participants int;

create or replace function public.category_paid_count(p_category uuid)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from registrations
  where category_id = p_category and payment_status = 'paid';
$$;
grant execute on function public.category_paid_count(uuid) to anon, authenticated;

-- Batched version for listing pages (one round trip instead of one per row).
create or replace function public.category_paid_counts(p_category_ids uuid[])
returns table(category_id uuid, cnt int)
language sql stable security definer set search_path = public as $$
  select category_id, count(*)::int
  from registrations
  where category_id = any(p_category_ids) and payment_status = 'paid'
  group by category_id;
$$;
grant execute on function public.category_paid_counts(uuid[]) to anon, authenticated;

-- Referee / Judge: how many times they've judged before (required), plus
-- unlimited optional uploads of international certification records
-- (distinct from the single required "latest rank certificate").
alter table referees add column if not exists judging_experience_count int;
alter table referees add column if not exists international_certificate_paths text[] not null default '{}';
