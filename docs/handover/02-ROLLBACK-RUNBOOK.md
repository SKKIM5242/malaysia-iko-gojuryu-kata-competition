# Rollback Runbook — "the site is broken, fix it now"

**Read this first:** rolling back is safe, fast (~2 minutes), and reversible.
It does **not** delete anything and does **not** touch your database. If you
are unsure whether to roll back — roll back. You can always redeploy the newer
version afterwards.

---

## Before you touch anything: is it actually the deploy?

Two quick checks, 30 seconds:

1. **Open https://malaysia-iko-gojuryu-kata-competiti.vercel.app/api/health**
   - Loads normally → the site is up; your problem is probably one specific
     page or feature, not the deploy. Rolling back may still be right if a
     recent change caused it.
   - Doesn't load at all → the deploy or Vercel itself is the problem.
2. **Check https://www.vercel-status.com and https://status.supabase.com**
   - If either reports an outage, rolling back will **not** help. Wait it out
     and post a notice for participants.

**Rollback fixes:** a code change that broke a page, a button, a form, the
build, or the whole site.
**Rollback does NOT fix:** Supabase or Vercel outages, expired API keys, a
full storage quota, Stripe problems, or bad/corrupted data.

---

## Method A — Vercel dashboard (use this one)

No terminal, no git. This is the 2am method.

1. Go to **https://vercel.com** and sign in.
2. Open the project (**malaysia-kata-app** / the one matching this repo).
3. Click the **Deployments** tab.
4. Find the last deployment that was working. The list is newest-first, so
   this is usually the one **directly below** the current top entry. It must
   show status **Ready** (not Error/Building).
   - Not sure which one? Click a deployment → **Visit** to open that exact
     version at its own URL and test it before promoting it.
5. Click the **⋯** menu on that deployment → **Promote to Production**.
   (On some Vercel versions this reads **Rollback** or **Redeploy** — any of
   the three achieves the same result.)
6. Confirm. Wait ~1–2 minutes.
7. **Verify:** hard-refresh the live site (`Ctrl+Shift+R`) and re-test the
   exact thing that was broken. Also re-check `/api/health`.

Done. The site is now serving the older, working code.

### Then, before you go back to sleep
- Post a short notice if participants were affected (Announcements page).
- Note the time and what was broken — that's what makes the real fix quick.
- **Do not** push anything else to `main` until the cause is understood, or
  the next push will redeploy the same broken code.

---

## Method B — git revert (when the bad change must leave `main`)

Method A changes what production serves but leaves the bad commit on `main`.
The next push would redeploy it. Use B to remove the change properly.

```bash
cd "C:\Users\user\Projects\malaysia-iko-gojuryu-kata-competition"
git log --oneline -10
```

Identify the bad commit's short hash, then:

```bash
git revert <hash>
```

This creates a *new* commit undoing that one — it does not rewrite history,
so it's safe on a shared branch. Then:

```bash
npm run typecheck
npm run build
git push
```

Vercel deploys the revert automatically. If `git revert` reports a conflict,
stop and use Method A instead — don't resolve conflicts at 2am.

> Never use `git push --force` on `main` to fix production. It rewrites shared
> history and can destroy work.

---

## If the database is the problem, not the code

Rollback cannot help. Supabase holds all real data.

- **Supabase Dashboard → Database → Backups** for point-in-time recovery.
- A restore is **destructive**: it returns the whole database to an earlier
  moment, discarding everything after it (including legitimate registrations
  taken in between). Never do this to fix a single bad row — fix that row.
- Reserve restores for genuine mass loss or corruption.

---

## Quick reference

| Symptom | Action |
|---|---|
| Whole site down, `/api/health` fails, Vercel status green | Method A |
| One page/button broke right after a deploy | Method A, then B |
| Build failed, production still on old version | Nothing is broken — fix forward |
| Vercel or Supabase status page shows an outage | Wait; post a notice |
| Site fine but data looks wrong | Not a deploy issue — fix the data |
| Everyone signed out / logins failing | Check Supabase status + env vars |

**Escalate when:** two rollbacks in a row don't fix it, the database may have
lost data, or money moved in Stripe without matching registrations.
