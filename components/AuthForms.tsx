"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
const labelCls = "mb-1 block text-sm font-medium text-neutral-700";

/** Only participant/referee/audience/school/sensei create a login account
 * through this form. Organizer/Customer Support are admin-only accounts
 * with their own dedicated pages — selecting one here just links out to it.
 * School/Sensei directory records (with bank/contact details) are still
 * created separately on their own registration page — this is the *second*
 * step, signing in to view their own students' recordings, which needs a
 * personal invitation code generated from that existing directory record. */
const REDIRECT_ROLES: Record<string, { label: string; href: string; blurb: string }> = {
  organizer: {
    label: "Organizer",
    href: "/register/staff",
    blurb: "Admin/Organizer accounts have no self-signup — submit an application for the organiser to review.",
  },
  customer_support: {
    label: "Customer Services Support",
    href: "/register/staff",
    blurb: "Customer Support accounts have no self-signup — submit an application for the organiser to review.",
  },
};

export default function AuthForms({ defaultMode = "signin" }: { defaultMode?: "signin" | "signup" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">(defaultMode);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [role, setRole] = useState("participant");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const supabase = createClient();
    try {
      if (form.get("not_a_robot") !== "on") {
        throw new Error("Please confirm you are not a robot or AI.");
      }
      if (mode === "signup") {
        if (form.get("terms_accepted") !== "on") {
          throw new Error("Please accept the Terms & Conditions to create an account.");
        }
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: String(form.get("full_name") ?? "").trim(),
              country: String(form.get("country") ?? "").trim(),
              role: String(form.get("role") ?? "participant"),
              invite_code: String(form.get("invite_code") ?? "").trim(),
              terms_accepted: true,
            },
          },
        });
        if (err) throw err;
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-lg border border-neutral-300 text-center text-sm font-semibold">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={mode === "signin" ? "bg-red-700 py-2.5 text-white" : "bg-white py-2.5 text-neutral-600 hover:bg-neutral-50"}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={mode === "signup" ? "bg-red-700 py-2.5 text-white" : "bg-white py-2.5 text-neutral-600 hover:bg-neutral-50"}
        >
          Create account
        </button>
      </div>

      <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
        <p className="font-bold">Note</p>
        <p className="mt-1">
          For your security, staying signed in with no activity for 30 minutes will automatically
          sign you out.
        </p>
        <p className="mt-1">
          <strong>Audience / Spectator</strong> accounts are charged per sign-in — some have a
          limited number of sign-ins, and once used up that account can no longer sign in. A new
          subscription is necessary.
        </p>
        <p className="mt-1">
          <strong>Participants</strong> competing in the Kata Competition have unlimited sign-in
          to view only.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}
        {mode === "signup" && (
          <div>
            <label htmlFor="auth_role" className={labelCls}>I am registering as *</label>
            <select
              id="auth_role"
              name="role"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputCls}
            >
              <option value="school">School / Dojo / Club</option>
              <option value="sensei">Sensei / Shihan / Hanshi</option>
              <option value="participant">Participant (record my kata)</option>
              <option value="referee">Referee / Judge</option>
              <option value="audience">Audience / Spectator (view Kata Arena)</option>
              <option value="customer_support">Customer Services Support</option>
              <option value="organizer">Organizer</option>
            </select>
            <p className="mt-1 text-xs text-neutral-400">
              Referee/Judge and Audience accounts need the organiser&apos;s approval before they
              activate — unless you have an invitation code below. Once approved, sign-in is
              unlimited and free.
            </p>
          </div>
        )}
        {mode === "signup" && (role === "school" || role === "sensei") && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p>
              Signing in here is the second step — your School/Sensei must already be registered
              in the directory (with contact and bank details) before you can get a personal
              invitation code from your own record&apos;s Edit page. That code links this login to
              your students only.
            </p>
            <p className="mt-1">
              A USD 10 registration fee unlocks unlimited sign-in to watch your own students&apos;
              kata recordings and judge scores as they come in — no waiting for winners day. Get
              10 or more participants signed up under your school/sensei and you qualify for a 10%
              share of their registration fees.
            </p>
          </div>
        )}
        {mode === "signup" && REDIRECT_ROLES[role] ? (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
            <p>{REDIRECT_ROLES[role].blurb}</p>
            <Link
              href={REDIRECT_ROLES[role].href}
              className="mt-3 inline-block rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
            >
              Go to {REDIRECT_ROLES[role].label} registration →
            </Link>
          </div>
        ) : (
          <>
            {mode === "signup" && (role === "referee" || role === "audience") && (
              <div>
                <label htmlFor="auth_invite" className={labelCls}>Invitation code (optional)</label>
                <input id="auth_invite" name="invite_code" className={inputCls} placeholder="e.g. IKO-JUDGE-2026" />
                <p className="mt-1 text-xs text-neutral-400">
                  A valid code activates your account immediately — no payment, no waiting for approval.
                </p>
              </div>
            )}
            {mode === "signup" && (role === "school" || role === "sensei") && (
              <div>
                <label htmlFor="auth_invite" className={labelCls}>Invitation code *</label>
                <input id="auth_invite" name="invite_code" required className={inputCls} placeholder="e.g. SCHOOL-4F9A2B" />
                <p className="mt-1 text-xs text-neutral-400">
                  Required — get this from your school/sensei&apos;s own record on the admin site
                  (ask the organiser if you don&apos;t have one yet). It's what links this account
                  to your students only.
                </p>
              </div>
            )}
            {mode === "signup" && (
              <>
                <div>
                  <label htmlFor="auth_name" className={labelCls}>Full name *</label>
                  <input id="auth_name" name="full_name" required className={inputCls} />
                </div>
                <div>
                  <label htmlFor="auth_country" className={labelCls}>Country *</label>
                  <input id="auth_country" name="country" required defaultValue="Malaysia" className={inputCls} />
                </div>
              </>
            )}
            <div>
              <label htmlFor="auth_email" className={labelCls}>Email *</label>
              <input id="auth_email" name="email" type="email" required autoComplete="email" className={inputCls} />
            </div>
            <div>
              <label htmlFor="auth_password" className={labelCls}>Password *</label>
              <input
                id="auth_password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className={inputCls}
              />
              {mode === "signin" && (
                <Link
                  href="/account/forgot-password"
                  className="mt-1 inline-block text-xs font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            {mode === "signup" && (
              <label htmlFor="terms_accepted" className="flex items-start gap-2 text-xs text-neutral-600">
                <input id="terms_accepted" name="terms_accepted" type="checkbox" required className="mt-0.5" />
                <span>
                  I agree to the Kata Arena{" "}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-red-700 underline underline-offset-2"
                  >
                    Terms &amp; Conditions
                  </a>
                  . *
                </span>
              </label>
            )}
            <label htmlFor="not_a_robot" className="flex items-center gap-2 text-xs text-neutral-600">
              <input id="not_a_robot" name="not_a_robot" type="checkbox" required />
              <span>I am not a robot or AI. *</span>
            </label>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
