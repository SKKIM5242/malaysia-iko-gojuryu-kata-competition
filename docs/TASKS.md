# Tasks & Sprints

## Sprint 1 — Database Foundation & Demo Data
**Goal:** Schema live in Supabase, seed data visible, app renders without login.
- [ ] Write and apply migration SQL (all tables + RLS v1 open policies)
- [ ] Seed 3 schools, 3 senseis, 1 competition, 4 categories, 6 participants, 6 registrations, 2 announcements
- [ ] Confirm Supabase project created and `.env.local` wired
- [ ] Next.js project scaffolded on Vercel (repo connected, auto-deploy)

**Definition of Done:** `/` loads and shows seeded competition + participant list without any login prompt.

---

## Sprint 2 — Public Pages (Core Engine) ✦ v1 functional milestone
**Goal:** Every public-facing page works end-to-end against the live DB.
- [ ] `/` — active competition card, open categories, latest announcements
- [ ] `/participants` — paginated list of confirmed registrations (filter by category/school)
- [ ] `/register` — registration form: name, IC/passport, DOB, gender, belt rank, school, category, coach → inserts `participant` + `registration` rows
- [ ] `/announcements/[slug]` — full announcement body (markdown rendered)
- [ ] All pages handle loading, empty, error, and data states
- [ ] Registration form validates required fields client + server side
- [ ] On successful submit: show confirmation message with reference ID

**Definition of Done:** A new visitor submits the form; the owner refreshes `/admin/registrations` and sees the row.

---

## Sprint 3 — Admin Panel (Owner CRUD)
**Goal:** Owner can manage all objects without touching the database directly.
- [ ] `/admin` dashboard — counts: registrations (by status), participants, schools
- [ ] `/admin/registrations` — table with filter; **Mark Paid / Reject** buttons persist to DB
- [ ] `/admin/competitions` — create/edit competition (all fields)
- [ ] `/admin/announcements` — create/edit/publish/unpublish
- [ ] `/admin/schools` and `/admin/senseis` — create/edit/delete
- [ ] `/admin/participants` — view/edit participant details
- [ ] Audit log written on every status change
- [ ] All admin forms handle loading/error/empty states; no dead buttons

**Definition of Done:** Owner marks a registration paid → DB updated → public `/participants` list reflects it immediately.

---

## Sprint 4 — Lock It Down (Auth + RLS)
**Goal:** Admin routes require login; public reads stay open; no data leak.
- [ ] Supabase Auth enabled; owner account created
- [ ] `/admin/*` server-side session check — redirect to `/login` if unauthenticated
- [ ] Replace v1 open RLS policies with owner-scoped write policies on all tables
- [ ] Public read policies retained for competitions, announcements, categories, participants (confirmed only)
- [ ] Registrations: write open to authenticated users; reads scoped to owner or own record
- [ ] Test: anonymous user cannot POST to admin endpoints

**Definition of Done:** Logging out blocks all `/admin` routes; public pages still load for anonymous visitors.

---

## Sprint 5 — Polish & Launch
**Goal:** Production-ready on custom domain.
- [ ] Custom domain configured in Vercel
- [ ] SEO meta tags (competition name, date, venue)
- [ ] Mobile-responsive layout pass
- [ ] 404 and error boundary pages
- [ ] README with local setup and deploy steps
- [ ] Manual test plan executed top-to-bottom (see TEST_PLAN.md)

**Definition of Done:** Live on custom domain, owner can log in, submit a test registration, mark it paid, and see it on the public list.

---

## Gantt (Sprint → Feature)
```
Sprint 1: Schema · Seed · Supabase · Vercel scaffold
Sprint 2: Public homepage · Registration form · Participant list · Announcements
Sprint 3: Admin CRUD · Payment status toggle · Audit log
Sprint 4: Auth login · RLS lock-down · Permission test
Sprint 5: Domain · SEO · Mobile · Launch
```
