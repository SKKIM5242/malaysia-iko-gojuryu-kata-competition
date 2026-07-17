"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SiteFooter, SiteHeader } from "@/components/ui";

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
const labelCls = "mb-1 block text-sm font-medium text-neutral-700";

type Status = "checking" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const code = new URL(window.location.href).searchParams.get("code");
      if (code) {
        const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeErr) {
          setStatus("invalid");
          return;
        }
      }
      // The implicit flow (#access_token=...&type=recovery) is auto-detected
      // by the client SDK on load — give it a moment, then check the session.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setStatus(session ? "ready" : "invalid");
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    const supabase = createClient();
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setPending(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    setStatus("done");
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Reset Password</h1>

        {status === "checking" && (
          <p className="mt-6 text-sm text-neutral-500">Checking your reset link…</p>
        )}

        {status === "invalid" && (
          <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-6 text-sm text-red-800">
            This reset link is invalid or has expired.{" "}
            <Link href="/account/forgot-password" className="underline">Request a new one</Link>.
          </div>
        )}

        {status === "done" && (
          <div className="mt-6 rounded-lg border border-green-300 bg-green-50 p-6 text-sm text-green-800">
            Your password has been reset.{" "}
            <Link href="/account" className="underline">Sign in</Link> with your new password.
          </div>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            )}
            <div>
              <label htmlFor="password" className={labelCls}>New password</label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="confirm" className={labelCls}>Confirm new password</label>
              <input
                id="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
