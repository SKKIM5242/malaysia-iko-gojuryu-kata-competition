"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
const labelCls = "mb-1 block text-sm font-medium text-neutral-700";

export default function AuthForms() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: String(form.get("full_name") ?? "").trim(),
              country: String(form.get("country") ?? "").trim(),
              role: String(form.get("role") ?? "participant"),
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

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}
        {mode === "signup" && (
          <>
            <div>
              <label htmlFor="auth_role" className={labelCls}>I am registering as *</label>
              <select id="auth_role" name="role" required defaultValue="participant" className={inputCls}>
                <option value="participant">Participant (record my kata)</option>
                <option value="referee">Referee / Judge</option>
                <option value="staff">Admin / Organizer / Customer Support</option>
              </select>
              <p className="mt-1 text-xs text-neutral-400">
                Referee/Judge and Admin/Organizer/Customer Support accounts need the organiser&apos;s
                approval before they activate. Approved staff sign in without any payment, without limit.
              </p>
            </div>
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
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
