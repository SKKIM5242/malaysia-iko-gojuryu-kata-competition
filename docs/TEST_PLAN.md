# Test Plan

## Success Scenario (manual, run after Sprint 2+3)
1. Open the live URL (no login). **Pass:** Competition name, date, fee, and category list are visible.
2. Click **Register**. Fill all fields with valid data. Submit. **Pass:** Confirmation message shows a registration reference ID.
3. Open Supabase Table Editor → `registrations`. **Pass:** New row exists with `payment_status = 'pending'`.
4. Log in as owner at `/admin`. Open `/admin/registrations`. **Pass:** New registration row appears.
5. Click **Mark Paid** on that row. **Pass:** `payment_status` changes to `'paid'` in DB and in the UI instantly.
6. Open `/participants` as anonymous visitor. **Pass:** Newly paid participant appears in the list.

## Empty States
- Delete all seeded registrations → `/participants` shows "No confirmed participants yet."
- No published announcements → homepage shows "No announcements yet."

## Error Cases
- Submit registration form with missing IC field → inline validation error, no DB write.
- Submit duplicate IC + competition → server returns error; form shows "This IC is already registered for this competition."
- Non-owner hits `/admin` without session → redirected to `/login` (Sprint 4+).

## Edge Cases
- Registration deadline passed → **Register** button replaced with "Registration closed."
- Category with 0 slots remaining → form disables that option and shows "Full".
- Very long school name → truncated with ellipsis in table; full name shown on hover/detail.

## Load Check
- 100 seeded registrations → `/participants` page renders in < 2 s (add DB index on `competition_id` if slow).
