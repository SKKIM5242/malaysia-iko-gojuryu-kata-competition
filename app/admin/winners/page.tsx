import { createClient } from "@/lib/supabase/server";
import { getCategories, schemaReady } from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { EmptyState, NoTranslate, SetupNotice, formatDate } from "@/components/ui";
import { groupByKata } from "@/lib/division";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import { winnersRevealDate, winnersRevealDateFor } from "@/lib/winners";
import type { Competition } from "@/lib/types";

export const dynamic = "force-dynamic";

const MEDALS = ["🥇", "🥈", "🥉"];

async function CompetitionPreview({
  competition,
  supabase,
}: {
  competition: Competition;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  if (!competition.registration_deadline) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-lg font-bold">{competition.name}</h2>
        <p className="text-sm text-neutral-400">No registration deadline set yet.</p>
      </section>
    );
  }

  const revealDate =
    winnersRevealDateFor(competition.registration_deadline, competition.winners_announce_date) ??
    winnersRevealDate(competition.registration_deadline);
  const revealed = new Date() >= revealDate;

  const [categories, rankings] = await Promise.all([
    getCategories(competition.id),
    computeCategoryRankings(supabase, competition.id),
  ]);
  const withWinners = categories.filter((cat) => (rankings.get(cat.id) ?? []).length > 0);

  const winningPaths = [...rankings.values()].flat().map((e) => e.storagePath);
  const playbackUrls = new Map<string, string>();
  if (winningPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrls(winningPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) playbackUrls.set(s.path, s.signedUrl);
    }
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{competition.name}</h2>
        {revealed ? (
          <span className="rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-800">
            Live on public Winners page
          </span>
        ) : (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
            Preview only — not yet public
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        {revealed ? "Announced" : "Public reveal date"} {formatDate(revealDate.toISOString().slice(0, 10))}. This
        preview always reflects the current standings from submitted scores, whether or not it has been
        publicly announced yet.
      </p>
      {withWinners.length === 0 ? (
        <p className="text-sm text-neutral-400">No scored recordings yet.</p>
      ) : (
        <div className="space-y-2">
          {groupByKata(withWinners).map(([base, cats]) => (
            <details key={base} className="rounded-lg border border-neutral-200 bg-neutral-50 shadow-sm" open>
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-100">
                <NoTranslate>{base}</NoTranslate>
              </summary>
              <div className="space-y-3 bg-white px-4 pb-4">
                {cats.map((cat) => {
                  const winners = rankings.get(cat.id) ?? [];
                  if (winners.length === 0) return null;
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
                              {playbackUrls.get(w.storagePath) && (
                                <a
                                  href={playbackUrls.get(w.storagePath)}
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

export default async function AdminWinners() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Winners" active="/admin/winners">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const { data: competitionsData } = await supabase
    .from("competitions")
    .select("*")
    .order("registration_fee_usd", { ascending: true, nullsFirst: true });
  const competitions = (competitionsData as Competition[]) ?? [];

  return (
    <AdminShell title="Winners" active="/admin/winners">
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        Same Top-3-per-category ranking and layout as the public{" "}
        <a href="/winners" target="_blank" rel="noopener noreferrer" className="font-semibold text-red-700 underline underline-offset-2">
          Winners page
        </a>
        , computed live from whatever scores exist right now — even before a competition's public reveal
        date. Use this to preview how an announcement will look, or to check current standings at any time.
      </p>
      {competitions.length === 0 ? (
        <EmptyState>No competitions yet.</EmptyState>
      ) : (
        <div className="space-y-8">
          {competitions.map((c) => (
            <CompetitionPreview key={c.id} competition={c} supabase={supabase} />
          ))}
        </div>
      )}
    </AdminShell>
  );
}
