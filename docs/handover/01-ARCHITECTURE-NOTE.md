# Architecture Note — one page

**App:** Malaysia Open Virtual Karate-do Kata Competition
**Repo:** `SKKIM5242/malaysia-iko-gojuryu-kata-competition` (branch `main` = production)
**Live:** https://malaysia-iko-gojuryu-kata-competiti.vercel.app

> Note: `docs/ARCHITECTURE.md` is an early planning document and is now out of
> date (it says Next.js 14, and lists payments/auth/email as "later" when all
> three are built). This note supersedes it for handover purposes.

---

## The four services, in plain terms

| Service | What it is | What it holds / does here |
|---|---|---|
| **Next.js 16** (React 19) | The application code itself — every page, form, and server action. | All the pages a person sees, plus the server-side logic that validates registrations, computes rankings, and renders certificates. Lives in this git repo. |
| **Vercel** | The hosting company that runs the Next.js code. | Builds the site from GitHub on every push, serves it worldwide, stores the environment variables (secrets), and runs one scheduled job. |
| **Supabase** | Managed Postgres database + login system + file storage. | **The actual data** — participants, registrations, scores, kata videos. This is the part that matters most: losing this is unrecoverable, losing the others is not. |
| **Stripe** | Payment processing. | Takes registration fees by card. Never stores card numbers on our side. |

## How they connect

```
   Person's browser
          │
          ▼
   ┌──────────────────┐         push to main
   │ Vercel           │◄────────────────────── GitHub repo
   │ (runs Next.js)   │                        (source code)
   └───┬─────────┬────┘
       │         │
       │         └──────────────► Stripe  ── Checkout page for fees
       │                             │
       │         ┌───────────────────┘
       │         ▼ webhook: "payment succeeded"
       │    /api/stripe/webhook  ── marks the registration paid
       ▼
   ┌──────────────────────────────────┐
   │ Supabase                         │
   │  · Postgres (all records)        │
   │  · Auth (every login)            │
   │  · Storage (3 buckets:           │
   │    kata-videos, certificates,    │
   │    branding)                     │
   └──────────────────────────────────┘

   Also outbound: Resend (transactional email), Telegram Bot (group notices)
```

**The one flow worth understanding**, because most support questions touch it:

1. Someone fills in the registration form → Next.js validates it server-side.
2. Next.js asks Stripe to open a Checkout page; the person pays there.
3. Stripe calls back to `/api/stripe/webhook`, which flips that registration
   to **paid** in Supabase.
4. The participant now appears in the public Confirmed Participants list, and
   can sign in to record their kata.

If step 3 fails, you get the classic complaint *"I paid but I'm not
registered"* — the money is in Stripe but the database never heard about it.
See the complaint playbook for the fix.

## Where the moving parts live

- **Pages / forms** — `app/` (App Router; `app/admin/*` is the organizer side)
- **Server logic** — `app/actions/*.ts` (registration, admin CRUD, bulk uploads)
- **Shared logic** — `lib/` (rankings, divisions, certificates, IBAN, CSV)
- **Database schema** — `supabase/migrations/*.sql`, applied in filename order
- **Scheduled job** — `/api/cron/judging-timeline`, daily at 01:00 UTC
  (configured in `vercel.json`)

## Environment variables (set in Vercel → Settings → Environment Variables)

Secrets are **only** in Vercel and your password manager — never in the repo.

**Required**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public, safe in browser
- `SUPABASE_SERVICE_ROLE_KEY` — **full database bypass. Server-only. Treat like a root password.**
- `NEXT_PUBLIC_APP_URL` — the site's own address, used for redirects and emails

**Payments**
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

**Email & notifications**
- `RESEND_API_KEY`, `EMAIL_FROM`, `SEND_EMAIL_HOOK_SECRET`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`

**Scheduled job**
- `CRON_SECRET` — stops anyone else from triggering the daily job

## What breaks what

- **Vercel down / bad deploy** → site offline, data safe. Roll back (2 minutes).
- **Supabase down** → site loads but nothing works. Wait for Supabase.
- **Stripe down** → people can browse but not pay. Registration is blocked.
- **Database deleted without backup** → unrecoverable. This is the only
  genuinely fatal one, which is why point-in-time recovery must be on.

## Routine maintenance

- `npm run typecheck` and `npm run build` must both pass before any push.
- Database changes go in a **new numbered migration file**, never by editing
  an old one (old ones have already run on production).
- `main` deploys to production automatically. There is no staging environment.
