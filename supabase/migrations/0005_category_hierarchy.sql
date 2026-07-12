-- Structured category hierarchy: Kata event → belt sub-category → age
-- sub-sub-category. No "Open" belt/age categories. 24 katas × 2 belts × 4
-- age groups = 192 rows, ordered exactly per the organiser's kata listing.

alter table categories add column if not exists sort_order int not null default 0;

-- Detach existing registrations from the old flat categories, then replace.
update registrations set category_id = null;
delete from categories;

insert into categories (competition_id, name, age_min, age_max, belt_group, gender, sort_order)
select
  'c1000000-0000-0000-0000-000000000001',
  k.kata || ' — ' || b.label || ' — Age ' || a.lo || '–' || a.hi,
  a.lo,
  a.hi,
  b.grp,
  'open',
  (k.ord - 1) * 8 + (b.ord - 1) * 4 + a.ord
from (values
  (1,  'Kata Taikyoku Jodan'),
  (2,  'Kata Taikyoku Chudan'),
  (3,  'Kata Taikyoku Gedan'),
  (4,  'Kata Taikyoku Tora Guchi'),
  (5,  'Kata Taikyoku Kake Uke'),
  (6,  'Kata Geksai Dai Ichi'),
  (7,  'Kata Geksai Dai Ni'),
  (8,  'Kata Sanchi - (forward & backward version)'),
  (9,  'Kata Tensho'),
  (10, 'Kata Sanseru'),
  (11, 'Kata Seiyunchin'),
  (12, 'Kata Saifa'),
  (13, 'Kata Shisochin'),
  (14, 'Kata Sesan'),
  (15, 'Kata Sepai'),
  (16, 'Kata Kururunfa'),
  (17, 'Kata Suparinpei'),
  (18, 'Kata Sai - Open - Subject to Weapons rules & regulations'),
  (19, 'Kata Nunchaku - Open - Subject to Weapons rules & regulations'),
  (20, 'Kata Bo - Open - Subject to Weapons rules & regulations'),
  (21, 'Kata Tonfa - Open - Subject to Weapons rules & regulations'),
  (22, 'Kata of Weapons other than Sai, Nunchakun, Bo, Tonfa - Open - Subject to rules & regulations'),
  (23, 'Kata Geiksai Dai Ichi - IKO V2'),
  (24, 'Kata Geiksai Dai Ni - IKO V2')
) as k(ord, kata)
cross join (values
  (1, 'Color/Kyu Belt', 'kyu'),
  (2, 'Black Belt & Dan Holders', 'dan')
) as b(ord, label, grp)
cross join (values
  (1, 4, 14),
  (2, 15, 40),
  (3, 41, 65),
  (4, 66, 99)
) as a(ord, lo, hi);
