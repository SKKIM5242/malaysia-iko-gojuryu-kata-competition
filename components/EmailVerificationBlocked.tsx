"use client";

import { useState, useTransition } from "react";
import { resendMyVerificationEmail } from "@/app/actions/email-verification";

/** Shown instead of the normal page content when a signed-in user's email
 * hasn't been verified yet (see lib/email-verification.ts). */
export default function EmailVerificationBlocked({
  title,
  signOutForm,
}: {
  title: string;
  signOutForm: React.ReactNode;
}) {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
        <p className="font-semibold text-amber-900">Please verify your email address first.</p>
        <p className="mt-1 text-sm text-amber-800">
          We sent a verification link to your email when you created this account. Click it, then
          come back and sign in — until then, sign-in stays blocked for security.
        </p>
        {sent ? (
          <p className="mt-3 text-sm font-semibold text-green-700">Verification email resent — check your inbox.</p>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => {
              await resendMyVerificationEmail();
              setSent(true);
            })}
            className="mt-3 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {pending ? "Sending…" : "Resend verification email"}
          </button>
        )}
      </div>
      <div className="mt-4">{signOutForm}</div>
    </main>
  );
}
