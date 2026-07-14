"use client";

import { useActionState } from "react";
import {
  registerReferee,
  registerAudience,
  applyStaff,
  type CommunityState,
} from "@/app/actions/community";
import { TelegramJoinButton } from "@/components/ui";

const initial: CommunityState = { ok: false };
const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
const labelCls = "mb-1 block text-sm font-medium text-neutral-700";

function Err({ m }: { m?: string }) {
  return m ? <p className="mt-1 text-xs text-red-600">{m}</p> : null;
}

function Success({
  what,
  refId,
  note,
  telegramLink,
}: {
  what: string;
  refId: string;
  note: string;
  telegramLink: string | null;
}) {
  return (
    <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
      <p className="text-3xl">✅</p>
      <h2 className="mt-2 text-xl font-bold text-green-900">{what} received!</h2>
      <p className="mt-2 text-green-800">
        Reference ID:{" "}
        <span className="rounded bg-white px-2 py-0.5 font-mono font-bold tracking-wider">{refId}</span>
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm text-green-800">{note}</p>
      <div className="mx-auto max-w-md text-green-900">
        <TelegramJoinButton href={telegramLink} />
      </div>
    </div>
  );
}

export function RefereeForm({ telegramLink }: { telegramLink: string | null }) {
  const [state, formAction, pending] = useActionState(registerReferee, initial);
  if (state.ok && state.referenceId) {
    return (
      <Success
        what="Referee / judge registration"
        refId={state.referenceId}
        telegramLink={telegramLink}
        note="The organiser will review your registration and contact you about the USD 100 deposit (or confirm your invitation code). Remember: the USD 100 is a deposit for participants — for non-participants it will be forfeited."
      />
    );
  }
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="full_name" className={labelCls}>Full name *</label>
          <input id="full_name" name="full_name" required className={inputCls} />
          <Err m={e.full_name} />
        </div>
        <div>
          <label htmlFor="ic_passport" className={labelCls}>IC / Passport *</label>
          <input id="ic_passport" name="ic_passport" required className={inputCls} />
          <Err m={e.ic_passport} />
        </div>
        <div>
          <label htmlFor="date_of_birth" className={labelCls}>Date of birth *</label>
          <input id="date_of_birth" name="date_of_birth" type="date" required className={inputCls} />
          <Err m={e.date_of_birth} />
        </div>
        <div>
          <label htmlFor="gender" className={labelCls}>Gender *</label>
          <select id="gender" name="gender" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <Err m={e.gender} />
        </div>
        <div>
          <label htmlFor="karate_rank" className={labelCls}>Karate rank *</label>
          <input id="karate_rank" name="karate_rank" required className={inputCls} placeholder="e.g. Godan" />
          <Err m={e.karate_rank} />
        </div>
        <div>
          <label htmlFor="judging_experience_count" className={labelCls}>
            No. of times taking part in judging Kata competition *
          </label>
          <input id="judging_experience_count" name="judging_experience_count" type="number" min="0" step="1" required className={inputCls} placeholder="e.g. 5 (0 if none)" />
          <Err m={e.judging_experience_count} />
        </div>
        <div>
          <label htmlFor="school" className={labelCls}>School / organisation</label>
          <input id="school" name="school" className={inputCls} />
        </div>
        <div>
          <label htmlFor="certificate" className={labelCls}>
            Latest rank certificate * <span className="font-normal text-neutral-400">(photo or file)</span>
          </label>
          <input id="certificate" name="certificate" type="file" accept="image/*,application/pdf" capture="environment" required
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white" />
          <Err m={e.certificate} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="international_certificates" className={labelCls}>
            International certified Referee / Judge certificates{" "}
            <span className="font-normal text-neutral-400">(optional — unlimited uploads)</span>
          </label>
          <input id="international_certificates" name="international_certificates" type="file" accept="image/*,application/pdf" multiple
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white" />
          <p className="mt-1 text-xs text-neutral-400">Select multiple files at once, or add this field again later — not required.</p>
        </div>
        <div>
          <label htmlFor="email" className={labelCls}>Email *</label>
          <input id="email" name="email" type="email" required className={inputCls} />
          <Err m={e.email} />
        </div>
        <div>
          <label htmlFor="phone" className={labelCls}>Mobile / WhatsApp *</label>
          <input id="phone" name="phone" required className={inputCls} placeholder="+60…" />
          <Err m={e.phone} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="home_address" className={labelCls}>Home address *</label>
          <textarea id="home_address" name="home_address" required rows={2} className={inputCls} />
          <Err m={e.home_address} />
        </div>
        <div>
          <label htmlFor="city_town" className={labelCls}>City / Town *</label>
          <input id="city_town" name="city_town" required className={inputCls} />
          <Err m={e.city_town} />
        </div>
        <div>
          <label htmlFor="home_country" className={labelCls}>Home country *</label>
          <input id="home_country" name="home_country" required defaultValue="Malaysia" className={inputCls} />
          <Err m={e.home_country} />
        </div>

        <div className="sm:col-span-2 rounded-md border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-bold text-neutral-800">
            Bank details — for return of the USD 100 deposit &amp; referee/judge reward *
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="bank_name" className={labelCls}>Bank name *</label>
              <input id="bank_name" name="bank_name" required className={inputCls} />
              <Err m={e.bank_name} />
            </div>
            <div>
              <label htmlFor="bank_account_no" className={labelCls}>Bank account no. *</label>
              <input id="bank_account_no" name="bank_account_no" required className={inputCls} />
              <Err m={e.bank_account_no} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="bank_account_name" className={labelCls}>Account holder name *</label>
              <input id="bank_account_name" name="bank_account_name" required className={inputCls} />
              <Err m={e.bank_account_name} />
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="invitation_code" className={labelCls}>
            Invitation code <span className="font-normal text-neutral-400">(register free — USD 0 — by invitation only)</span>
          </label>
          <input id="invitation_code" name="invitation_code" className={inputCls} />
        </div>
      </div>
      <button type="submit" disabled={pending}
        className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60">
        {pending ? "Submitting…" : "Submit referee / judge registration"}
      </button>
    </form>
  );
}

