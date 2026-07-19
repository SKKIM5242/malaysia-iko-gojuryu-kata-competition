"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/actions/auth";
import { SiteFooter, SiteHeader } from "@/components/ui";

const initial: ForgotPasswordState = {};

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initial);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Forgot Password</h1>
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          Enter the email address you signed up with (or your IC/Passport number or mobile phone
          number, if you registered one) — we&apos;ll email a password reset link to the address
          on file.
        </p>

        {state.ok ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-6 text-sm text-green-800">
            {state.message}
          </div>
        ) : (
          <form action={formAction} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            {state.message && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {state.message}
              </div>
            )}
            <div>
              <label htmlFor="identifier" className="mb-1 block text-sm font-medium text-neutral-700">
                Email, IC / Passport number, or mobile phone number
              </label>
              <input
                id="identifier"
                name="identifier"
                required
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
                placeholder="e.g. name@example.com, 081234-14-5671, or +60123456789"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm">
          <Link href="/account" className="text-red-700 underline underline-offset-2 hover:text-red-600">
            ← Back to sign in
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
