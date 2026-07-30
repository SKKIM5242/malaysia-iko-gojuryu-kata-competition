# Credentials Handover & Access Ownership

> **No secret values belong in this file, in any document, in chat, or in email.**
> This file records *what* must be handed over and *how to verify* it — never
> the values themselves.

---

## Part 1 — How to hand over credentials

### The rule
Credentials move through a **password manager's shared vault**. Nothing else.

### Not acceptable, ever
- ❌ A spreadsheet, Word doc, PDF, or `.txt` file of passwords
- ❌ WhatsApp, Telegram, SMS, Slack, or email — including "delete after reading"
  (it stays in both sent folders, in backups, and often in cloud sync)
- ❌ A screenshot of a dashboard showing a key
- ❌ Committed to git — even in a private repo, even deleted later (it stays in
  history forever)
- ❌ Dictated over a phone call and written on paper

### Do this instead
1. Pick a password manager with shared vaults — **1Password**, **Bitwarden**,
   **Dashlane**, or **Keeper** all work. Bitwarden has a free tier.
2. Create a vault named **Malaysia Open — Production**.
3. Add one entry per service (list in Part 2). Each entry gets the login URL,
   username, password, TOTP/2FA seed if any, and a note saying what it controls.
4. Share the vault with the owner's own account — **not** a shared login. Each
   person keeps their own credentials so access can be revoked individually.
5. Owner confirms they can open every entry **while the developer is still
   available**. Do not close out the handover before this.
6. **Then rotate the high-value secrets** (below) so the pre-handover values
   stop being valid.

### Rotate at handover — mandatory
Anything the developer has seen should be replaced once the owner has control:

| Secret | Where to rotate |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → roll key |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → roll |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → the endpoint → roll secret |
| `RESEND_API_KEY` | Resend → API Keys → revoke + create |
| `TELEGRAM_BOT_TOKEN` | BotFather → `/revoke` → new token |
| `CRON_SECRET`, `SEND_EMAIL_HOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET` | Generate new random values yourself |

After rotating, update the value in **Vercel → Settings → Environment
Variables (Production)** and redeploy. Rotate **one at a time** and confirm the
site still works before moving to the next — rotating several at once makes a
resulting breakage hard to attribute.

> `NEXT_PUBLIC_*` variables are deliberately public (they ship to the browser)
> and don't need rotating. Everything else does.

---

## Part 2 — Access ownership checklist

**I cannot verify any of this for you.** These live in dashboards outside the
codebase, and I have no access to Vercel, Stripe, or your domain registrar.
Each line needs a human to log in and confirm. Tick them off yourself.

For each: the **owner must hold the top-level role**, not a member/developer
role — the difference matters when you need to remove someone or move billing.

### Vercel — https://vercel.com
- [ ] Owner's own account has the **Owner** role on the team/project
      (Settings → Members). "Member" is not enough.
- [ ] Billing is on the owner's payment method, not the developer's
- [ ] Owner can see **Settings → Environment Variables** and the
      **Deployments** tab (needed for rollback)
- [ ] Owner has done one **practice rollback** on a non-critical deploy
- [ ] Any developer accounts no longer needed are removed

### Supabase — https://supabase.com
- [ ] Owner is **Organization Owner** (Organization → Team), not just a project member
- [ ] Billing is on the owner's payment method
- [ ] **Point-in-time recovery / daily backups are ON** — verify in
      Database → Backups. ⚠️ *Most important single item on this page.*
- [ ] Owner has performed **one test restore** to prove backups work
- [ ] Owner can reach Settings → API (where the service role key lives)
- [ ] Project is the **production** project — not a dev/branch database

### Stripe — https://dashboard.stripe.com
- [ ] Account is registered to the **business** (IKO Goju-ryu Karate-do (M)
      Sdn Bhd), not to an individual developer
- [ ] Owner has the **Administrator** role (Settings → Team)
- [ ] Payouts point at the organization's own bank account
- [ ] Account is in **live** mode, not test mode
- [ ] Webhook endpoint `/api/stripe/webhook` shows recent **successful**
      deliveries (Developers → Webhooks)

### Domain registrar
- [ ] Owner knows **which registrar** holds the domain and can log in
- [ ] Domain is registered to the organization, with the owner's own contact email
- [ ] **Auto-renew is ON** — an expired domain takes the whole site down
- [ ] Renewal date recorded in a calendar with a reminder
- [ ] Registrar-lock / transfer-lock enabled
- [ ] DNS records pointing at Vercel are documented

> ⚠️ **Currently unresolved:** the site is still on the default
> `.vercel.app` address. Until a custom domain is bought and pointed at
> Vercel, this section is not applicable — and the site's address depends
> entirely on Vercel's hosting. Buying the domain should be done before
> promoting the competition, so printed material and certificates don't
> reference a URL you'll later change.

### GitHub — https://github.com
- [ ] Owner's account has **Admin** on `SKKIM5242/malaysia-iko-gojuryu-kata-competition`
- [ ] Owner can see the backup branches (e.g. `backup/pre-tier-audit-2026-07-30`)
- [ ] Repo visibility (private/public) is intentional

### Supporting services
- [ ] **Resend** (email) — owner has account access; sending domain verified
- [ ] **Telegram bot** — owner controls the BotFather account that owns the bot

---

## Part 3 — The single-point-of-failure test

Ask, and be honest about the answer:

> *If the developer became permanently unreachable tomorrow, could the owner
> alone keep this competition running?*

That requires all of:
1. Owner-level access to Vercel, Supabase, Stripe, GitHub, and the registrar ✅
2. Ability to roll back a bad deploy → `02-ROLLBACK-RUNBOOK.md`
3. Understanding of which service does what → `01-ARCHITECTURE-NOTE.md`
4. Verified working database backups
5. Every credential retrievable from the shared vault

If any answer is "no", the handover is not finished — regardless of whether
the code is.

---

## Part 4 — Backups already in place

- **GitHub branch** `backup/pre-tier-audit-2026-07-30` — code snapshot
- **External drive** `G:\Malaysia Open` — full working copy including `.git`
  history (excludes `node_modules` and `.next`, both rebuildable via
  `npm install` + `npm run build`)

Neither of these backs up the **database**. Code and data are separate
problems: the repo protects the code, Supabase's point-in-time recovery
protects the data. Only one of those is currently confirmed.