export function AudienceForm({ telegramLink }: { telegramLink: string | null }) {
  const [state, formAction, pending] = useActionState(registerAudience, initial);
  if (state.ok && state.referenceId) {
    return (
      <Success
        what="Audience registration"
        refId={state.referenceId}
        telegramLink={telegramLink}
        note="The organiser will confirm your USD 10 sign-in (or your invitation code) and share viewing access details."
      />
    );
  }
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="full_name" className={labelCls}>Full name *</label>
          <input id="full_name" name="full_name" required className={inputCls} />
          <Err m={e.full_name} />
        </div>
        <div>
          <label htmlFor="email" className={labelCls}>Email *</label>
          <input id="email" name="email" type="email" required className={inputCls} />
          <Err m={e.email} />
        </div>
        <div>
          <label htmlFor="phone" className={labelCls}>Mobile / WhatsApp</label>
          <input id="phone" name="phone" className={inputCls} placeholder="+60…" />
        </div>
        <div>
          <label htmlFor="home_country" className={labelCls}>Home country *</label>
          <input id="home_country" name="home_country" required defaultValue="Malaysia" className={inputCls} />
          <Err m={e.home_country} />
        </div>
        <div>
          <label htmlFor="invitation_code" className={labelCls}>
            Invitation code <span className="font-normal text-neutral-400">(free with code)</span>
          </label>
          <input id="invitation_code" name="invitation_code" className={inputCls} />
        </div>
      </div>
      <button type="submit" disabled={pending}
        className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60">
        {pending ? "Submitting…" : "Register as audience — USD 10"}
      </button>
    </form>
  );
}

