# Malaysia IKO Goju-ryu Kata Competition

Owner-controlled competition platform for the Malaysia IKO Goju-ryu community:
public event info + announcements, online participant registration, and an
admin panel where the organiser confirms payments and manages every record.

**Stack:** Next.js 15 (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind CSS 4 · Vercel

## How it works

1. A visitor opens `/` — sees the active competition, categories, and announcements.
2. They submit the registration form at `/register` → a `participant` +
   `registration` (payment status `pending`) row is written, and they get a
   reference ID.
3. They bank-transfer the fee and send the receipt to the organiser.
4. The organiser logs into `/admin/registrations` and clicks **Mark Paid**.
5. The participant immediately appears on the public `/participants` list.

Every state change is written to the append-only `audit_logs` table.

## Local setup

```bash
npm install
npx vercel link            # link to the Vercel project
npx vercel env pull .env.local
npm run dev                # Turbopack dev server on :3000
```

## Database

Migrations live in `supabase/migrations/` and are applied via the Supabase
SQL editor (or `supabase db push`):

- `0001_init.sql` — all tables, v1 open RLS policies, and seed demo data
  (3 schools, 3 senseis, 1 competition, 4 categories, 6 participants,
  6 registrations, 2 announcements).
- `0002_lockdown.sql` — Sprint 4 lock-down: authenticated-only writes,
  public reads limited to published/paid/confirmed rows, anonymous INSERT
  retained for the registration form, plus the `ic_already_registered`
  duplicate-check function.

## Admin access

`/admin/*` requires a Supabase Auth session (redirects to `/login`).
Create the owner account in the Supabase dashboard → Authentication →
Users → **Add user** (tick auto-confirm), then sign in at `/login`.

## Deploy

Push to `main` — Vercel auto-deploys from GitHub. Never deploy with the
Vercel CLI directly; git is the source of truth.

```bash
git add -A && git commit -m "…" && git push
```

## Manual test plan

See [docs/TEST_PLAN.md](docs/TEST_PLAN.md). The core scenario: anonymous
visitor registers → row appears in `/admin/registrations` as `pending` →
owner clicks Mark Paid → participant shows on public `/participants`.
