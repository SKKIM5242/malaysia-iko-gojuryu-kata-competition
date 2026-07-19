"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SiteFooter, SiteHeader } from "@/components/ui";
import PasswordInput from "@/components/PasswordInput";

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
    let settled = false;
    const markReady = () => {
      if (settled) return;
      settled = true;
      setStatus("ready");
    };

    // The implicit flow (#access_token=...&type=recovery) is auto-detected by
    // the client SDK, but that detection runs asynchronously — calling
    // getSession() immediately can race it and see nothing yet even though
    // the link was perfectly valid. onAuthStateChange is the documented way
    // to reliably catch the resulting PASSWORD_RECOVERY session whenever it
    // actually resolves, however long that takes.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) markReady();
    });

    (async () => {
      const url = new URL(window.location.href);
      // Set by app/auth/confirm/route.ts when its server-side verifyOtp()
      // call fails — a genuinely dead/expired link, no need to wait further.
      if (url.searchParams.get("error")) {
        if (!settled) { settled = true; setStatus("invalid"); }
        return;
      }
      // /auth/confirm already verified the link and wrote the session into
      // cookies server-side before this page ever loaded — the cookie-based
      // client picks that up immediately via getSession() below, no
      // client-side token parsing needed.
      const code = url.searchParams.get("code");
      if (code) {
        const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeErr) {
          if (!settled) { settled = true; setStatus("invalid"); }
          return;
        }
        markReady();
        return;
      }
      // Covers the case where detection already finished before we
      // subscribed above.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        markReady();
        return;
      }
      // Still nothing — give the listener a real grace period (detection can
      // take a beat) before concluding the link is genuinely invalid.
      setTimeout(() => {
        if (!settled) { settled = true; setStatus("invalid"); }
      }, 3000);
    })();

    return () => subscription.unsubscribe();
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
              <PasswordInput
                id="password"
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
              <PasswordInput
                id="confirm"
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