export function StaffForm({ telegramLink }: { telegramLink: string | null }) {
  const [state, formAction, pending] = useActionState(applyStaff, initial);
  if (state.ok && state.referenceId) {
    return (
      <Success
        what="Application"
        refId={state.referenceId}
        telegramLink={telegramLink}
        note="The organiser will review your application and contact you."
      />
    );
  }
  const e = state.fieldErrors ?? {};
  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{state.error}</div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="full_name" className={labelCls}>Full name *</label>
          <input id="full_name" name="full_name" required className={inputCls} />
          <Err m={e.full_name} />
        </div>
        <div>
          <label htmlFor="ic_passport" className={labelCls}>IC / Passport *</label>
          <input id="ic_passport" name="ic_passport" required className={inputCls} />
          <Err m={e.ic_passport} />
        </div>
        <div>
          <label htmlFor="date_of_birth" className={labelCls}>Date of birth *</label>
          <input id="date_of_birth" name="date_of_birth" type="date" required className={inputCls} />
          <Err m={e.date_of_birth} />
        </div>
        <div>
          <label htmlFor="gender" className={labelCls}>Gender *</label>
          <select id="gender" name="gender" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <Err m={e.gender} />
        </div>
        <div>
          <label htmlFor="karate_rank" className={labelCls}>
            Latest Rank <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <input id="karate_rank" name="karate_rank" className={inputCls} placeholder="e.g. Godan" />
        </div>
        <div>
          <label htmlFor="school" className={labelCls}>School / organisation</label>
          <input id="school" name="school" className={inputCls} />
        </div>
        <div>
          <label htmlFor="certificate" className={labelCls}>
            Latest rank certificate <span className="font-normal text-neutral-400">(optional — photo or file)</span>
          </label>
          <input id="certificate" name="certificate" type="file" accept="image/*,application/pdf" capture="environment"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white" />
        </div>
        <div>
          <label htmlFor="international_certificates" className={labelCls}>
            International certificates{" "}
            <span className="font-normal text-neutral-400">(optional — unlimited uploads)</span>
          </label>
          <input id="international_certificates" name="international_certificates" type="file" accept="image/*,application/pdf" multiple
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white" />
        </div>
        <div>
          <label htmlFor="email" className={labelCls}>Email *</label>
          <input id="email" name="email" type="email" required className={inputCls} />
          <Err m={e.email} />
        </div>
        <div>
          <label htmlFor="phone" className={labelCls}>Mobile / WhatsApp *</label>
          <input id="phone" name="phone" required className={inputCls} placeholder="+60…" />
          <Err m={e.phone} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="home_address" className={labelCls}>Home address *</label>
          <textarea id="home_address" name="home_address" required rows={2} className={inputCls} />
          <Err m={e.home_address} />
        </div>
        <div>
          <label htmlFor="city_town" className={labelCls}>City / Town *</label>
          <input id="city_town" name="city_town" required className={inputCls} />
          <Err m={e.city_town} />
        </div>
        <div>
          <label htmlFor="home_country" className={labelCls}>Home country *</label>
          <input id="home_country" name="home_country" required defaultValue="Malaysia" className={inputCls} />
          <Err m={e.home_country} />
        </div>

        <div className="sm:col-span-2 rounded-md border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm font-bold text-neutral-800">Bank details *</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="bank_name" className={labelCls}>Bank name *</label>
              <input id="bank_name" name="bank_name" required className={inputCls} />
              <Err m={e.bank_name} />
            </div>
            <div>
              <label htmlFor="bank_account_no" className={labelCls}>Bank account no. *</label>
              <input id="bank_account_no" name="bank_account_no" required className={inputCls} />
              <Err m={e.bank_account_no} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="bank_account_name" className={labelCls}>Account holder name *</label>
              <input id="bank_account_name" name="bank_account_name" required className={inputCls} />
              <Err m={e.bank_account_name} />
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="role_requested" className={labelCls}>Role *</label>
          <select id="role_requested" name="role_requested" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select role</option>
            <option value="admin">Admin</option>
            <option value="organizer">Organizer</option>
            <option value="customer_support">Customer Support</option>
          </select>
          <Err m={e.role_requested} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="message" className={labelCls}>Message / experience</label>
          <textarea id="message" name="message" rows={3} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="invitation_code" className={labelCls}>Invitation code (optional)</label>
          <input id="invitation_code" name="invitation_code" className={inputCls} />
        </div>
      </div>
      <button type="submit" disabled={pending}
        className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60">
        {pending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
