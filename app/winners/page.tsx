import { createClient } from "@/lib/supabase/server";
import { getCategories, schemaReady } from "@/lib/data";
import { EmptyState, NoTranslate, SectionTitle, SetupNotice, formatDate } from "@/components/ui";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { groupByKata } from "@/lib/division";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import { winnersRevealDate, winnersRevealDateFor } from "@/lib/winners";
import FullViewButton, { type FullViewJudge } from "@/components/FullViewButton";
import WinnerTestimonialInline, { type WinnerTestimonialInfo } from "@/components/WinnerTestimonialInline";
import type { Competition } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Winners" };

const MEDALS = ["🥇", "🥈", "🥉"];

interface WinnerEntry {
  rank: number;
  registrationId: string;
  participantName: string;
  categoryName: string | null;
  finalScore: number;
  playbackUrl: string | null;
  judges: FullViewJudge[];
  testimonial: WinnerTestimonialInfo | null;
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
      ? supabase
          .from("video_scores")
          .select("video_id, referee_user_id, score, criteria, deductions")
          .in("video_id", videoIds)
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
  const deductionsByKey = new Map<string, boolean[][] | null>();
  for (const s of scores ?? []) {
    scoreByKey.set(`${s.video_id}:${s.referee_user_id}`, Number(s.score));
    criteriaByKey.set(`${s.video_id}:${s.referee_user_id}`, (s.criteria as number[] | null) ?? null);
    deductionsByKey.set(`${s.video_id}:${s.referee_user_id}`, (s.deductions as boolean[][] | null) ?? null);
  }

  // Testimonials for every Top-3 registration in this competition — the
  // merge point of what used to be the separate /testimonials page (now
  // retired, see next.config.ts redirects).
  const winningRegIds = winningEntries.map((e) => e.registrationId);
  const { data: testimonialRows } =
    winningRegIds.length > 0
      ? await supabase
          .from("winner_testimonials")
          .select("id, registration_id, kind, media_path, message, deleted_at")
          .in("registration_id", winningRegIds)
      : { data: [] };
  const testimonialByRegId = new Map<string, WinnerTestimonialInfo>(
    (testimonialRows ?? []).map((t) => [
      t.registration_id as string,
      {
        id: t.id as string,
        kind: t.kind as WinnerTestimonialInfo["kind"],
        mediaUrl: t.media_path ? supabase.storage.from("testimonials").getPublicUrl(t.media_path as string).data.publicUrl : null,
        message: t.message as string | null,
        deleted: t.deleted_at != null,
      },
    ]),
  );

  const result = new Map<string, WinnerEntry[]>();
  for (const [catId, entries] of rankings) {
    result.set(
      catId,
      entries.map((e) => ({
        rank: e.rank,
        registrationId: e.registrationId,
        participantName: e.participantName,
        categoryName: categoryNameById.get(catId) ?? null,
        finalScore: e.finalScore,
        playbackUrl: playbackUrls.get(e.storagePath) ?? null,
        judges: (assignedByVideo.get(e.videoId) ?? []).map((uid) => ({
          judgeName: refereeName.get(uid) ?? uid.slice(0, 8),
          country: refereeCountry.get(uid) ?? null,
          total: scoreByKey.get(`${e.videoId}:${uid}`) ?? null,
          criteria: criteriaByKey.get(`${e.videoId}:${uid}`) ?? null,
          deductions: deductionsByKey.get(`${e.videoId}:${uid}`) ?? null,
          reason: null,
          isOverride: false,
        })),
        testimonial: testimonialByRegId.get(e.registrationId) ?? null,
      })),
    );
  }
  return result;
}

async function CompetitionWinners({
  competition,
  supabase,
  myRegistrationId,
  isManager,
}: {
  competition: Competition;
  supabase: Awaited<ReturnType<typeof createClient>>;
  myRegistrationId: string | null;
  isManager: boolean;
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
                          <li key={w.rank} className="text-sm">
                            <div className="flex items-center justify-between gap-2">
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
                                        {j.total != null ? j.total.toFixed(2) : "—"}
                                      </span>
                                    ))}
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="font-semibold text-neutral-700">{w.finalScore.toFixed(2)}</span>
                                <FullViewButton
                                  url={w.playbackUrl}
                                  participantName={w.participantName}
                                  categoryName={w.categoryName}
                                  competitionName={competition.name}
                                  judges={w.judges}
                                  judgesRequired={competition.judges_required}
                                  queuePosition={null}
                                  averageText={`Final score ${w.finalScore.toFixed(2)}`}
                                  disqualified={false}
                                />
                              </span>
                            </div>
                            <WinnerTestimonialInline
                              isOwner={w.registrationId === myRegistrationId}
                              isManager={isManager}
                              testimonial={w.testimonial}
                            />
                            {w.registrationId === myRegistrationId && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                                <span className="text-xs font-semibold text-amber-800">🎓 That&apos;s you:</span>
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs text-amber-800">Winner Certificate</span>
                                  <a
                                    href={`/api/certificates/winner/${w.registrationId}?view=1`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                                  >
                                    👁 View
                                  </a>
                                  <a
                                    href={`/api/certificates/winner/${w.registrationId}`}
                                    className="rounded bg-amber-800 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                                  >
                                    ⬇ Download
                                  </a>
                                </span>
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs text-amber-800">Certificate of Participation</span>
                                  <a
                                    href={`/api/certificates/participant/${w.registrationId}?view=1`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                                  >
                                    👁 View
                                  </a>
                                  <a
                                    href={`/api/certificates/participant/${w.registrationId}`}
                                    className="rounded bg-amber-800 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                                  >
                                    ⬇ Download
                                  </a>
                                </span>
                              </div>
                            )}
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("registration_id, role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const myRegistrationId = (myProfile?.registration_id as string | null) ?? null;
  // Only Admin/Organizer/Staff ever see the ✕ delete button on a
  // testimonial (see deleteTestimonial in app/actions/admin.ts, which
  // enforces the same tier server-side regardless of what this hides).
  const isManager = ["admin", "organizer", "staff"].includes((myProfile?.role as string | null) ?? "");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <SectionTitle>Winners</SectionTitle>
        {!myRegistrationId && (
          <p className="mb-6 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
            🏆 Placed in the Top 3?{" "}
            <a href="/account" className="font-semibold text-red-700 underline underline-offset-2">
              Sign in
            </a>{" "}
            to view and download your winner certificate.
          </p>
        )}
        {competitions.length === 0 ? (
          <EmptyState>No competitions yet.</EmptyState>
        ) : (
          <div className="space-y-12">
            {competitions.map((c) => (
              <CompetitionWinners key={c.id} competition={c} supabase={supabase} myRegistrationId={myRegistrationId} isManager={isManager} />
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
