import { createClient } from "@/lib/supabase/server";
import { getCategories, schemaReady } from "@/lib/data";
import { EmptyState, NoTranslate, SectionTitle, SetupNotice, SiteFooter, SiteHeader, formatDate } from "@/components/ui";
import { groupByKata } from "@/lib/division";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import { winnersRevealDate, winnersRevealDateFor } from "@/lib/winners";
import FullViewButton, { type FullViewJudge } from "@/components/FullViewButton";
import type { Competition } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Winners" };

const MEDALS = ["🥇", "🥈", "🥉"];

interface WinnerEntry {
  rank: number;
  participantName: string;
  categoryName: string | null;
  finalScore: number;
  playbackUrl: string | null;
  judges: FullViewJudge[];
}

async function computeWinners(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitionId: string,
  categoryNameById: Map<string, string>,
): Promise<Map<string, WinnerEntry[]>> {
  const rankings = await computeCategoryRankings(supabase, competitionId);
  if (rankings.size === 0) return new Map();

  const winningEntries = [...rankings.values()].flat();

  // Only the top 3 per category get their recording copied to this page —
  // sign just those, not every scored video.
  const winningPaths = winningEntries.map((e) => e.storagePath);
  const playbackUrls = new Map<string, string>();
  if (winningPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrls(winningPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) playbackUrls.set(s.path, s.signedUrl);
    }
  }

  // Every judge who scored a winning recording — resolved the same way the
  // admin Judging page does (approved referees directory, falling back to
  // any linked referee login), so "who scored this" is always a real name.
  const videoIds = winningEntries.map((e) => e.videoId);
  const [{ data: assignments }, { data: scores }, { data: directory }, { data: refereeProfiles }] = await Promise.all([
    videoIds.length > 0
      ? supabase.from("referee_assignments").select("video_id, referee_user_id").in("video_id", videoIds)
      : Promise.resolve({ data: [] }),
    videoIds.length > 0
      ? supabase.from("video_scores").select("video_id, referee_user_id, score, criteria").in("video_id", videoIds)
      : Promise.resolve({ data: [] }),
    supabase.from("referees").select("user_id, full_name, home_country").eq("status", "approved"),
    supabase.from("profiles").select("user_id, full_name, email, country").eq("role", "referee").eq("approved", true),
  ]);
  const refereeName = new Map<string, string>();
  const refereeCountry = new Map<string, string | null>();
  for (const p of refereeProfiles ?? []) {
    refereeName.set(p.user_id, p.full_name || p.email || p.user_id.slice(0, 8));
    refereeCountry.set(p.user_id, p.country ?? null);
  }
  for (const r of directory ?? []) {
    if (!r.user_id) continue;
    refereeName.set(r.user_id, refereeName.get(r.user_id) ?? r.full_name ?? r.user_id.slice(0, 8));
    refereeCountry.set(r.user_id, refereeCountry.get(r.user_id) ?? r.home_country ?? null);
  }
  const assignedByVideo = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = assignedByVideo.get(a.video_id as string) ?? [];
    list.push(a.referee_user_id as string);
    assignedByVideo.set(a.video_id as string, list);
  }
  const scoreByKey = new Map<string, number>();
  const criteriaByKey = new Map<string, number[] | null>();
  for (const s of scores ?? []) {
    scoreByKey.set(`${s.video_id}:${s.referee_user_id}`, Number(s.score));
    criteriaByKey.set(`${s.video_id}:${s.referee_user_id}`, (s.criteria as number[] | null) ?? null);
  }

  const result = new Map<string, WinnerEntry[]>();
  for (const [catId, entries] of rankings) {
    result.set(
      catId,
      entries.map((e) => ({
        rank: e.rank,
        participantName: e.participantName,
        categoryName: categoryNameById.get(catId) ?? null,
        finalScore: e.finalScore,
        playbackUrl: playbackUrls.get(e.storagePath) ?? null,
        judges: (assignedByVideo.get(e.videoId) ?? []).map((uid) => ({
          judgeName: refereeName.get(uid) ?? uid.slice(0, 8),
          country: refereeCountry.get(uid) ?? null,
          total: scoreByKey.get(`${e.videoId}:${uid}`) ?? null,
          criteria: criteriaByKey.get(`${e.videoId}:${uid}`) ?? null,
        })),
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

  const revealDate =
    winnersRevealDateFor(competition.registration_deadline, competition.winners_announce_date) ??
    winnersRevealDate(competition.registration_deadline);
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

  const categories = await getCategories(competition.id);
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const winnersByCategory = await computeWinners(supabase, competition.id, categoryNameById);
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
                      <ul className="space-y-2">
                        {winners.map((w) => (
                          <li key={w.rank} className="flex items-center justify-between gap-2 text-sm">
                            <span>
                              <span className="block">
                                {MEDALS[w.rank - 1]} {w.participantName}
                              </span>
                              {w.judges.length > 0 && (
                                <span className="mt-0.5 block text-xs text-neutral-400">
                                  Judge scores:{" "}
                                  {w.judges.map((j, i) => (
                                    <span key={i}>
                                      {i > 0 && ", "}
                                      {j.total != null ? j.total.toFixed(1) : "—"}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="font-semibold text-neutral-700">{w.finalScore.toFixed(1)}</span>
                              <FullViewButton
                                url={w.playbackUrl}
                                participantName={w.participantName}
                                categoryName={w.categoryName}
                                competitionName={competition.name}
                                judges={w.judges}
                                judgesRequired={competition.judges_required}
                                queuePosition={null}
                                averageText={`Final score ${w.finalScore.toFixed(1)}`}
                                disqualified={false}
                              />
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
