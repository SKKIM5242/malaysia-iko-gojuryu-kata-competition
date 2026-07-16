"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerSchool, registerSensei, type DirectoryState } from "@/app/actions/directory";
import { TelegramJoinButton } from "@/components/ui";
import CertificateUploadField from "@/components/CertificateUploadField";
import type { School } from "@/lib/types";

const initial: DirectoryState = { ok: false };
const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
const labelCls = "mb-1 block text-sm font-medium text-neutral-700";

const MALAYSIAN_STATES = [
  "Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka",
  "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang",
  "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu",
];

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

function Success({
  what,
  name,
  next,
  telegramLink,
}: {
  what: string;
  name: string;
  next: React.ReactNode;
  telegramLink: string | null;
}) {
  return (
    <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
      <p className="text-3xl">✅</p>
      <h2 className="mt-2 text-xl font-bold text-green-900">{what} registered!</h2>
      <p className="mt-2 text-green-800">
        <strong>{name}</strong> is now in the directory and can be selected on registration forms.
      </p>
      <div className="mt-4 text-sm text-green-800">{next}</div>
      <div className="mx-auto mt-4 max-w-md text-green-900">
        <TelegramJoinButton href={telegramLink} />
      </div>
    </div>
  );
}

export function SchoolForm({ telegramLink }: { telegramLink: string | null }) {
  const [state, formAction, pending] = useActionState(registerSchool, initial);
  if (state.ok && state.name) {
    return (
      <Success
        what="School / Dojo"
        name={state.name}
        telegramLink={telegramLink}
        next={
          <>
            Next: <Link href="/register/sensei" className="underline">register your Sensei / Coach</Link>,
            then <Link href="/register" className="underline">register participants</Link>.
          </>
        }
      />
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}
      <div>
        <label htmlFor="name" className={labelCls}>School / Dojo name *</label>
        <input id="name" name="name" required className={inputCls} placeholder="e.g. Dojo Goju-ryu Johor Bahru" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="state" className={labelCls}>State</label>
          <select id="state" name="state" defaultValue="" className={inputCls}>
            <option value="">— Select —</option>
            {MALAYSIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm font-bold text-neutral-800">Person in-charge / Chief Instructor</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="contact_title" className={labelCls}>Title *</label>
            <select id="contact_title" name="contact_title" required defaultValue="" className={inputCls}>
              <option value="" disabled>Select</option>
              <option value="Mr.">Mr.</option>
              <option value="Ms.">Ms.</option>
            </select>
          </div>
          <div>
            <label htmlFor="contact_name" className={labelCls}>Name *</label>
            <input id="contact_name" name="contact_name" required className={inputCls} />
          </div>
          <div>
            <label htmlFor="contact_karate_title" className={labelCls}>Karate title *</label>
            <select id="contact_karate_title" name="contact_karate_title" required defaultValue="" className={inputCls}>
              <option value="" disabled>Select</option>
              <option value="Hanshi">Hanshi</option>
              <option value="Shihan">Shihan</option>
              <option value="Sensei">Sensei</option>
            </select>
          </div>
          <div>
            <label htmlFor="contact_rank" className={labelCls}>Rank in karate-do *</label>
            <input id="contact_rank" name="contact_rank" required className={inputCls} placeholder="e.g. Godan" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="school_email" className={labelCls}>Email address *</label>
          <input id="school_email" name="email" type="email" required className={inputCls} placeholder="dojo@example.com" />
        </div>
        <div>
          <label htmlFor="school_phone" className={labelCls}>Mobile phone *</label>
          <input id="school_phone" name="phone" type="tel" required className={inputCls} placeholder="+60…" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="home_address" className={labelCls}>Home address *</label>
          <textarea id="home_address" name="home_address" required rows={2} className={inputCls} />
        </div>
        <div>
          <label htmlFor="city_town" className={labelCls}>City / Town *</label>
          <input id="city_town" name="city_town" required className={inputCls} />
        </div>
        <div>
          <label htmlFor="home_country" className={labelCls}>Home country *</label>
          <input id="home_country" name="home_country" required defaultValue="Malaysia" className={inputCls} />
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
      >
        {pending ? "Registering…" : "Register school / dojo"}
      </button>
    </form>
  );
}

export function SenseiForm({
  schools,
  defaultBy,
  telegramLink,
}: {
  schools: School[];
  defaultBy?: string;
  telegramLink: string | null;
}) {
  const [state, formAction, pending] = useActionState(registerSensei, initial);
  const err = state.fieldErrors ?? {};
  if (state.ok && state.name) {
    return (
      <Success
        what="Sensei / Coach"
        name={state.name}
        telegramLink={telegramLink}
        next={
          <>
            Next: <Link href="/register" className="underline">register participants</Link> or{" "}
            <Link href="/register/bulk" className="underline">bulk-register your students</Link>.
          </>
        }
      />
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.error}
        </div>
      )}
      <div>
        <label htmlFor="registered_by" className={labelCls}>Who is registering? *</label>
        <select
          id="registered_by"
          name="registered_by"
          required
          defaultValue={defaultBy === "self" || defaultBy === "student" ? defaultBy : ""}
          className={inputCls}
        >
          <option value="" disabled>Select</option>
          <option value="self">The sensei / coach themselves (self-registration)</option>
          <option value="student">A student registering their sensei / coach</option>
          <option value="other">School / club representative</option>
        </select>
      </div>
      <div>
        <label htmlFor="name" className={labelCls}>Sensei / Coach name *</label>
        <input id="name" name="name" required className={inputCls} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rank" className={labelCls}>Latest Rank *</label>
          <input id="rank" name="rank" required className={inputCls} placeholder="e.g. Godan" />
          <FieldError message={err.rank} />
        </div>
        <div>
          <label htmlFor="gender" className={labelCls}>Sex *</label>
          <select id="gender" name="gender" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          <FieldError message={err.gender} />
        </div>
        <div>
          <label htmlFor="school_id" className={labelCls}>School / Dojo *</label>
          <select id="school_id" name="school_id" required defaultValue="" className={inputCls}>
            <option value="" disabled>Select school</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.state ? ` — ${s.state}` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sensei_email" className={labelCls}>Email address *</label>
          <input id="sensei_email" name="email" type="email" required className={inputCls} placeholder="name@example.com" />
        </div>
        <div>
          <label htmlFor="sensei_phone" className={labelCls}>Mobile phone *</label>
          <input id="sensei_phone" name="phone" type="tel" required className={inputCls} placeholder="+60…" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="home_address" className={labelCls}>Home address *</label>
          <textarea id="home_address" name="home_address" required rows={2} className={inputCls} />
          <FieldError message={err.home_address} />
        </div>
        <div>
          <label htmlFor="city_town" className={labelCls}>City / Town *</label>
          <input id="city_town" name="city_town" required className={inputCls} />
          <FieldError message={err.city_town} />
        </div>
        <div>
          <label htmlFor="home_country" className={labelCls}>Home country *</label>
          <input id="home_country" name="home_country" required defaultValue="Malaysia" className={inputCls} />
          <FieldError message={err.home_country} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="certificate" className={labelCls}>Latest rank certificate *</label>
          <CertificateUploadField id="certificate" name="certificate" required />
          <FieldError message={err.certificate} />
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        School not in the list? <Link href="/register/school" className="underline">Register it first</Link>.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
      >
        {pending ? "Registering…" : "Register sensei / coach"}
      </button>
    </form>
  );
}
