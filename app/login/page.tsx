"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "@/app/actions/auth";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="Malaysia IKO Goju-ryu Karate-do crest"
            className="mx-auto h-20 w-20 rounded-xl bg-white p-1"
          />
          <h1 className="mt-3 text-xl font-bold">Organiser login</h1>
          <p className="mt-1 text-sm text-neutral-400">Malaysia Open — IKO Goju-ryu Karate-do — Kata Competition — Goju-ryu Version Only</p>
        </div>
        <form action={formAction} className="space-y-4 rounded-lg bg-white p-6 shadow-lg">
          {state.error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {state.error}
            </div>
          )}
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-700">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-center text-xs text-neutral-400">
            Owner account only — created by the organiser in the Supabase dashboard.
          </p>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link href="/" className="text-neutral-400 underline underline-offset-2 hover:text-white">
            ← Back to public site
          </Link>
        </p>
      </div>
    </main>
  );
}
