# Test Data — TEST 001–100

Seeded on 2026-07-30 to exercise every kata event before launch.

## What was created

- **100 participants** — `TEST 001 Participant` … `TEST 100 Participant`
- **396 registrations** — 132 per tier, all `payment_status = 'paid'`,
  `slot_status = 'active'`
- **All 24 kata events covered in all 3 tiers** (24 / 24 / 24)

Every row is tagged for clean removal:

| Table | Tag |
|---|---|
| `participants` | `ic_passport` starts `TEST-`, `referral_source = 'TEST DATA'` |
| `registrations` | `notes = 'TEST DATA'` |

Participant attributes cycle through all 16 real combinations
(2 genders × 2 belt groups × 4 age brackets), with dates of birth chosen so
each lands **inside** its category's age band — so `resolveCategory()` would
independently agree with the category each one sits in. Nothing is
mismatched.

## Signing in to test recording

All 100 use **`siewkiew9@gmail.com`**. That account already exists
(role: referee) and already has a linked registration, so no back-end change
was needed.

Sign in at `/account` and the **Pending Recordings** list shows every
unrecorded paid registration whose participant email matches the account's
email — currently **384** across the three tiers, grouped by tier. "Start
Recording" on any row switches which registration is active without retyping
a reference ID or IC.

> This is existing behaviour (`getPendingRegistrations` in
> `app/account/page.tsx`), not a test-only bypass. It is how a real sensei
> registering several students under one email is meant to work.

## Categories left thin, for merge practice

Three kata events per tier were given **exactly 1 participant** in both the
Male and Female category — deliberate merge candidates. Each row below pairs
with its opposite gender at the same kata / belt / age, so **Merge → Mix**
has something real to combine.

### USD 10 Tier
| Kata event | Belt | Age | Male | Female |
|---|---|---|---|---|
| Kata Geiksai Dai Ichi - IKO V2 | kyu | 4–14 | 1 | 1 |
| Kata Geiksai Dai Ni - IKO V2 | kyu | 4–14 | 1 | 1 |
| Kata of Weapons other than Sai, Nunchaku, Bo, Tonfa | dan | 41–65 | 1 | 1 |

### USD 100 Tier
| Kata event | Belt | Age | Male | Female |
|---|---|---|---|---|
| Kata Geiksai Dai Ichi - IKO V2 | kyu | 4–14 | 1 | 1 |
| Kata Geiksai Dai Ni - IKO V2 | kyu | 4–14 | 1 | 1 |
| Kata of Weapons other than Sai, Nunchaku, Bo, Tonfa | dan | 4–14 | 1 | 1 |

### USD 200 Tier
| Kata event | Belt | Age | Male | Female |
|---|---|---|---|---|
| Kata Geiksai Dai Ichi - IKO V2 | kyu | 4–14 | 1 | 1 |
| Kata Geiksai Dai Ni - IKO V2 | kyu | 4–14 | 1 | 1 |
| Kata of Weapons other than Sai, Nunchaku, Bo, Tonfa | dan | 15–65 | 1 | 1 |

**18 thin categories total** (3 kata events × 2 genders × 3 tiers).
Every other category has 3 participants.

To re-run this listing at any time:

```sql
select regexp_replace(c.name,'^.*— ','') as tier,
       split_part(cat.name,' — ',1) as kata_event,
       cat.belt_group, cat.age_min||'-'||cat.age_max as age_band,
       cat.gender, count(*) as participants
from registrations r
join competitions c on c.id = r.competition_id
join categories cat on cat.id = r.category_id
where r.notes = 'TEST DATA'
group by c.id, c.name, c.registration_fee_usd,
         split_part(cat.name,' — ',1), cat.belt_group,
         cat.age_min, cat.age_max, cat.gender
having count(*) <= 2
order by c.registration_fee_usd, kata_event, cat.gender;
```

## Removing all of it

Run **in this order** (registrations first — they reference participants):

```sql
-- 1. Remove any recordings made against test registrations
delete from kata_videos
where registration_id in (
  select r.id from registrations r
  join participants p on p.id = r.participant_id
  where p.ic_passport like 'TEST-%'
);

-- 2. Remove the test registrations
delete from registrations
where notes = 'TEST DATA'
   or participant_id in (select id from participants where ic_passport like 'TEST-%');

-- 3. Remove the test participants
delete from participants where ic_passport like 'TEST-%';
```

Verify nothing is left:

```sql
select
  (select count(*) from participants where ic_passport like 'TEST-%') as participants,
  (select count(*) from registrations where notes = 'TEST DATA') as registrations;
-- expect 0, 0
```

⚠️ **Before deleting, check nothing real got tagged.** The `TEST-` prefix and
`notes = 'TEST DATA'` were not used by anything before this seeding, but a
30-second check beats an unrecoverable delete:

```sql
select full_name, ic_passport, email from participants
where ic_passport like 'TEST-%' order by ic_passport;
-- every row should read "TEST nnn Participant"
```

## Caveats

- These sit in the **production** database alongside the 52 real registrations.
  They appear in the public Confirmed Participants list, in admin tables, and
  in rankings — remove them before launch.
- Bank details were **not** created for test participants, so they will show
  blank in payout views. That is intentional; nothing should ever pay out to a
  test row.
- No Stripe payments exist behind them — `payment_status` was set directly.
  Reconciling Stripe against registrations will show these as unmatched.
