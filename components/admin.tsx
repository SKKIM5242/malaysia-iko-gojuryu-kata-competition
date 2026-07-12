import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions/auth";

export function AdminShell({
  title,
  active,
  children,
  flash,
}: {
  title: string;
  active: string;
  children: ReactNode;
  flash?: { ok?: string; error?: string };
}) {
  const nav = [
    ["Dashboard", "/admin"],
    ["Registrations", "/admin/registrations"],
    ["Competitions", "/admin/competitions"],
    ["Announcements", "/admin/announcements"],
    ["Schools", "/admin/schools"],
    ["Senseis", "/admin/senseis"],
    ["Participants", "/admin/participants"],
  ] as const;
  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.svg"
              alt="Malaysia IKO Goju-ryu Karate-do crest"
              className="h-8 w-8 rounded-md bg-white p-0.5"
            />
            Admin Panel
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="text-neutral-400 hover:text-white">← Public site</Link>
            <form action={signOut}>
              <button className="rounded border border-neutral-700 px-3 py-1 text-neutral-300 hover:bg-neutral-800">
                Log out
              </button>
            </form>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl flex-wrap gap-1 overflow-x-auto px-4 pb-2 text-sm">
          {nav.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={`rounded px-3 py-1.5 whitespace-nowrap ${
                active === href ? "bg-red-700 font-semibold" : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {flash?.ok && (
          <div className="mt-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
            {flash.ok}
          </div>
        )}
        {flash?.error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {flash.error}
          </div>
        )}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

export const adminInput =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";
export const adminLabel = "mb-1 block text-sm font-medium text-neutral-700";
export const adminBtn =
  "rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600";
export const adminBtnSecondary =
  "rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50";

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">{children}</div>
  );
}
