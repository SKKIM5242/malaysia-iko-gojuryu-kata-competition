# PRD — Malaysia IKO Goju-ryu Kata Competition

## Problem
No owned platform to publish competition info, manage participants, coaches, sensei, and schools, and collect paid registrations — currently dependent on rented tools the owner doesn't control.

## Target User
Karateka, coaches (sensei), and school representatives in the IKO Goju-ryu Malaysia community; plus the competition organiser (owner/admin).

## Core Objects
- **Competition** — the event (name, date, venue, registration fee, deadline)
- **School** — dojo/club (name, state, affiliation)
- **Sensei / Coach** — instructor linked to a school
- **Participant** — individual karateka registering for a category
- **Category** — age/belt division (e.g. Junior Male Kyu)
- **Registration** — participant + category + payment status
- **Post/Announcement** — owner-published news or rules content

## MVP Must-Haves
- [ ] Public homepage shows active competition, announcements, and schedule
- [ ] Owner can create/edit a Competition and publish Announcements
- [ ] Owner can manage Schools, Sensei, and Participants via admin panel
- [ ] Visitor can browse registered participants and categories (read-only)
- [ ] Participant registration form (name, IC/passport, school, category, coach) saves to DB
- [ ] Registration flags payment status (pending/paid/rejected) — owner marks it manually
- [ ] Seed demo data visible without login

## Non-Goals (v1)
- Online payment gateway (Stripe/FPX) — owner marks paid manually
- Scoring / judging during the event
- Bracket/draw generation
- Multi-tenant competitions
- Email notifications

## Success Criteria
A visitor opens the live domain, sees the active competition details and participant list, fills in the registration form, and the owner logs into the admin panel and sees the new registration with the ability to mark it as paid — all persisted to the database.
