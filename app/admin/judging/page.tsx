import { createClient } from "@/lib/supabase/server";
import { getAllCompetitions } from "@/lib/admin-data";
import { schemaReady } from "@/lib/data";
import {
  assignRefereeToVideo, unassignRefereeFromVideo, setJudgesRequired, autoAssignReferees,
} from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput } from "@/components/admin";
import { EmptyState, SetupNotice, TelegramFullAccessLinks } from "@/components/ui";
import { getAllTelegramLinks } from "@/lib/telegram";
import { finalScore } from "@/lib/scoring";

export const dynamic = "force-dynamic";

interface VideoRow {
  id: string;
  created_at: string;
  storage_path: string;
  participant: { full_name: string } | null;
  registration: { competition_id: string | null; category: { name: string } | null } | null;
}

export default async function AdminJudging({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Judging" active="/admin/judging">
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
  const isAdmin = myProfile?.role === "admin";

  const [competitions, { data: videos }, { data: referees }, { data: assignments }, { data: scores }] =
    await Promise.all([
      getAllCompetitions(),
      supabase
        .from("kata_videos")
        .select(
          "id, created_at, storage_path, participant:participants(full_name), registration:registrations(competition_id, category:categories(name))",
        )
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("user_id, full_name, country").eq("role", "referee").eq("approved", true),
      supabase.from("referee_assignments").select("video_id, referee_user_id"),
      supabase.from("video_scores").select("video_id, referee_user_id, score"),
    ]);

  const videoList = (videos as unknown as VideoRow[]) ?? [];
  const refereeList = referees ?? [];
  const refereeName = new Map(refereeList.map((r) => [r.user_id, r.full_name ?? r.user_id.slice(0, 8)]));

  const assignedByVideo = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = assignedByVideo.get(a.video_id) ?? [];
    list.push(a.referee_user_id);
    assignedByVideo.set(a.video_id, list);
  }
  const scoreByKey = new Map<string, number>();
  for (const s of scores ?? []) {
    scoreByKey.set(`${s.video_id}:${s.referee_user_id}`, Number(s.score));
  }

  // Signed playback URLs (1hr) for the private kata-videos bucket.
  const playbackUrls = new Map<string, string>();
  await Promise.all(
    videoList.map(async (v) => {
      const { data } = await supabase.storage.from("kata-videos").createSignedUrl(v.storage_path, 3600);
      if (data?.signedUrl) playbackUrls.set(v.id, data.signedUrl);
    }),
  );

  const videosByCompetition = new Map<string, VideoRow[]>();
  for (const v of videoList) {
    const compId = v.registration?.competition_id;
    if (!compId) continue;
    const list = videosByCompetition.get(compId) ?? [];
    list.push(v);
    videosByCompetition.set(compId, list);
  }

  function renderVideoCard(v: VideoRow) {
    const assigned = assignedByVideo.get(v.id) ?? [];
    const available = refereeList.filter((r) => !assigned.includes(r.user_id));
    const submittedScores = assigned
      .map((uid) => scoreByKey.get(`${v.id}:${uid}`))
      .filter((s): s is number => s != null);
    const final = finalScore(submittedScores);
    const trimmed = submittedScores.length >= 5;
    const playbackUrl = playbackUrls.get(v.id);
    return (
      <Card key={v.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-bold text-neutral-900">{v.participant?.full_name ?? "Unknown participant"}</p>
            <p className="text-sm text-neutral-500">{v.registration?.category?.name ?? "—"}</p>
          </div>
          {playbackUrl && (
            <a
              href={playbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              Watch recording
            </a>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {assigned.length === 0 ? (
            <span className="text-xs text-neutral-400">No referees assigned yet</span>
          ) : (
            assigned.map((uid) => {
              const score = scoreByKey.get(`${v.id}:${uid}`);
              return (
                <span
                  key={uid}
                  className="flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700"
                >
                  {refereeName.get(uid) ?? uid.slice(0, 8)}
                  <span className={score != null ? "text-green-700" : "text-amber-600"}>
                    {score != null ? score.toFixed(1) : "pending"}
                  </span>
                  {isAdmin && (
                    <form action={unassignRefereeFromVideo}>
                      <input type="hidden" name="video_id" value={v.id} />
                      <input type="hidden" name="referee_user_id" value={uid} />
                      <input type="hidden" name="return_to" value="/admin/judging" />
                      <button className="text-neutral-400 hover:text-red-600" title="Unassign">✕</button>
                    </form>
                  )}
                </span>
              );
            })
          )}
          {final != null && (
            <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
              Final {final.toFixed(1)} ({submittedScores.length}/{assigned.length} scored
              {trimmed ? ", high/low dropped" : ""})
            </span>
          )}
        </div>

        {isAdmin && available.length > 0 && (
          <form action={assignRefereeToVideo} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="video_id" value={v.id} />
            <input type="hidden" name="return_to" value="/admin/judging" />
            <select
              name="referee_user_id"
              required
              defaultValue=""
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              <option value="" disabled>Add referee…</option>
              {available.map((r) => (
                <option key={r.user_id} value={r.user_id}>
                  {r.full_name ?? r.user_id.slice(0, 8)}{r.country ? ` (${r.country})` : ""}
                </option>
              ))}
            </select>
            <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700">
              Assign
            </button>
          </form>
        )}
      </Card>
    );
  }

  return (
    <AdminShell title="Judging" active="/admin/judging" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Telegram — full access</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Every category&apos;s group, for the organiser&apos;s own reference.
        </p>
        <TelegramFullAccessLinks links={getAllTelegramLinks()} />
      </div>

      <h2 className="mb-3 text-lg font-bold">Referee workload</h2>
      {refereeList.length === 0 ? (
        <EmptyState>No approved referees yet — approve some in Accounts → Approvals first.</EmptyState>
      ) : (
        <div className="mb-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3">Referee</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Assigned</th>
                <th className="px-4 py-3">Scored</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {refereeList.map((r) => {
                const assignedCount = (assignments ?? []).filter((a) => a.referee_user_id === r.user_id).length;
                const scoredCount = (scores ?? []).filter((s) => s.referee_user_id === r.user_id).length;
                return (
                  <tr key={r.user_id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium">{r.full_name ?? r.user_id.slice(0, 8)}</td>
                    <td className="px-4 py-3">{r.country ?? "—"}</td>
                    <td className="px-4 py-3">{assignedCount}</td>
                    <td className="px-4 py-3">
                      {scoredCount}
                      {assignedCount > scoredCount && (
                        <span className="ml-1.5 text-xs text-amber-600">({assignedCount - scoredCount} pending)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {competitions.map((c) => {
        const compVideos = videosByCompetition.get(c.id) ?? [];
        return (
          <div key={c.id} className="mb-10">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{c.name}</h2>
                <p className="text-sm text-neutral-500">
                  {compVideos.length} recording{compVideos.length === 1 ? "" : "s"} submitted
                </p>
              </div>
              {isAdmin ? (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={setJudgesRequired} className="flex items-center gap-1.5">
                    <input type="hidden" name="competition_id" value={c.id} />
                    <label htmlFor={`judges_${c.id}`} className="text-xs font-semibold text-neutral-500">
                      Judges per recording
                    </label>
                    <input
                      id={`judges_${c.id}`}
                      name="judges_required"
                      type="number"
                      min={1}
                      max={15}
                      defaultValue={c.judges_required}
                      className={`${adminInput} w-16 py-1 text-center`}
                    />
                    <button className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                      Save
                    </button>
                  </form>
                  <form action={autoAssignReferees}>
                    <input type="hidden" name="competition_id" value={c.id} />
                    <button className={adminBtn}>Auto-assign referees</button>
                  </form>
                </div>
              ) : (
                <span className="text-xs text-neutral-400">
                  {c.judges_required} judge{c.judges_required === 1 ? "" : "s"} per recording · view only
                </span>
              )}
            </div>
            {compVideos.length === 0 ? (
              <EmptyState>No kata recordings submitted yet for this competition.</EmptyState>
            ) : (
              <div className="space-y-4">{compVideos.map(renderVideoCard)}</div>
            )}
          </div>
        );
      })}
    </AdminShell>
  );
}
