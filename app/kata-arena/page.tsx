import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { loadKataArena, type ArenaEntry } from "@/lib/arena";
import { winnersRevealed } from "@/lib/winners";
import { SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";
import AuthForms from "@/components/AuthForms";
import ClaimForm from "@/components/ClaimForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kata Arena" };

const PRIVILEGED_ROLES = ["admin", "organizer", "staff", "customer_support", "referee", "audience"];

interface ProfileRow {
  role: "participant" | "referee" | "staff" | "admin" | "organizer" | "customer_support" | "audience";
  full_name: string | null;
  approved: boolean;
  participant_id: string | null;
  registration_id: string | null;
}

function RecordingCard({
  entry,
  showJudgeScores,
  showFinalScore,
}: {
  entry: ArenaEntry;
  showJudgeScores: boolean;
  showFinalScore: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-neutral-900">{entry.participantName}</p>
          <p className="text-sm text-neutral-500">{entry.categoryName ?? "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          {showFinalScore && entry.finalScore != null && (
            <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
              Final {entry.finalScore.toFixed(1)}
            </span>
          )}
          {entry.playbackUrl && (
            <a
              href={entry.playbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              Watch
            </a>
          )}
        </div>
      </div>
      {showJudgeScores && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {entry.judgeScores.length === 0 ? (
            <span className="text-xs text-neutral-400">No referees assigned yet</span>
          ) : (
            entry.judgeScores.map((js, i) => (
              <span
                key={`${entry.videoId}-${i}`}
                className="flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700"
              >
                {js.judgeName}
                <span className={js.score != null ? "text-green-700" : "text-amber-600"}>
                  {js.score != null ? js.score.toFixed(1) : "pending"}
                </span>
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
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
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mb-8 text-sm text-neutral-500">
            Sign in to watch kata recordings. Participants can watch their own recording any time;
            other participants&apos; recordings and every judge&apos;s score become visible to
            Referees, Admin/Organizer, Customer Support and Audience accounts as they&apos;re
            submitted. Final scores and standings stay hidden for everyone until winners are
            announced.
          </p>
          <AuthForms />
        </main>
        <SiteFooter />
      </>
    );
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("role, full_name, approved, participant_id, registration_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileData as ProfileRow | null;

  if (!profile) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-2 text-sm text-neutral-500">Setting up your account… please refresh in a moment.</p>
        </main>
        <SiteFooter />
      </>
    );
  }

  if (!profile.approved) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Your account is awaiting the organiser&apos;s approval.{" "}
            <Link href="/account" className="underline">
              Check your account status
            </Link>
            .
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Referee / Admin / Organizer / Customer Support / Audience: every
  // competition's recordings + individual judge scores, never the total. ──
  if (PRIVILEGED_ROLES.includes(profile.role)) {
    const competitions = await getAllCompetitions();
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-1 mb-8 text-sm text-neutral-500">
            Every submitted recording, with each referee&apos;s individual score. Final (average)
            scores and standings stay hidden until winners are announced — see the{" "}
            <Link href="/winners" className="underline">
              Winners page
            </Link>
            .
          </p>
          {competitions.length === 0 ? (
            <p className="text-sm text-neutral-400">No competitions yet.</p>
          ) : (
            await Promise.all(
              competitions.map(async (c) => {
                const arena = await loadKataArena(supabase, c.id);
                const revealed = winnersRevealed(c.registration_deadline);
                return (
                  <div key={c.id} className="mb-10">
                    <h2 className="mb-3 text-lg font-bold">{c.name}</h2>
                    {arena.length === 0 ? (
                      <p className="text-sm text-neutral-400">No recordings submitted yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {arena.map((a) => (
                          <RecordingCard key={a.videoId} entry={a} showJudgeScores showFinalScore={revealed} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              }),
            )
          )}
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Participant ───────────────────────────────────────────────────────────
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

  const fullArena = await loadKataArena(supabase, competition.id);
  const revealed = winnersRevealed(competition.registration_deadline);
  // Own recording is always visible; other participants' recordings only
  // unlock once winners are announced.
  const visibleArena = revealed
    ? fullArena
    : fullArena.filter((a) => a.participantId === profile.participant_id);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          {competition.name}. You can always watch your own recording here.{" "}
          {revealed
            ? "Winners have been announced, so every participant's recording and final score is now visible below."
            : "Other participants' recordings and every final score stay hidden until winners are announced."}
        </p>
        {visibleArena.length === 0 ? (
          <p className="text-sm text-neutral-400">No recordings submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {visibleArena.map((a) => (
              <RecordingCard key={a.videoId} entry={a} showJudgeScores={false} showFinalScore={revealed} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
