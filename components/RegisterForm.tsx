"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { submitRegistration, type RegisterState } from "@/app/actions/register";
import { OrganizerContact, formatUSD } from "@/components/ui";
import CertificateUploadField from "@/components/CertificateUploadField";
import { NoCommaTextarea } from "@/components/NoCommaAddressField";
import { ageAt, beltGroup, genderCode, kataBaseOf, kataBases as allKataBasesOf } from "@/lib/division";
import type { Category, Competition, School, Sensei } from "@/lib/types";

const initialState: RegisterState = { ok: false };

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
const labelCls = "mb-1 block text-sm font-medium text-neutral-700";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

/** Per-tier 1st/2nd/3rd kata event picks, keyed by that tier's own
 * competition id. Tier 1 (the first entry in `competitions`) is the only
 * one where the 1st event is required — every other tier is entirely
 * optional (a Sensei/participant registering for extra tiers to save a
 * second trip through this form). */
type TierKatas = [string, string, string];

export default function RegisterForm({
  competitions,
  categoriesByCompetition,
  categoryTakenByCompetition,
  schools,
  senseis,
  payOnline,
}: {
  competitions: Competition[];
  categoriesByCompetition: Record<string, Category[]>;
  categoryTakenByCompetition: Record<string, Record<string, number>>;
  schools: School[];
  senseis: Sensei[];
  payOnline: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitRegistration, initialState);

  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [beltRank, setBeltRank] = useState("");
  const [tierKatas, setTierKatas] = useState<Record<string, TierKatas>>(() =>
    Object.fromEntries(competitions.map((c) => [c.id, ["", "", ""] as TierKatas])),
  );
  const [fullName, setFullName] = useState("");
  const [otherBankName, setOtherBankName] = useState(false);
  const [bankAccountName, setBankAccountName] = useState("");

  // The bank account holder name defaults to (and is locked to) the
  // participant's own Full name, so reward payouts can't silently go to
  // someone else's account — unlocked only by the consent checkbox below.
  useEffect(() => {
    if (!otherBankName) setBankAccountName(fullName);
  }, [fullName, otherBankName]);

  const detailsComplete = beltRank.trim() !== "" && dateOfBirth !== "" && gender !== "";

  const setTierKata = (competitionId: string, slot: 0 | 1 | 2, value: string) =>
    setTierKatas((prev) => {
      const next: TierKatas = [...(prev[competitionId] ?? ["", "", ""])] as TierKatas;
      next[slot] = value;
      return { ...prev, [competitionId]: next };
    });

  // Only shows kata events with a matching, non-full sub-category for the
  // belt rank / date of birth / gender entered so far — resolveCategory()
  // (server-side) uses the exact same matching rules — computed separately
  // per tier since each tier has its own category set/room.
  const eligibleByTier = useMemo(() => {
    const result: Record<string, string[]> = {};
    if (!detailsComplete || Number.isNaN(Date.parse(dateOfBirth))) {
      for (const c of competitions) result[c.id] = [];
      return result;
    }
    const grp = beltGroup(beltRank);
    const genderVal = genderCode(gender);
    for (const c of competitions) {
      const categories = categoriesByCompetition[c.id] ?? [];
      const categoryTaken = categoryTakenByCompetition[c.id] ?? {};
      const age = ageAt(dateOfBirth, c.event_date);
      const matching = categories.filter(
        (cat) =>
          cat.belt_group === grp &&
          cat.gender === genderVal &&
          cat.age_min != null &&
          cat.age_max != null &&
          age >= cat.age_min &&
          age <= cat.age_max &&
          (cat.max_participants == null || (categoryTaken[cat.id] ?? 0) < cat.max_participants),
      );
      const bases = new Set(matching.map((cat) => kataBaseOf(cat.name)));
      result[c.id] = allKataBasesOf(categories).filter((k) => bases.has(k));
    }
    return result;
  }, [detailsComplete, dateOfBirth, gender, beltRank, competitions, categoriesByCompetition, categoryTakenByCompetition]);

  // Reset a tier's picks that are no longer eligible (belt/DOB/gender
  // changed) or that have become a duplicate within the same tier.
  useEffect(() => {
    setTierKatas((prev) => {
      let changed = false;
      const next: Record<string, TierKatas> = { ...prev };
      for (const c of competitions) {
        const eligible = eligibleByTier[c.id] ?? [];
        const current = prev[c.id] ?? ["", "", ""];
        const fixed: TierKatas = ["", "", ""];
        const seen = new Set<string>();
        for (let i = 0; i < 3; i++) {
          const v = current[i];
          if (v && eligible.includes(v) && !seen.has(v)) {
            fixed[i] = v;
            seen.add(v);
          }
        }
        if (fixed.some((v, i) => v !== current[i])) changed = true;
        next[c.id] = fixed;
      }
      return changed ? next : prev;
    });
  }, [eligibleByTier, competitions]);

  const tierEventCounts = competitions.map((c) => (tierKatas[c.id] ?? ["", "", ""]).filter(Boolean).length);
  const tier1Events = tierEventCounts[0] ?? 0;
  const totalFee = competitions.reduce((sum, c, i) => {
    const events = i === 0 ? Math.max(1, tierEventCounts[i] ?? 0) : (tierEventCounts[i] ?? 0);
    return sum + events * Number(c.registration_fee_usd ?? 0);
  }, 0);
  const totalEvents = competitions.reduce((sum, _c, i) => sum + (i === 0 ? Math.max(1, tierEventCounts[i] ?? 0) : (tierEventCounts[i] ?? 0)), 0);

  if (state.ok && state.referenceIds && state.referenceIds.length > 0) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
        <p className="text-3xl">✅</p>
        <h2 className="mt-2 text-xl font-bold text-green-900">Registration received!</h2>
        <p className="mt-2 text-green-800">
          Your registration reference ID{state.referenceIds.length > 1 ? "s are" : " is"}{" "}
          {state.referenceIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <span className="rounded bg-white px-2 py-0.5 font-mono font-bold tracking-wider">{id}</span>
            </span>
          ))}
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm text-green-800">
          Payment status is <strong>pending</strong>. Transfer the registration fee and send your
          receipt to the organizer (see the announcement for bank details). The organizer will
          confirm your payment, after which your name appears on the{" "}
          <Link href="/participants" className="underline">participants list</Link>.
        </p>
        <div className="mx-auto max-w-md text-green-900"><OrganizerContact /></div>
      </div>
    );
  }

  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      {competitions.map((c, i) => (
        <input key={c.id} type="hidden" name={`competition_id_${i}`} value={c.id} />
      ))}

      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="full_name" className={labelCls}>
            Full name *{" "}
            <span className="font-normal text-neutral-400">
              (must match your IC / Passport, and your bank account name for reward payout)
            </span>
          </label>
          <input
            id="full_name"
            name="full_name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputCls}
            placeholder="As per IC / passport"
          />
          <FieldError message={err.full_name} />
        </div>

        <div>
          <label htmlFor="ic_passport" className={labelCls}>IC / Passport number *</label>
          <input id="ic_passport" name="ic_passport" required className={inputCls} placeholder="e.g. 081234-14-5671" />
          <FieldError message={err.ic_passport} />
        </div>

        <div>
          <label htmlFor="date_of_birth" className={labelCls}>Date of birth *</label>
          <input
            id="date_of_birth"
            name="date_of_birth"
            type="date"
            required
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className={inputCls}
          />
          <FieldError message={err.date_of_birth} />
        </div>

        <div>
          <label htmlFor="age" className={labelCls}>Age (based on D.O.B) *</label>
          <input
            id="age"
            readOnly
            value={dateOfBirth && !Number.isNaN(Date.parse(dateOfBirth)) ? ageAt(dateOfBirth, null) : ""}
            placeholder="Fill in date of birth first"
            className={`${inputCls} cursor-not-allowed bg-neutral-100 text-neutral-500`}
          />
        </div>

        <div>
          <label htmlFor="gender" className={labelCls}>Gender *</label>
          <select
            id="gender"
            name="gender"
            required
            className={inputCls}
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          >
            <option value="" disabled>Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <FieldError message={err.gender} />
        </div>

        <div>
          <label htmlFor="belt_rank" className={labelCls}>Latest Belt rank *</label>
          <input
            id="belt_rank"
            name="belt_rank"
            required
            value={beltRank}
            onChange={(e) => setBeltRank(e.target.value)}
            className={inputCls}
            placeholder="e.g. 3rd Kyu, 1st Dan"
          />
          <FieldError message={err.belt_rank} />
        </div>

        <div>
          <label htmlFor="email" className={labelCls}>Email address *</label>
          <input id="email" name="email" type="email" required className={inputCls} placeholder="name@example.com" />
          <FieldError message={err.email} />
        </div>

        <div>
          <label htmlFor="phone" className={labelCls}>Mobile phone *</label>
          <input id="phone" name="phone" type="tel" required className={inputCls} placeholder="+60…" />
          <FieldError message={err.phone} />
        </div>

        <div>
          <label htmlFor="certificate" className={labelCls}>Latest rank certificate *</label>
          <CertificateUploadField id="certificate" name="certificate" required />
          <FieldError message={err.certificate} />
        </div>

        <div className="sm:col-span-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <label htmlFor="rank_matches_certificate" className="flex items-start gap-2 text-xs text-neutral-700">
            <input id="rank_matches_certificate" name="rank_matches_certificate" type="checkbox" required className="mt-0.5" />
            <span>
              I confirm the Latest Belt Rank I entered above matches what is stated on my uploaded
              certificate — if it&apos;s not in English, I&apos;ve translated it first (use the
              language button in the site header) before confirming.{" "}
              <strong>A participant may be disqualified from the event they take part in if the
              Latest Belt Rank does not match the certificate, or is submitted without Sensei
              confirmation. If the participant&apos;s Latest Belt Rank and certificate do not match,
              the participant will be disqualified and will have to register again with matching
              data.</strong> *
            </span>
          </label>
          <p className="mt-1.5 text-xs text-neutral-400">
            Rank doesn&apos;t match your certificate, or you&apos;re not sure? Ask your Sensei to
            register you instead via{" "}
            <a href="/register/bulk" className="font-semibold underline underline-offset-2">
              Bulk registration
            </a>{" "}
            — your Sensei can confirm your rank directly there without needing to individually
            verify the certificate image.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="home_address" className={labelCls}>
            Home address *{" "}
            <span className="font-normal text-neutral-400">(no comma &quot;,&quot; allowed in the box)</span>
          </label>
          <NoCommaTextarea id="home_address" className={inputCls} placeholder="Street address" />
          <FieldError message={err.home_address} />
        </div>

        <div>
          <label htmlFor="city_town" className={labelCls}>City / Town *</label>
          <input id="city_town" name="city_town" required className={inputCls} placeholder="e.g. Kuala Lumpur" />
          <FieldError message={err.city_town} />
        </div>

        <div>
          <label htmlFor="postcode" className={labelCls}>Postcode *</label>
          <input id="postcode" name="postcode" required className={inputCls} placeholder="e.g. 50000" />
          <FieldError message={err.postcode} />
        </div>

        <div>
          <label htmlFor="home_country" className={labelCls}>Home country *</label>
          <input id="home_country" name="home_country" required defaultValue="Malaysia" className={inputCls} />
          <FieldError message={err.home_country} />
        </div>

        <div>
          <label htmlFor="school_id" className={labelCls}>School / Dojo *</label>
          <select id="school_id" name="school_id" required className={inputCls} defaultValue="">
            <option value="" disabled>Select school</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.state ? ` — ${s.state}` : ""}</option>
            ))}
          </select>
          <FieldError message={err.school_id} />
        </div>

        <div>
          <label htmlFor="sensei_id" className={labelCls}>Coach / Sensei *</label>
          <select id="sensei_id" name="sensei_id" required className={inputCls} defaultValue="">
            <option value="" disabled>Select sensei</option>
            {senseis.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.rank ? ` (${s.rank})` : ""}</option>
            ))}
          </select>
          <FieldError message={err.sensei_id} />
        </div>

        <div className="sm:col-span-2">
          <p className={labelCls}>
            Kata event{competitions.length > 1 ? "s" : ""} *{" "}
            <span className="font-normal text-neutral-400">
              {competitions.length > 1
                ? "— tier 1 is required; registering for extra tiers here saves you filling this form again"
                : ""}
            </span>
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {competitions.map((c, i) => {
              const isRequiredTier = i === 0;
              const katas = tierKatas[c.id] ?? ["", "", ""];
              const eligible = eligibleByTier[c.id] ?? [];
              const eligible2 = eligible.filter((k) => k !== katas[0]);
              const eligible3 = eligible.filter((k) => k !== katas[0] && k !== katas[1]);
              return (
                <div key={c.id} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <label className="mb-1 block text-xs font-medium text-neutral-700">
                    Competition Tier{isRequiredTier ? " *" : " (optional)"}
                  </label>
                  <input
                    readOnly
                    value={`${c.name} — ${formatUSD(c.registration_fee_usd)}/event`}
                    className="mb-3 w-full rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1.5 text-xs text-neutral-600"
                  />

                  <label htmlFor={`kata_${i}_1`} className="mb-1 block text-xs font-medium text-neutral-700">
                    1st Kata event{isRequiredTier ? " *" : " (optional)"}
                  </label>
                  <select
                    id={`kata_${i}_1`}
                    name={`kata_${i}_1`}
                    required={isRequiredTier}
                    className={`${inputCls} mb-2 text-sm`}
                    value={katas[0]}
                    onChange={(e) => setTierKata(c.id, 0, e.target.value)}
                    disabled={!detailsComplete}
                  >
                    <option value="" disabled={isRequiredTier}>
                      {!detailsComplete
                        ? "Fill in belt rank, date of birth & gender first"
                        : eligible.length === 0
                          ? "No kata currently available for your belt / age / gender"
                          : isRequiredTier
                            ? "Select kata"
                            : "— None — skip this tier —"}
                    </option>
                    {eligible.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>

                  <label htmlFor={`kata_${i}_2`} className="mb-1 block text-xs font-medium text-neutral-700">
                    2nd Kata event (optional)
                  </label>
                  <select
                    id={`kata_${i}_2`}
                    name={`kata_${i}_2`}
                    className={`${inputCls} mb-2 text-sm`}
                    value={katas[1]}
                    onChange={(e) => setTierKata(c.id, 1, e.target.value)}
                    disabled={!detailsComplete || !katas[0]}
                  >
                    <option value="">— None —</option>
                    {eligible2.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>

                  <label htmlFor={`kata_${i}_3`} className="mb-1 block text-xs font-medium text-neutral-700">
                    3rd Kata event (optional)
                  </label>
                  <select
                    id={`kata_${i}_3`}
                    name={`kata_${i}_3`}
                    className={`${inputCls} text-sm`}
                    value={katas[2]}
                    onChange={(e) => setTierKata(c.id, 2, e.target.value)}
                    disabled={!detailsComplete || !katas[1]}
                  >
                    <option value="">— None —</option>
                    {eligible3.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-neutral-400">
            Only shows kata events with an open sub-category matching your belt rank
            (Color/Kyu Belt or Black Belt &amp; Dan Holders), age group (4–14, 15–40, 41–65, 66–99)
            and gender — and that still has room.
          </p>
          {detailsComplete && (eligibleByTier[competitions[0]?.id] ?? []).length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              No open kata matches your belt rank, age and gender right now for tier 1 — every
              matching sub-category may be full, or none exists for this combination yet. Contact
              the organizer if this seems wrong.
            </p>
          )}
          <FieldError message={err.kata_base} />
        </div>

        <div className="sm:col-span-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Registering for {totalEvents} kata event{totalEvents === 1 ? "" : "s"} across{" "}
          {tierEventCounts.filter((n, i) => (i === 0 ? true : n > 0)).length} tier
          {tierEventCounts.filter((n, i) => (i === 0 ? true : n > 0)).length === 1 ? "" : "s"} — total fee USD{" "}
          {totalFee.toFixed(2)}.
        </div>

        <div className="sm:col-span-2 mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-bold text-neutral-800">Bank details for prize / reward payout *</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Winnings are transferred to this account after 1 month of the winner announcement. Kept
            private — visible to the organizer only.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="bank_name" className={labelCls}>Bank name *</label>
              <input id="bank_name" name="bank_name" required className={inputCls} placeholder="e.g. Maybank" />
              <FieldError message={err.bank_name} />
            </div>
            <div>
              <label htmlFor="bank_account_no" className={labelCls}>Bank account no. *</label>
              <input id="bank_account_no" name="bank_account_no" required className={inputCls} placeholder="e.g. 5121-2345-6789" />
              <FieldError message={err.bank_account_no} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="bank_account_name" className={labelCls}>Bank account holder name *</label>
              <input
                id="bank_account_name"
                name="bank_account_name"
                required
                readOnly={!otherBankName}
                value={bankAccountName}
                onChange={(e) => setBankAccountName(e.target.value)}
                className={`${inputCls} ${!otherBankName ? "cursor-not-allowed bg-neutral-100 text-neutral-500" : ""}`}
                placeholder="As per bank records"
              />
              <p className="mt-1 text-xs text-neutral-400">
                Auto-filled from your Full name above and locked — tick the box below if the payout
                account is under a different name.
              </p>
              <FieldError message={err.bank_account_name} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="consent_other_bank_name" className="flex items-start gap-2 text-xs text-neutral-700">
                <input
                  id="consent_other_bank_name"
                  type="checkbox"
                  checked={otherBankName}
                  onChange={(e) => setOtherBankName(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I give consent to the organizer to pay my winnings to a bank account under a
                  different name than my own (e.g. a parent/guardian&apos;s account). Only tick this
                  if the account holder name needs to differ from your Full name above.
                </span>
              </label>
            </div>
          </div>
        </div>

        {!payOnline && (
          <div className="sm:col-span-2">
            <label htmlFor="payment_reference" className={labelCls}>
              Bank transfer reference <span className="font-normal text-neutral-400">(optional — add it if you already paid)</span>
            </label>
            <input id="payment_reference" name="payment_reference" className={inputCls} placeholder="e.g. MAYB-20250815-123" />
          </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor="referral_source" className={labelCls}>
            Referral / Where did you hear about this competition?{" "}
            <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <input id="referral_source" name="referral_source" className={inputCls} placeholder="e.g. a friend's name" />
          <p className="mt-1 text-xs text-neutral-400">
            Please don&apos;t name your own Dojo&apos;s PIC or Sensei here — if a friend told you
            about this competition, give their name instead.
          </p>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending || tier1Events === 0}
        className="w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending
          ? payOnline ? "Redirecting to payment…" : "Submitting…"
          : payOnline
            ? `Proceed to secure payment — USD ${totalFee.toFixed(2)} (${totalEvents} event${totalEvents === 1 ? "" : "s"})`
            : "Submit registration"}
      </button>
      {payOnline && (
        <p className="text-xs text-neutral-400">
          Your registration is only submitted after the payment succeeds. Payments are processed
          securely by Stripe (card / FPX); we never see your card details.
        </p>
      )}
    </form>
  );
}
