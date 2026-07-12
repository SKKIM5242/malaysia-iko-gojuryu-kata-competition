"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerSchool, registerSensei, type DirectoryState } from "@/app/actions/directory";
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

function Success({ what, name, next }: { what: string; name: string; next: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
      <p className="text-3xl">✅</p>
      <h2 className="mt-2 text-xl font-bold text-green-900">{what} registered!</h2>
      <p className="mt-2 text-green-800">
        <strong>{name}</strong> is now in the directory and can be selected on registration forms.
      </p>
      <div className="mt-4 text-sm text-green-800">{next}</div>
    </div>
  );
}

export function SchoolForm() {
  const [state, formAction, pending] = useActionState(registerSchool, initial);
  if (state.ok && state.name) {
    return (
      <Success
        what="School / Dojo"
        name={state.name}
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
        <div>
          <label htmlFor="affiliation_code" className={labelCls}>IKO affiliation code (if any)</label>
          <input id="affiliation_code" name="affiliation_code" className={inputCls} placeholder="e.g. IKO-MY-JB-004" />
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

export function SenseiForm({ schools, defaultBy }: { schools: School[]; defaultBy?: string }) {
  const [state, formAction, pending] = useActionState(registerSensei, initial);
  if (state.ok && state.name) {
    return (
      <Success
        what="Sensei / Coach"
        name={state.name}
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
          <label htmlFor="rank" className={labelCls}>Rank</label>
          <input id="rank" name="rank" className={inputCls} placeholder="e.g. Godan" />
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
