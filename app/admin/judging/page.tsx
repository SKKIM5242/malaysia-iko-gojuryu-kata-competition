import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { assignRefereeToVideo, unassignRefereeFromVideo } from "@/app/actions/admin";
import { AdminShell, Card } from "@/components/admin";
import { EmptyState, SetupNotice, TelegramFullAccessLinks } from "@/components/ui";
import { getAllTelegramLinks } from "@/lib/telegram";

export const dynamic = "force-dynamic";

interface VideoRow {
  id: string;
  created_at: string;
  storage_path: string;
  participant: { full_name: string } | null;
  registration: { category: { name: string } | null } | null;
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
  const [{ data: videos }, { data: referees }, { data: assignments }, { data: scores }] = await Promise.all([
    supabase
      .from("kata_videos")
      .select(
        "id, created_at, storage_path, participant:participants(full_name), registration:registrations(category:categories(name))",
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

  return (
    <AdminShell title="Judging" active="/admin/judging" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Telegram — full access</h2>
        <p className="mb-3 text-sm text-neutral-500">
          Every category&apos;s group, for the organiser&apos;s own reference.
        </p>
        <TelegramFullAccessLinks links={getAllTelegramLinks()} />
      </div>

      <h2 className="mb-3 text-lg font-bold">Submitted recordings &amp; scores ({videoList.length})</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Assign 3–7 referees per recording — each referee&apos;s score appears here the moment they submit it.
      </p>
      {videoList.length === 0 ? (
        <EmptyState>No kata recordings submitted yet.</EmptyState>
      ) : refereeList.length === 0 ? (
        <EmptyState>No approved referees yet — approve some in Accounts → Approvals first.</EmptyState>
      ) : (
        <div className="space-y-4">
          {videoList.map((v) => {
            const assigned = assignedByVideo.get(v.id) ?? [];
            const available = refereeList.filter((r) => !assigned.includes(r.user_id));
            const submittedScores = assigned
              .map((uid) => scoreByKey.get(`${v.id}:${uid}`))
              .filter((s): s is number => s != null);
            const average =
              submittedScores.length > 0
                ? (submittedScores.reduce((a, b) => a + b, 0) / submittedScores.length).toFixed(1)
                : null;
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
                          <form action={unassignRefereeFromVideo}>
                            <input type="hidden" name="video_id" value={v.id} />
                            <input type="hidden" name="referee_user_id" value={uid} />
                            <input type="hidden" name="return_to" value="/admin/judging" />
                            <button className="text-neutral-400 hover:text-red-600" title="Unassign">✕</button>
                          </form>
                        </span>
                      );
                    })
                  )}
                  {average != null && (
                    <span className="rounded-full bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white">
                      Avg {average} ({submittedScores.length}/{assigned.length} scored)
                    </span>
                  )}
                </div>

                {available.length > 0 && (
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
          })}
        </div>
      )}
    </AdminShell>
  );
}
