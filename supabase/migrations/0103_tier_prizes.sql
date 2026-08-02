-- Top-3 prize amounts per competition tier -- previously parsed out of each
-- tier's announcement body text ("Gold - 1st Prize - USD 2,000 & Certificate"),
-- which is fine for the organizer's public copy but too fragile to feed a
-- financial report: reword the announcement and the parser silently stops
-- matching, quietly understating Profit/Loss instead of erroring. This is a
-- real setting the organizer controls directly, same reasoning as
-- other_payouts -- money the organizer decides, not something computed or
-- scraped from prose.
create table if not exists tier_prizes (
  competition_id uuid primary key references competitions(id) on delete cascade,
  first_place_usd numeric not null default 0 check (first_place_usd >= 0),
  second_place_usd numeric not null default 0 check (second_place_usd >= 0),
  third_place_usd numeric not null default 0 check (third_place_usd >= 0),
  updated_at timestamptz not null default now()
);

alter table tier_prizes enable row level security;

drop policy if exists "tier_prizes_admin_all" on tier_prizes;
create policy "tier_prizes_admin_all" on tier_prizes
  for all to authenticated
  using (is_admin())
  with check (is_admin());
