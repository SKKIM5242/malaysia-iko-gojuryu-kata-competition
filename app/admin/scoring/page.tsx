import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { AdminShell, Card } from "@/components/admin";
import { CategoryName, EmptyState, SetupNotice } from "@/components/ui";
import { ScoreSessionButton } from "@/components/RefereeScoring";

export const dynamic = "force-dynamic";

interface VideoRow {
  id: string;
  created_at: string;
  storage_path: string;
  participant: { full_name: string; home_country: string | null } | null;
  registration: { competition_id: string | null; category: { name: string } | null } | null;
}

/** "Score This Recording" — the dedicated Admin/Organizer scoring page:
 * every submitted recording with the same dual-window Score Sheet 1/2
 * session referees use. Scoring here self-assigns the scorer (see
 * submitScore's override), so their score shows up everywhere assignment
 * drives display. Admin & Organizer only. */
export default async function AdminScoring({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; tier?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Score This Recording" active="/admin/scoring">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  if (!["admin", "organizer", "staff"].includes(myProfile?.role ?? "")) {
    return (
      <AdminShell title="Score This Recording" active="/admin/scoring">
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This page is for Admin and Organizer accounts only.
        </p>
      </AdminShell>
    );
  }

  const [allCompetitions, { data: videos }, { data: myScores }] = await Promise.all([
    getAllCompetitions(),
    supabase
      .from("kata_videos")
      .select(
        "id, created_at, storage_path, participant:participants(full_name, home_country), registration:registrations(competition_id, category:categories(name))",
      )
      .order("created_at", { ascending: false }),
    supabase.from("video_scores").select("video_id, score").eq("referee_user_id", user!.id),
  ]);
  // USD 10 tier first, USD 100 second, USD 200 third, any other competition
  // (different or unset fee) after — ascending by fee, nulls last.
  const competitions = [...allCompetitions].sort((a, b) => {
    if (a.registration_fee_usd == null) return 1;
    if (b.registration_fee_usd == null) return -1;
    return a.registration_fee_usd - b.registration_fee_usd;
  });
  const selectedTier = params.tier && competitions.some((c) => c.id === params.tier) ? params.tier : undefined;
  const visibleCompetitions = selectedTier ? competitions.filter((c) => c.id === selectedTier) : competitions;
  const videoList = (videos as unknown as VideoRow[]) ?? [];
  const myScoreByVideo = new Map((myScores ?? []).map((s) => [s.video_id as string, Number(s.score)]));

  const playbackUrls = new Map<string, string>();
  await Promise.all(
    videoList.map(async (v) => {
      const { data } = await supabase.storage.from("kata-videos").createSignedUrl(v.storage_path, 3600);
      if (data?.signedUrl) playbackUrls.set(v.id, data.signedUrl);
    }),
  );

  return (
    <AdminShell title="Score This Recording" active="/admin/scoring" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Score any submitted recording with the official Score Sheet 1 or 2 — the same dual-window
        session referees use. Scoring a recording here assigns you to it automatically, and your
        score appears alongside the referees&apos; everywhere. A score is final once submitted.
      </p>

      {competitions.length > 1 && (
        <form method="GET" action="/admin/scoring" className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="tier" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Competition tier
            </label>
            <select
              id="tier"
              name="tier"
              defaultValue={selectedTier ?? ""}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">All tiers</option>
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
          >
            Filter
          </button>
          {selectedTier && (
            <Link href="/admin/scoring" className="py-2 text-sm text-red-700 underline underline-offset-2">
              Clear filter
            </Link>
          )}
        </form>
      )}

      {visibleCompetitions.map((c) => {
        const compVideos = videoList.filter((v) => v.registration?.competition_id === c.id);
        if (compVideos.length === 0) return null;
        return (
          <div key={c.id} className="mb-10">
            <h2 className="mb-3 text-lg font-bold">{c.name}</h2>
            <div className="space-y-3">
              {compVideos.map((v) => {
                const myScore = myScoreByVideo.get(v.id);
                return (
                  <Card key={v.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-bold text-neutral-900">{v.participant?.full_name ?? "Unknown participant"}</p>
                        <p className="text-sm text-neutral-500">
                          <CategoryName name={v.registration?.category?.name} />
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {myScore != null && (
                          <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
                            Your Total Average Score {myScore.toFixed(1)}
                          </span>
                        )}
                        <ScoreSessionButton
                          item={{
                            videoId: v.id,
                            participantName: v.participant?.full_name ?? "Unknown participant",
                            participantCountry: v.participant?.home_country ?? null,
                            categoryName: v.registration?.category?.name ?? null,
                            competitionName: c.name,
                            playbackUrl: playbackUrls.get(v.id) ?? null,
                            existingScore: myScore ?? null,
                          }}
                          canScore
                          allowAdvancedControls
                          label={myScore != null ? "Update score" : "Score this recording"}
                        />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
      {visibleCompetitions.every((c) => videoList.filter((v) => v.registration?.competition_id === c.id).length === 0) && (
        <EmptyState>
          {selectedTier ? "No recordings submitted yet for this tier." : "No recordings submitted yet."}
        </EmptyState>
      )}
    </AdminShell>
  );
}
