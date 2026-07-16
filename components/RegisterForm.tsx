"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { submitRegistration, type RegisterState } from "@/app/actions/register";
import { OrganiserContact } from "@/components/ui";
import CertificateUploadField from "@/components/CertificateUploadField";
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

export default function RegisterForm({
  competition,
  categories,
  categoryTaken,
  schools,
  senseis,
  payOnline,
}: {
  competition: Competition;
  categories: Category[];
  categoryTaken: Record<string, number>;
  schools: School[];
  senseis: Sensei[];
  payOnline: boolean;
}) {
  const [state, formAction, pending] = useActionState(submitRegistration, initialState);

  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [beltRank, setBeltRank] = useState("");
  const [kataBase, setKataBase] = useState("");

  // Only shows kata events with a matching, non-full sub-category for the
  // belt rank / date of birth / gender entered so far — resolveCategory()
  // (server-side) uses the exact same matching rules.
  const eligibleKataBases = useMemo(() => {
    if (!beltRank.trim() || !dateOfBirth || !gender || Number.isNaN(Date.parse(dateOfBirth))) return [];
    const age = ageAt(dateOfBirth, competition.event_date);
    const grp = beltGroup(beltRank);
    const genderVal = genderCode(gender);
    const matching = categories.filter(
      (c) =>
        c.belt_group === grp &&
        c.gender === genderVal &&
        c.age_min != null &&
        c.age_max != null &&
        age >= c.age_min &&
        age <= c.age_max &&
        (c.max_participants == null || (categoryTaken[c.id] ?? 0) < c.max_participants),
    );
    const bases = new Set(matching.map((c) => kataBaseOf(c.name)));
    return allKataBasesOf(categories).filter((k) => bases.has(k));
  }, [beltRank, dateOfBirth, gender, categories, categoryTaken, competition.event_date]);

  const detailsComplete = beltRank.trim() !== "" && dateOfBirth !== "" && gender !== "";

  useEffect(() => {
    if (kataBase && !eligibleKataBases.includes(kataBase)) setKataBase("");
  }, [eligibleKataBases, kataBase]);

  if (state.ok && state.referenceId) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
        <p className="text-3xl">✅</p>
        <h2 className="mt-2 text-xl font-bold text-green-900">Registration received!</h2>
        <p className="mt-2 text-green-800">
          Your registration reference ID is{" "}
          <span className="rounded bg-white px-2 py-0.5 font-mono font-bold tracking-wider">
            {state.referenceId}
          </span>
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm text-green-800">
          Payment status is <strong>pending</strong>. Transfer the registration fee and send your
          receipt to the organiser (see the announcement for bank details). The organiser will
          confirm your payment, after which your name appears on the{" "}
          <Link href="/participants" className="underline">participants list</Link>.
        </p>
        <div className="mx-auto max-w-md text-green-900"><OrganiserContact /></div>
      </div>
    );
  }

  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="competition_id" value={competition.id} />

      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="full_name" className={labelCls}>Full name *</label>
          <input id="full_name" name="full_name" required className={inputCls} placeholder="As per IC / passport" />
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
          <label htmlFor="belt_rank" className={labelCls}>Belt rank *</label>
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

        <div className="sm:col-span-2">
          <label htmlFor="home_address" className={labelCls}>Home address *</label>
          <textarea id="home_address" name="home_address" required rows={2} className={inputCls} placeholder="Street address" />
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
          <label htmlFor="kata_base" className={labelCls}>Kata event *</label>
          <select
            id="kata_base"
            name="kata_base"
            required
            className={inputCls}
            value={kataBase}
            onChange={(e) => setKataBase(e.target.value)}
            disabled={!detailsComplete}
          >
            <option value="" disabled>
              {!detailsComplete
                ? "Fill in belt rank, date of birth and gender first"
                : eligibleKataBases.length === 0
                  ? "No kata currently available for your belt / age / gender"
                  : "Select kata"}
            </option>
            {eligibleKataBases.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutral-400">
            Only shows kata events with an open sub-category matching your belt rank
            (Color/Kyu Belt or Black Belt &amp; Dan Holders), age group (4–14, 15–40, 41–65, 66–99)
            and gender — and that still has room.
          </p>
          {detailsComplete && eligibleKataBases.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              No open kata matches your belt rank, age and gender right now — every matching
              sub-category may be full, or none exists for this combination yet. Contact the
              organiser if this seems wrong.
            </p>
          )}
          <FieldError message={err.kata_base} />
        </div>

        <div className="sm:col-span-2 mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-bold text-neutral-800">Bank details for prize / reward payout *</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Winnings are transferred to this account. Kept private — visible to the organiser only.
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
              <input id="bank_account_name" name="bank_account_name" required className={inputCls} placeholder="As per bank records" />
              <FieldError message={err.bank_account_name} />
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
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending
          ? payOnline ? "Redirecting to payment…" : "Submitting…"
          : payOnline
            ? `Proceed to secure payment — USD ${Number(competition.registration_fee_usd ?? 0).toFixed(2)}`
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
