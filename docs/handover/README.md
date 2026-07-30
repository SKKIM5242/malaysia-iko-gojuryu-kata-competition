# Handover Documents

Written for the organizer/owner of the Malaysia Open Virtual Karate-do Kata
Competition. Read in order; each is short and standalone.

| # | Document | Read it when |
|---|---|---|
| 01 | [Architecture Note](01-ARCHITECTURE-NOTE.md) | Understanding what each service does and where data lives |
| 02 | [Rollback Runbook](02-ROLLBACK-RUNBOOK.md) | **The site is broken right now.** Keep this reachable offline. |
| 03 | [Credentials & Access](03-CREDENTIALS-AND-ACCESS.md) | Handing over or verifying account ownership |
| 04 | [Test Data](04-TEST-DATA.md) | What the TEST 001–100 rows are, and the SQL to remove them before launch |

## Two things to do before calling the handover complete

1. **Confirm Supabase point-in-time recovery is ON, and test one restore.**
   Everything else on this list is recoverable. The database is not.
2. **Practise one rollback** on a harmless deploy, in daylight, while help is
   available — so the first real one isn't also the first attempt.

## Known gaps at time of writing

- **TEST 001–100 data is live in the production database** — see document 04
  for removal SQL. Must be cleared before launch.

- No custom domain — still on the default `.vercel.app` address
- No error monitoring (e.g. Sentry) — broken pages are only discovered when
  someone complains
- No `robots.txt` or sitemap
- No staging environment; `main` deploys straight to production
- `docs/ARCHITECTURE.md` (outside this folder) is an early planning document
  and is now out of date — document 01 supersedes it
