-- Gender becomes a real category dimension (Male / Female, with Mix (M&F)
-- available as an admin-created merge target — not pre-generated). Every
-- kata × belt × age combo gets separate Male and Female sub-categories with
-- a standard participant cap: 100 for the USD 10 tier, 200 for the USD 100
-- and USD 200 tiers. The old "Open (auto-split M/F)" scheme is retired.
--
-- Competition-level max_participants is dropped entirely — only the
-- sub-sub-sub-sub-category (kata + belt + age + gender) cap is tracked now.

alter table competitions drop column if exists max_participants;
drop function if exists public.competition_paid_count(uuid);

-- Detach existing registrations before their categories are replaced.
update registrations set category_id = null
where competition_id in (
  'c1000000-0000-0000-0000-000000000001',
  '2efffe3d-f821-4b3d-9987-5b4396906564',
  'a779dcd1-a841-4503-9735-e91c1a1b6d4b'
);

-- Capture the canonical 24-kata list + display order before deleting.
create temporary table tmp_katas as
select
  split_part(name, ' — ', 1) as kata_name,
  (row_number() over (order by min(sort_order)) - 1)::int as kata_index
from categories
where competition_id = 'c1000000-0000-0000-0000-000000000001'
group by split_part(name, ' — ', 1);

delete from categories where competition_id in (
  'c1000000-0000-0000-0000-000000000001',
  '2efffe3d-f821-4b3d-9987-5b4396906564',
  'a779dcd1-a841-4503-9735-e91c1a1b6d4b'
);

insert into categories (competition_id, name, age_min, age_max, belt_group, gender, sort_order, max_participants)
select
  t.comp_id,
  k.kata_name || ' — ' || belt.label || ' — Age ' || age.lo || '–' || age.hi || ' — ' || gen.label,
  age.lo, age.hi, belt.grp, gen.code,
  (k.kata_index * 16) + (belt.ord * 8) + (age.ord * 2) + gen.ord,
  t.cap
from tmp_katas k
cross join (values ('kyu', 'Color/Kyu Belt', 0), ('dan', 'Black Belt & Dan Holders', 1)) as belt(grp, label, ord)
cross join (values (4, 14, 0), (15, 40, 1), (41, 65, 2), (66, 99, 3)) as age(lo, hi, ord)
cross join (values ('male', 'Male', 0), ('female', 'Female', 1)) as gen(code, label, ord)
cross join (values
  ('c1000000-0000-0000-0000-000000000001'::uuid, 100),
  ('2efffe3d-f821-4b3d-9987-5b4396906564'::uuid, 200),
  ('a779dcd1-a841-4503-9735-e91c1a1b6d4b'::uuid, 200)
) as t(comp_id, cap);

drop table tmp_katas;
