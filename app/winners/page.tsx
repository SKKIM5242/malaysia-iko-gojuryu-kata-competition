import { createClient } from "@/lib/supabase/server";
import { getCategories, schemaReady } from "@/lib/data";
import { EmptyState, NoTranslate, SectionTitle, SetupNotice, SiteFooter, SiteHeader, formatDate } from "@/components/ui";
import { groupByKata } from "@/lib/division";
import { finalScore, isDisqualified } from "@/lib/scoring";
import { winnersRevealDate } from "@/lib/winners";
import type { Competition } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Winners" };

const MEDALS = ["🥇", "🥈", "🥉"];

interface WinnerEntry {
  rank: number;
  participantName: string;
  finalScore: number;
  playbackUrl: string | null;
}

async function computeWinners(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitionId: string,
): Promise<Map<string, WinnerEntry[]>> {
  const { data: regs } = await supabase
    .from("registrations")
    .select("id, category_id, participant:participants(full_name)")
    .eq("competition_id", competitionId)
    .eq("payment_status", "paid")
    .not("category_id", "is", null);
  const regList =
    (regs as unknown as Array<{
      id: string;
      category_id: string;
      participant: { full_name: string } | null;
    }>) ?? [];
  if (regList.length === 0) return new Map();
  const regIds = regList.map((r) => r.id);

  const { data: videos } = await supabase
    .from("kata_videos")
    .select("id, registration_id, storage_path")
    .in("registration_id", regIds);
  const videoByReg = new Map(
    (videos ?? []).map((v) => [v.registration_id as string, { id: v.id as string, storagePath: v.storage_path as string }]),
  );
  const videoIds = (videos ?? []).map((v) => v.id as string);
  if (videoIds.length === 0) return new Map();

  const { data: scores } = await supabase.from("video_scores").select("video_id, score").in("video_id", videoIds);
  const scoresByVideo = new Map<string, number[]>();
  for (const s of scores ?? []) {
    const list = scoresByVideo.get(s.video_id as string) ?? [];
    list.push(Number(s.score));
    scoresByVideo.set(s.video_id as string, list);
  }

  const byCategory = new Map<string, Array<{ name: string; score: number; videoId: string; storagePath: string }>>();
  for (const r of regList) {
    const video = videoByReg.get(r.id);
    if (!video) continue;
    const videoScores = scoresByVideo.get(video.id) ?? [];
    // A single judge's Total Score of 0 disqualifies this entry — it never
    // appears in the public winners announcement, whatever the others gave.
    if (isDisqualified(videoScores)) continue;
    const fs = finalScore(videoScores);
    if (fs == null) continue;
    const list = byCategory.get(r.category_id) ?? [];
    list.push({ name: r.participant?.full_name ?? "Unknown participant", score: fs, videoId: video.id, storagePath: video.storagePath });
    byCategory.set(r.category_id, list);
  }

  // Only the top 3 per category get their recording copied to this page —
  // sign just those, not every scored video.
  const top3ByCategory = new Map<string, Array<{ name: string; score: number; videoId: string; storagePath: string }>>();
  for (const [catId, entries] of byCategory) {
    top3ByCategory.set(catId, entries.sort((a, b) => b.score - a.score).slice(0, 3));
  }
  const winningPaths = [...top3ByCategory.values()].flat().map((e) => e.storagePath);
  const playbackUrls = new Map<string, string>();
  if (winningPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrls(winningPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) playbackUrls.set(s.path, s.signedUrl);
    }
  }

  const result = new Map<string, WinnerEntry[]>();
  for (const [catId, entries] of top3ByCategory) {
    result.set(
      catId,
      entries.map((e, i) => ({
        rank: i + 1,
        participantName: e.name,
        finalScore: e.score,
        playbackUrl: playbackUrls.get(e.storagePath) ?? null,
      })),
    );
  }
  return result;
}

async function CompetitionWinners({
  competition,
  supabase,
}: {
  competition: Competition;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  if (!competition.registration_deadline) {
    return (
      <section>
        <h2 className="mb-1 text-lg font-bold">{competition.name}</h2>
        <p className="text-sm text-neutral-400">No registration deadline set yet.</p>
      </section>
    );
  }

  const revealDate = winnersRevealDate(competition.registration_deadline);
  const revealed = new Date() >= revealDate;

  if (!revealed) {
    return (
      <section>
        <h2 className="mb-1 text-lg font-bold">{competition.name}</h2>
        <p className="text-sm text-neutral-500">
          Winners will be announced on <strong>{formatDate(revealDate.toISOString().slice(0, 10))}</strong>.
        </p>
      </section>
    );
  }

  const [categories, winnersByCategory] = await Promise.all([
    getCategories(competition.id),
    computeWinners(supabase, competition.id),
  ]);
  const withWinners = categories.filter((cat) => (winnersByCategory.get(cat.id) ?? []).length > 0);

  return (
    <section>
      <h2 className="mb-1 text-lg font-bold">{competition.name}</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Announced {formatDate(revealDate.toISOString().slice(0, 10))}.
      </p>
      {withWinners.length === 0 ? (
        <p className="text-sm text-neutral-400">No scored recordings yet.</p>
      ) : (
        <div className="space-y-2">
          {groupByKata(withWinners).map(([base, cats]) => (
            <details key={base} className="rounded-lg border border-neutral-200 bg-white shadow-sm" open>
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">
                <NoTranslate>{base}</NoTranslate>
              </summary>
              <div className="space-y-3 px-4 pb-4">
                {cats.map((cat) => {
                  const winners = winnersByCategory.get(cat.id) ?? [];
                  return (
                    <div key={cat.id} className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        {cat.name.split(" — ").slice(1).join(" — ") || cat.name}
                      </p>
                      <ul className="space-y-1">
                        {winners.map((w) => (
                          <li key={w.rank} className="flex items-center justify-between gap-2 text-sm">
                            <span>
                              {MEDALS[w.rank - 1]} {w.participantName}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="font-semibold text-neutral-700">{w.finalScore.toFixed(1)}</span>
                              {w.playbackUrl && (
                                <a
                                  href={w.playbackUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                                >
                                  Watch recording
                                </a>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function WinnersPage() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-4xl px-4 py-10">
          <SetupNotice />
        </main>
        <SiteFooter />
      </>
    );
  }

  const supabase = await createClient();
  const { data: competitionsData } = await supabase
    .from("competitions")
    .select("*")
    .order("registration_fee_usd", { ascending: true, nullsFirst: true });
  const competitions = (competitionsData as Competition[]) ?? [];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <SectionTitle>Winners</SectionTitle>
        <p className="mb-8 text-sm text-neutral-500">
          Winners for each competition are announced 30 days after its registration deadline, on
          the next working day (Monday–Friday) in Malaysia.
        </p>
        {competitions.length === 0 ? (
          <EmptyState>No competitions yet.</EmptyState>
        ) : (
          <div className="space-y-12">
            {competitions.map((c) => (
              <CompetitionWinners key={c.id} competition={c} supabase={supabase} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
