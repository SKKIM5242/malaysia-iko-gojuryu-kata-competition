# Architecture

## Stack
- **Frontend:** Next.js 14 (App Router) on Vercel
- **Database + Auth:** Supabase (Postgres + RLS)
- **Styling:** Tailwind CSS
- **Auth (later):** Supabase Auth — owner-only admin login

## Now vs Later
**Now:** Public competition page, participant list, registration form, owner admin CRUD, manual payment status toggle.
**Later:** Online payment, automated draw/bracket, email confirmations, scoring module.

## Key Action Flow — Participant Registration
1. Visitor lands on `/` — competition details and open categories load from DB.
2. Visitor clicks **Register** → form captures name, IC, school, category, coach name.
3. On submit, a `registration` row is inserted (payment_status = 'pending').
4. Owner opens `/admin/registrations` → sees new row, verifies bank transfer proof, clicks **Mark Paid**.
5. `payment_status` updates to `'paid'` in DB; participant appears in public confirmed list.

## Layer Plan
1. **Data first** — schema, RLS open policies, seed data.
2. **App logic** — public pages + registration form + admin CRUD.
3. **Smart features later** — participant ranking, AI-generated draw seeding.

## Core Without AI
All registration, publishing, and payment-status flows are plain DB reads/writes. No AI dependency for any v1 function.
