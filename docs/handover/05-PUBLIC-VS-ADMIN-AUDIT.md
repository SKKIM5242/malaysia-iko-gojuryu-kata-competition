# Public vs Admin form audit

Compared the **rendered** field labels of each public registration form against
its admin counterpart (not the source, so component-rendered fields like the
certificate picker and IBAN input are included).

Run on 2026-07-31. The invitation-code Run button is excluded by design —
admin-only, as agreed.

---

## 🔴 The one structural gap: admin cannot register a kata event

**Admin → Participants → Add Participant has no Kata events section at all.**
The public form has three tier columns, each with a Competition Tier plus
1st/2nd/3rd kata event picker. The admin form has none of it.

This is not just a missing UI block. `saveParticipant` in
`app/actions/admin.ts` only ever writes to the `participants` table — it
never creates a row in `registrations`. So a participant added from the admin
panel exists as a *person* but is **entered in nothing**: they will not appear
in the public Confirmed Participants list, cannot record a kata, and produce
no fee, no commission, and no certificate.

Today the only ways a registration gets created are the public participant
form, the public bulk table, and the bulk CSV upload.

Closing this needs a decision first, because the admin path has no Stripe
checkout: **what payment state should an admin-created registration start
in?**

| Option | Effect |
|---|---|
| `pending` | Safest. Shows in admin as awaiting payment; organizer marks paid after money arrives. Does not inflate commission. |
| `paid` | Treats admin entry as already settled. Immediately counts toward the school's/sensei's >10-entries commission. |
| Ask per-entry | A payment-status selector on the form. Most flexible, most room for mistakes. |

Recommendation: **`pending`**, because a registration silently counting toward
a 10% commission payout is the more expensive mistake to make.

---

## Wording differences only — same field, different words

These are cosmetic, but worth aligning since the organizer and the entrant
should be reading the same thing:

| Public | Admin |
|---|---|
| IC / Passport number * | IC / Passport * |
| School / Dojo * | School * |
| Coach / Sensei * | Sensei * |
| International Bank Account No. (IBAN) * | International Bank Account No. (IBAN/SWIFT/BIC/ACH) * |
| Sensei / Coach name * | Name * |
| Latest Rank * | Rank * |
| Mobile / WhatsApp * | Mobile phone * |
| School / organization * | School * |
| Home address * *(both, but public adds the no-comma note)* | Home address * |

## Genuine behaviour differences

| Field | Public | Admin | Note |
|---|---|---|---|
| Latest rank certificate | **required** | optional | Deliberate? An organizer entering someone may not have the file to hand. |
| Rank confirmation | a "my rank matches my certificate" tick box the entrant must accept | a `Rank confirmation` dropdown (Sensei Confirmed / Certificate Uploaded / Pending) | Different mechanisms for the same fact — reasonable, since an organizer is asserting it rather than the entrant. |
| Competition tier | Tier select drives the fee and Stripe checkout | absent (see gap above) | |
| Who is registering? (Sensei form) | asked | not asked | Public-only provenance question. |
| Participant Support referral (Audience) | asked | not asked | |
| International referee certificates | multi-upload | add later via Edit | Documented in the CSV note already. |

## Could not verify

- **Admin → Organizers** renders **zero** form labels without an
  `admin`-role session (`isSuperAdmin` gate), so it could not be diffed.
  Same for the Support create form (`canCreate`). Both need re-checking while
  signed in as admin.

## Verified as matching

- The referral label and its example text are now identical on all six public
  forms and all six admin forms (shared `REFERRAL_LABEL` /
  `REFERRAL_PLACEHOLDER` in `lib/reference-data.ts`).
- Bank details: bank name, IBAN, account-holder name, and the IBAN note all
  appear on both sides.
- Competition-tier tick boxes ("tiers you will have participants in") appear
  on both the public and admin School and Sensei forms, from one shared
  component.
