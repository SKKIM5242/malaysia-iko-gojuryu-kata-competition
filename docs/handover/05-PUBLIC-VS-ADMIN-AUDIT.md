# Public vs Admin form audit

Compared the **rendered** field labels of each public registration form against
its admin counterpart (not the source, so component-rendered fields like the
certificate picker and IBAN input are included).

First run 2026-07-31. Updated 2026-07-31 after closing the structural gap and
re-checking the items that couldn't be verified the first time. The
invitation-code Run button is excluded by design — admin-only, as agreed.

---

## ✅ Resolved since the first pass

**Admin can now register a kata event.** Admin → Participants → Add
Participant has the same 3-tier Kata events picker as the public form, and
`saveParticipant` creates real `registrations` rows via
`createAdminRegistrations` — no invitation code goes to Stripe Checkout for
the total fee, a code waives it or settles it another way. Rows are always
inserted `pending`, never `paid`, so an unpaid entry can never count toward a
school's/sensei's commission.

**Participant Support referral (Audience).** The admin Audience form now asks
for it (`support_referral`), matching the public form.

**Admin → Organizers / Admin → Support create forms — re-checked while
signed in** (previously blocked by the `isSuperAdmin`/`canCreate` gate
rendering zero labels for an anonymous audit). Verified against
`createStaffAccount`'s own validation, not just the rendered labels: both
forms collect every field the backend actually requires, and match each
other field-for-field except the Participant-Support-only block (Highest
Education, Languages, Supported Tiers), which only Support's form shows.
Functionally complete — nothing missing on the admin side.

One asymmetry found, but on the **public** side, not the admin side: the
public "apply to join" form (`/register/staff` → `StaffForm`) requires short
name, Highest Education, and Languages from every applicant, including
someone applying as Organizer — fields that only matter for Participant
Support. Low-impact (it's the lightweight interest/application form, not the
actual account-creation form an admin fills in afterwards) — noted here as an
optional future cleanup, not fixed now since it's a public-facing form change
with no reported problem to fix.

**Admin → Participants table was missing columns the form collects.**
Compared `/admin/participants`'s own listing (not the fuller one on
`/admin/records`) against its own Add Participant form and added: Gender,
Email, Phone, Home Address, City/Town, Postcode, Sensei, Invitation Code,
Referral — every remaining field the form captures now has a column.

**Admin can now edit and delete** Audience/Spectator records and
Admin/Organizer/Participant-Support accounts — previously view+create only
(Audience) or view-only via `/admin/records` (staff accounts). See the CRUD
audit below.

---

## Full view/create/edit/delete audit (admin panel)

Every admin listing page checked for the four operations. Already complete
before this pass: Schools, Senseis, Participants, Referees, Classes, Content
(access-matrix tables), Announcements, Telegram Groups, Competitions
(create/edit; tier delete deliberately excluded — see below).

Gaps found and closed:
- **Audience / Spectators** — had view + create only. Now has edit (in place)
  and delete.
- **Admin / Organizer / Staff accounts** (`/admin/organizers`) — had create
  only; nothing anywhere could edit or delete a login afterwards. Now has
  both, gated to the roles that could already create them (edit) and the
  Super Admin only (delete).
- **Participant Support accounts** (`/admin/support`) — same gap, same fix.

Deliberately **not** built: deleting a competition tier. Create/edit already
exist; a delete would cascade through live categories, real registrations,
and Stripe-linked payments on a production app with real money moving
through it. Needs its own explicit go-ahead, not a CRUD-parity pass.

Verified live against production data (disposable test rows created and
deleted via the project's own service-role credentials, cleaned up
immediately after — no real record was ever touched): the tables render real
rows with working Edit links and Delete buttons, the edit forms pre-fill
every field correctly including null values, the update semantics match what
each Save button executes, and deleting a staff account correctly removes
both the Supabase Auth login and its profile row (`profiles.user_id` cascades
on delete). Zero test data left behind.

---

## Wording differences only — same field, different words

Cosmetic; not fixed, since nobody has asked for it and touching live
copy on both public and admin forms across ~7 role types is more churn than
the mismatch is worth on its own:

| Public | Admin |
|---|---|
| IC / Passport number * | IC / Passport * |
| School / Dojo * | School * |
| Coach / Sensei * | Sensei * |
| International Bank Account No. (IBAN) * | International Bank Account No. (IBAN/SWIFT/BIC/ACH) * |
| Sensei / Coach name * | Name * |
| Latest Rank * | Rank * / Belt rank |
| Mobile / WhatsApp * | Mobile phone * |
| School / organization * | School * |
| Home address * *(both, but public adds the no-comma note)* | Home address * |

## Genuine behaviour differences — left as-is, judgment calls

| Field | Public | Admin | Note |
|---|---|---|---|
| Latest rank certificate | **required** | optional | Deliberate — an organizer entering someone may not have the file to hand. |
| Rank confirmation | a "my rank matches my certificate" tick box the entrant must accept | a `Rank confirmation` dropdown (Sensei Confirmed / Certificate Uploaded / Pending) | Different mechanisms for the same fact — reasonable, since an organizer is asserting it rather than the entrant. |
| Who is registering? (Sensei form) | asked | not asked | Public-only provenance question — arguably moot for an admin-entered record, since the admin is definitionally the one entering it. |
| International referee/staff certificates | multi-upload | add later via Edit | Documented already; consistent across Referee and Staff forms. |

## Verified as matching

- The referral label and its example text are identical on all public and
  admin forms (shared `REFERRAL_LABEL` / `REFERRAL_PLACEHOLDER` in
  `lib/reference-data.ts`).
- Bank details: bank name, IBAN, account-holder name, and the IBAN note all
  appear on both sides, everywhere.
- Competition-tier tick boxes ("tiers you will have participants in") appear
  on both the public and admin School and Sensei forms, from one shared
  component.
