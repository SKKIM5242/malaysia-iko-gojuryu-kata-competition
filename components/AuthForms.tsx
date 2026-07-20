"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { triggerEmailVerification } from "@/app/actions/email-verification";
import PasswordInput from "@/components/PasswordInput";

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
const labelCls = "mb-1 block text-sm font-medium text-neutral-700";

/** Every role can now self-signup through this form — Organizer, Customer
 * Support, and Admin require a valid invitation code (same as School/Sensei
 * below); without one, there's no self-signup path for those three, so a
 * link to the reviewed /register/staff application is shown instead.
 * School/Sensei directory records (with bank/contact details) are still
 * created separately on their own registration page — this is the *second*
 * step, signing in to view their own students' recordings, which needs a
 * personal invitation code generated from that existing directory record. */
const CODE_OPTIONAL_ROLES = new Set(["referee", "audience"]);

/** One account can now hold more than one role (ticked via checkboxes below)
 * — a person only ever needs a single login, since auth.users.email is
 * unique anyway. School/Sensei/Organizer/Participant Support/Admin still
 * need a valid invitation code (any one of them present triggers the code
 * field); Referee/Audience's code is optional, same as before. */
const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "school", label: "School / Dojo / Club" },
  { value: "sensei", label: "Sensei / Shihan / Hanshi" },
  { value: "participant", label: "Participant (record my kata)" },
  { value: "referee", label: "Referee / Judge" },
  { value: "audience", label: "Audience / Spectator (view Kata Arena)" },
  { value: "customer_support", label: "Participant Support" },
  { value: "organizer", label: "Organizer" },
  { value: "admin", label: "Admin" },
];
const CODE_REQUIRED_ROLES = new Set(["school", "sensei", "organizer", "customer_support", "admin"]);

export default function AuthForms({ defaultMode = "signin" }: { defaultMode?: "signin" | "signup" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">(defaultMode);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [roles, setRoles] = useState<string[]>(["participant"]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirm_password") ?? "");
    const supabase = createClient();
    try {
      if (form.get("not_a_robot") !== "on") {
        throw new Error("Please confirm you are not a robot or AI.");
      }
      if (mode === "signup") {
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        if (roles.length === 0) {
          throw new Error("Please tick at least one role.");
        }
        if (form.get("terms_accepted") !== "on") {
          throw new Error("Please accept the Terms & Conditions to create an account.");
        }
        const { data: signUpData, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: String(form.get("full_name") ?? "").trim(),
              role: roles[0],
              roles,
              invite_code: String(form.get("invite_code") ?? "").trim(),
              terms_accepted: true,
            },
          },
        });
        if (err) throw err;
        if (signUpData.user) {
          // Best-effort — never blocks account creation on a slow/failed email.
          triggerEmailVerification(signUpData.user.id, email, roles[0]).catch(() => {});
        }
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      // Best-effort counter — the actual access gate lives on the
      // protected pages themselves (see lib/sign-in-quota.ts), not here.
      await supabase.rpc("record_sign_in");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
    } finally {
      setPending(false);
    }
  }

  const requiresInviteCode = roles.some((r) => CODE_REQUIRED_ROLES.has(r));
  const codeOptionalOnly = !requiresInviteCode && roles.some((r) => CODE_OPTIONAL_ROLES.has(r));

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
          to view their own recording only.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}
        {mode === "signup" && (
          <div>
            <label className={labelCls}>I am creating an account for *</label>
            <div className="space-y-1.5 rounded-md border border-neutral-300 p-3">
              {ROLE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={roles.includes(opt.value)}
                    onChange={(e) =>
                      setRoles((prev) =>
                        e.target.checked ? [...prev, opt.value] : prev.filter((r) => r !== opt.value),
                      )
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-neutral-400">
              Tick every role that applies — one account covers all of them. Referee/Judge and
              Audience roles need the organizer&apos;s approval before they activate — unless you
              have an invitation code below. Once approved, sign-in is unlimited and free.
            </p>
          </div>
        )}
        {mode === "signup" && roles.some((r) => r === "school" || r === "sensei") && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p>
              Signing in here is the second step — your School/Sensei must already be registered
              in the directory (with contact and bank details) before you can get a personal
              invitation code from your own record&apos;s Edit page. That code links this login to
              your students only.
            </p>
            <p className="mt-1">
              A registration fee — matching your students&apos; competition tier fee (e.g. USD 100 if
              your students are registered in the USD 100 tier) — unlocks unlimited sign-in to watch
              your own students&apos; kata recordings and judge scores as they come in — no waiting
              for winners day. Get 10 or more participants signed up under your school/sensei and
              you qualify for a 10% share of their registration fees.
            </p>
          </div>
        )}
        {mode === "signup" &&
          roles.some((r) => r === "organizer" || r === "customer_support" || r === "admin") && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p>
              A valid invitation code is required to self-signup for this role — it activates your
              account immediately, no approval step. No code?{" "}
              <Link href="/register/staff" className="font-semibold underline underline-offset-2">
                Submit an application
              </Link>{" "}
              for the organizer to review instead.
            </p>
          </div>
        )}
        <>
            {mode === "signup" && (requiresInviteCode || codeOptionalOnly) && (
              <div>
                <label htmlFor="auth_invite" className={labelCls}>
                  Invitation code {requiresInviteCode ? "*" : "(optional)"}
                </label>
                <input
                  id="auth_invite"
                  name="invite_code"
                  required={requiresInviteCode}
                  className={inputCls}
                  placeholder="e.g. SCHOOL-4F9A2B"
                />
                <p className="mt-1 text-xs text-neutral-400">
                  {requiresInviteCode
                    ? "Required for School / Sensei / Organizer / Participant Support / Admin — get this from the organizer (or your school/sensei's own record). It activates the matching role immediately, linking it to the right record where relevant."
                    : "A valid code activates your Referee/Judge or Audience role immediately — no payment, no waiting for approval."}
                </p>
              </div>
            )}
            {mode === "signup" && (
              <div>
                <label htmlFor="auth_name" className={labelCls}>Full name *</label>
                <input id="auth_name" name="full_name" required className={inputCls} />
              </div>
            )}
            <div>
              <label htmlFor="auth_email" className={labelCls}>Email *</label>
              <input id="auth_email" name="email" type="email" required autoComplete="email" className={inputCls} />
            </div>
            <div>
              <label htmlFor="auth_password" className={labelCls}>Password *</label>
              <PasswordInput
                id="auth_password"
                name="password"
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
              <div>
                <label htmlFor="auth_confirm_password" className={labelCls}>Confirm password *</label>
                <PasswordInput
                  id="auth_confirm_password"
                  name="confirm_password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className={inputCls}
                />
              </div>
            )}
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
      </form>
    </div>
  );
}
