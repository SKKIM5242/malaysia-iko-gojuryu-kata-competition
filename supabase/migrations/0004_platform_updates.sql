-- Platform updates: USD fees, kata event categories, auto-derived divisions,
-- announcement ordering, and public School / Sensei self-registration.

-- ── Fees are now USD ─────────────────────────────────────────────────────────
alter table competitions rename column registration_fee_myr to registration_fee_usd;

-- ── Division is derived per registration (age group × belt group × gender) ──
-- Age groups: 4–12, 13–21, 22–40, 41–65, 66–99 (age at event date);
-- Kyu/colour belts and Dan belts compete separately; male/female separately.
alter table registrations add column if not exists division text;

-- ── Owner-adjustable announcement ordering ───────────────────────────────────
alter table announcements add column if not exists sort_order int not null default 0;

-- ── Public School / Dojo and Sensei / Coach self-registration ────────────────
drop policy if exists "schools_insert_public" on schools;
create policy "schools_insert_public" on schools
  for insert to anon, authenticated with check (true);
drop policy if exists "senseis_insert_public" on senseis;
create policy "senseis_insert_public" on senseis
  for insert to anon, authenticated with check (true);

-- ── Replace competition categories with the official kata event list ────────
-- Existing demo registrations are kept but detached from the old categories
-- (their category shows as "—" until re-assigned in the admin panel).
update registrations set category_id = null;
delete from categories;

insert into categories (competition_id, name, age_min, age_max, belt_group, gender) values
  ('c1000000-0000-0000-0000-000000000001', 'Kata Taikyoku Jodan', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Taikyoku Chudan', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Taikyoku Gedan', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Taikyoku Tora Guchi', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Taikyoku Kake Uke', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Geksai Dai Ichi', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Geksai Dai Ni', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Sanchin (forward & backward version)', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Tensho', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Sanseru', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Seiyunchin', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Saifa', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Shisochin', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Sesan', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Sepai', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Kururunfa', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Suparinpei', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Sai — Open — Subject to Weapons rules & regulations', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Nunchaku — Open — Subject to Weapons rules & regulations', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Bo — Open — Subject to Weapons rules & regulations', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata Tonfa — Open — Subject to Weapons rules & regulations', 4, 99, 'open', 'open'),
  ('c1000000-0000-0000-0000-000000000001', 'Kata of Weapons other than Sai, Nunchaku, Bo, Tonfa — Open — Subject to rules & regulations', 4, 99, 'open', 'open');

-- ── Rebrand ──────────────────────────────────────────────────────────────────
update competitions
set name = 'Malaysia Open — IKO Goju-ryu Karate-do — Kata Competition — Goju-ryu Version Only'
where id = 'c1000000-0000-0000-0000-000000000001';

update announcements
set title = replace(title, 'Malaysia IKO Goju-ryu Kata Championship 2026',
                    'Malaysia Open — IKO Goju-ryu Karate-do — Kata Competition 2026'),
    body = replace(replace(body, 'RM 80', 'USD 80'), 'Fee: RM', 'Fee: USD');
