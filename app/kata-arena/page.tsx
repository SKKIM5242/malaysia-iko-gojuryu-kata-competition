import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { loadKataArena } from "@/lib/arena";
import { winnersRevealed } from "@/lib/winners";
import { SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";
import ClaimForm from "@/components/ClaimForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kata Arena" };

interface ProfileRow {
  role: "participant" | "referee" | "staff" | "admin";
  full_name: string | null;
  registration_id: string | null;
}

export default async function KataArenaPage() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <SetupNotice />
        </main>
        <SiteFooter />
      </>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Sign in as a registered participant to watch every submitted kata recording.
          </p>
          <Link
            href="/account"
            className="mt-4 inline-block rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
          >
            Kata Arena Log In
          </Link>
        </main>
        <SiteFooter />
      </>
    );
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("role, full_name, registration_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileData as ProfileRow | null;

  if (!profile || profile.role !== "participant") {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Kata Arena is for registered participants only.{" "}
            <Link href="/account" className="underline">
              Go to your account
            </Link>
            .
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  if (!profile.registration_id) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-1 mb-6 text-sm text-neutral-500">
            Link your registration first — enter your reference ID and IC/passport below.
          </p>
          <ClaimForm />
        </main>
        <SiteFooter />
      </>
    );
  }

  const { data: registration } = await supabase
    .from("registrations")
    .select("competition:competitions(id, name, registration_deadline)")
    .eq("id", profile.registration_id)
    .maybeSingle();
  const competition = (
    registration as unknown as {
      competition: { id: string; name: string; registration_deadline: string | null } | null;
    } | null
  )?.competition ?? null;

  if (!competition) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-2 text-sm text-neutral-500">No competition found for your registration.</p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const arena = await loadKataArena(supabase, competition.id);
  const revealed = winnersRevealed(competition.registration_deadline);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          {competition.name} — every participant&apos;s submitted recording is watchable below.{" "}
          {revealed ? (
            "Final judge scores are revealed now that winners have been announced."
          ) : (
            <>
              Final judge scores stay hidden until winners are announced — see the{" "}
              <Link href="/winners" className="underline">
                Winners page
              </Link>{" "}
              for the reveal date.
            </>
          )}
        </p>
        {arena.length === 0 ? (
          <p className="text-sm text-neutral-400">No recordings submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {arena.map((a) => (
              <div key={a.videoId} className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-neutral-900">{a.participantName}</p>
                    <p className="text-sm text-neutral-500">{a.categoryName ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {revealed && a.finalScore != null && (
                      <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
                        Final {a.finalScore.toFixed(1)}
                      </span>
                    )}
                    {a.playbackUrl && (
                      <a
                        href={a.playbackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                      >
                        Watch
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
