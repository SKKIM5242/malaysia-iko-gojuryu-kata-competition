import { createClient } from "@/lib/supabase/server";
import { getAllCompetitions } from "@/lib/admin-data";
import { schemaReady } from "@/lib/data";
import {
  assignRefereeToVideo, unassignRefereeFromVideo, setJudgesRequired, autoAssignReferees,
  resendRefereeNotification,
} from "@/app/actions/admin";
import { submitScore } from "@/app/actions/account";
import { AdminShell, Card, adminBtn, adminInput } from "@/components/admin";
import { CategoryName, EmptyState, SetupNotice } from "@/components/ui";
import FullViewButton from "@/components/FullViewButton";
import { ScoreSessionButton } from "@/components/RefereeScoring";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import FilterableTable from "@/components/FilterableTable";
import ScoreDetailButton from "@/components/ScoreDetailButton";
import { finalScore, isDisqualified } from "@/lib/scoring";
import { getTelegramLink } from "@/lib/telegram";

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
  const myRole = myProfile?.role ?? null;
  // Judging Arena management (assign/unassign referees, judges-required,
  // auto-assign): Admin, Organizer/Staff, and Referee/Judge all get Full
  // access. Participant Support stays view only.
  const canManageJudging = ["admin", "organizer", "staff", "referee"].includes(myRole ?? "");
  // Kata video scoring override: Admin and Organizer/Staff may score any
  // recording, not just ones assigned to them. Participant Support stays
  // blocked (not a referee); Referee/Judge is unchanged — own assigned
  // videos only, via the separate My Account scoring flow.
  const canScoreAnyVideo = ["admin", "organizer", "staff"].includes(myRole ?? "");
  // The browser video player's three-dot menu (download / picture-in-picture)
  // is exposed to Admin/Organizer only, per the organizer's instruction.
  const allowAdvancedControls = ["admin", "organizer", "staff"].includes(myRole ?? "");

  const [competitions, { data: videos }, { data: directory }, { data: refereeProfiles }, { data: assignments }, { data: scores }] =
    await Promise.all([
      getAllCompetitions(),
      supabase
        .from("kata_videos")
        .select(
          "id, created_at, storage_path, participant:participants(full_name), registration:registrations(competition_id, category:categories(name))",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("referees")
        .select("id, full_name, karate_rank, email, phone, home_country, user_id")
        .eq("status", "approved")
        .order("full_name"),
      supabase.from("profiles").select("user_id, full_name, email, country").eq("role", "referee").eq("approved", true),
      supabase.from("referee_assignments").select("video_id, referee_user_id"),
      supabase.from("video_scores").select("video_id, referee_user_id, score, criteria"),
    ]);

  const videoList = (videos as unknown as VideoRow[]) ?? [];
  // The workload panel is the Referee page's directory: every APPROVED
  // referee record, whether or not their login is linked yet. Assignments
  // and the dropdowns need a login (user_id) to key on, so those use the
  // linked subset.
  const directoryList = directory ?? [];
  const refereeList = directoryList
    .filter((r): r is typeof r & { user_id: string } => !!r.user_id)
    .map((r) => ({ user_id: r.user_id, full_name: r.full_name, email: r.email, country: r.home_country }));
  // Name display falls back to email (not a bare user-id fragment) when a
  // referee never set a display name — so "who scored this" is always
  // legible, never a raw ID like "917ed647". Login-only referees (profiles
  // without a directory record, e.g. older test accounts) still resolve
  // for existing assignments via the profiles fallback below.
  const refereeName = new Map<string, string>();
  const refereeCountry = new Map<string, string | null>();
  for (const p of refereeProfiles ?? []) {
    refereeName.set(p.user_id, p.full_name || p.email || p.user_id.slice(0, 8));
    refereeCountry.set(p.user_id, p.country ?? null);
  }
  for (const r of refereeList) {
    refereeName.set(r.user_id, r.full_name || r.email || r.user_id.slice(0, 8));
    refereeCountry.set(r.user_id, r.country ?? null);
  }
  const refereeTelegramLink = getTelegramLink("referee");

  const assignedByVideo = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const list = assignedByVideo.get(a.video_id) ?? [];
    list.push(a.referee_user_id);
    assignedByVideo.set(a.video_id, list);
  }
  const scoreByKey = new Map<string, number>();
  const criteriaByKey = new Map<string, number[] | null>();
  for (const s of scores ?? []) {
    scoreByKey.set(`${s.video_id}:${s.referee_user_id}`, Number(s.score));
    criteriaByKey.set(`${s.video_id}:${s.referee_user_id}`, (s.criteria as number[] | null) ?? null);
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

  function renderVideoCard(v: VideoRow, queuePosition: number | null, dq: boolean, judgesRequired: number) {
    const assigned = assignedByVideo.get(v.id) ?? [];
    const available = refereeList.filter((r) => !assigned.includes(r.user_id));
    const myScore = user ? scoreByKey.get(`${v.id}:${user.id}`) : undefined;
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
            <p className="text-sm text-neutral-500"><CategoryName name={v.registration?.category?.name} /></p>
          </div>
          <div className="flex items-center gap-2">
            {dq ? (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800">
                Disqualified
              </span>
            ) : queuePosition != null ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                Queue #{queuePosition}
              </span>
            ) : null}
            <FullViewButton
              url={playbackUrl ?? null}
              participantName={v.participant?.full_name ?? "Unknown participant"}
              categoryName={v.registration?.category?.name ?? null}
              competitionName={competitions.find((c) => c.id === v.registration?.competition_id)?.name ?? null}
              judges={assigned.map((uid) => ({
                judgeName: refereeName.get(uid) ?? uid.slice(0, 8),
                country: refereeCountry.get(uid) ?? null,
                total: scoreByKey.get(`${v.id}:${uid}`) ?? null,
                criteria: criteriaByKey.get(`${v.id}:${uid}`) ?? null,
              }))}
              judgesRequired={judgesRequired}
              queuePosition={queuePosition}
              averageText={
                final != null
                  ? `Average ${final.toFixed(1)} (${submittedScores.length}/${assigned.length} scored${trimmed ? ", high/low dropped" : ""})`
                  : null
              }
              disqualified={dq}
              allowAdvancedControls={allowAdvancedControls}
            />
            <ScoreSessionButton
              item={{
                videoId: v.id,
                participantName: v.participant?.full_name ?? "Unknown participant",
                participantCountry: null,
                categoryName: v.registration?.category?.name ?? null,
                competitionName:
                  competitions.find((c) => c.id === v.registration?.competition_id)?.name ?? null,
                playbackUrl: playbackUrl ?? null,
                existingScore: myScore ?? null,
              }}
              canScore={canScoreAnyVideo || (user != null && assigned.includes(user.id))}
              allowAdvancedControls={allowAdvancedControls}
              label="Watch recording"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {assigned.length === 0 ? (
            <span className="text-xs text-neutral-400">No referees assigned yet</span>
          ) : (
            assigned.map((uid) => {
              const score = scoreByKey.get(`${v.id}:${uid}`);
              const country = refereeCountry.get(uid);
              const judgeName = refereeName.get(uid) ?? uid.slice(0, 8);
              return (
                <span
                  key={uid}
                  className="flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700"
                >
                  {judgeName}
                  {country && <span className="font-normal text-neutral-400">({country})</span>}
                  {score != null ? (
                    canScoreAnyVideo ? (
                      <ScoreDetailButton judgeName={judgeName} total={score} criteria={criteriaByKey.get(`${v.id}:${uid}`) ?? null} />
                    ) : (
                      <span className={score === 0 ? "font-bold text-red-700" : "text-green-700"}>
                        Total {score.toFixed(1)}
                      </span>
                    )
                  ) : (
                    <span className="text-amber-600">pending</span>
                  )}
                  {score == null && (
                    <form action={resendRefereeNotification}>
                      <input type="hidden" name="video_id" value={v.id} />
                      <input type="hidden" name="referee_user_id" value={uid} />
                      <input type="hidden" name="return_to" value="/admin/judging" />
                      <button
                        className="text-neutral-400 hover:text-blue-600"
                        title="Notify this referee (email + Telegram) that a recording is waiting to be judged"
                      >
                        🔔
                      </button>
                    </form>
                  )}
                  {canManageJudging && (
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
              Average {final.toFixed(1)} ({submittedScores.length}/{assigned.length} scored
              {trimmed ? ", high/low dropped" : ""})
            </span>
          )}
        </div>

        {canManageJudging && available.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {/* 3 independent slots so an admin can manually assign up to 3
                judges at once (e.g. when auto-assign has run out of
                eligible referees) without the dropdown resetting between
                picks. Each is its own form/submit — same underlying
                assignRefereeToVideo action as before. */}
            {[0, 1, 2].map((slot) => (
              <form key={slot} action={assignRefereeToVideo} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="video_id" value={v.id} />
                <input type="hidden" name="return_to" value="/admin/judging" />
                <select
                  name="referee_user_id"
                  required
                  defaultValue=""
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
                >
                  <option value="" disabled>Add referee… (slot {slot + 1})</option>
                  {available.map((r) => (
                    <option key={r.user_id} value={r.user_id}>
                      {r.full_name || r.email || r.user_id.slice(0, 8)}{r.country ? ` (${r.country})` : ""}
                    </option>
                  ))}
                </select>
                <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700">
                  Assign
                </button>
              </form>
            ))}
          </div>
        )}

        {canScoreAnyVideo && (
          <form action={submitScore} className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
            <input type="hidden" name="video_id" value={v.id} />
            <label htmlFor={`score_${v.id}`} className="text-xs font-semibold text-neutral-500">
              {myScore != null ? "Update your score" : "Score this recording"} (0–10) — Admin/Organizer override
            </label>
            <input
              id={`score_${v.id}`}
              name="score"
              type="number"
              min={0}
              max={10}
              step={0.1}
              defaultValue={myScore ?? ""}
              required
              className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <button className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600">
              Submit score
            </button>
          </form>
        )}
      </Card>
    );
  }

  return (
    <AdminShell title="Judging" active="/admin/judging" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Every score a Referee/Judge submits is <strong>final — no appeal is available</strong>. A
        judge&apos;s individual score is visible to everyone as soon as they submit it; the
        Average Score and standings stay hidden from the public until winners are announced.
        Admin and Organizer/Staff can also score any recording directly below, regardless of
        assignment.
      </div>

      <div className="mb-3 flex justify-end">
        <DownloadCsvButton
          filename="judging-videos"
          rows={videoList.map((v) => ({
            Participant: v.participant?.full_name ?? "",
            Category: v.registration?.category?.name ?? "",
            Competition: competitions.find((c) => c.id === v.registration?.competition_id)?.name ?? "",
            Submitted: v.created_at.slice(0, 10),
          }))}
        />
      </div>

      <h2 className="mb-1 text-lg font-bold">Referee Workload</h2>
      <p className="mb-3 text-sm text-neutral-500">
        Every <strong>Approved</strong> referee from the{" "}
        <a href="/admin/referees" className="font-semibold text-red-700 underline underline-offset-2">
          Referees page
        </a>{" "}
        is listed here — this same list is the pool Auto-assign draws from, always picking the
        least-loaded referee first. A referee whose login isn&apos;t linked yet shows &quot;No
        login yet&quot; and can&apos;t be assigned until linked (Referees page → Link account).
      </p>
      {directoryList.length === 0 ? (
        <EmptyState>No approved referees yet — approve some on the Referees page first.</EmptyState>
      ) : (
        <div className="mb-8">
          <FilterableTable
            rowKey="id"
            downloadName="referee-workload"
            columns={[
              { key: "referee", label: "Referee" },
              { key: "rank", label: "Rank" },
              { key: "email", label: "Email" },
              { key: "phone", label: "Mobile Phone" },
              { key: "telegram", label: "Telegram" },
              { key: "country", label: "Country" },
              { key: "assigned", label: "Assigned" },
              { key: "scored", label: "Scored" },
            ]}
            csvColumns={[
              { key: "referee", label: "Referee" },
              { key: "rank", label: "Rank" },
              { key: "email", label: "Email" },
              { key: "phone", label: "Mobile Phone" },
              { key: "country", label: "Country" },
              { key: "assigned", label: "Assigned" },
              { key: "scored_text", label: "Scored" },
            ]}
            rows={directoryList.map((r) => {
              const assignedCount = r.user_id
                ? (assignments ?? []).filter((a) => a.referee_user_id === r.user_id).length
                : 0;
              const scoredCount = r.user_id
                ? (scores ?? []).filter((s) => s.referee_user_id === r.user_id).length
                : 0;
              return {
                id: r.id,
                referee: r.full_name || r.email || "",
                rank: r.karate_rank ?? "",
                email: r.email ?? "",
                phone: r.phone ?? "",
                telegram: refereeTelegramLink ? (
                  <a
                    href={refereeTelegramLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-[#1c7fb5] underline underline-offset-2"
                  >
                    Referee group
                  </a>
                ) : (
                  ""
                ),
                country: r.home_country ?? "",
                assigned: r.user_id ? String(assignedCount) : "No login yet",
                scored:
                  r.user_id && assignedCount > scoredCount ? (
                    <>
                      {scoredCount}{" "}
                      <span className="ml-1.5 text-xs text-amber-600">({assignedCount - scoredCount} pending)</span>
                    </>
                  ) : (
                    String(scoredCount)
                  ),
                scored_text: String(scoredCount),
              };
            })}
          />
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
              {canManageJudging ? (
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
              <div className="space-y-4">
                {(() => {
                  // Live leaderboard within this competition: rank every
                  // scored, non-disqualified video by its current average —
                  // "Winner in line" position, updating as judges score.
                  const ranked = compVideos
                    .map((v) => {
                      const assigned = assignedByVideo.get(v.id) ?? [];
                      const scores = assigned
                        .map((uid) => scoreByKey.get(`${v.id}:${uid}`))
                        .filter((s): s is number => s != null);
                      return { v, dq: isDisqualified(scores), final: finalScore(scores) };
                    });
                  const queueByVideoId = new Map<string, number>();
                  ranked
                    .filter((r) => !r.dq && r.final != null)
                    .sort((a, b) => (b.final ?? 0) - (a.final ?? 0))
                    .forEach((r, i) => queueByVideoId.set(r.v.id, i + 1));
                  return ranked.map(({ v, dq }) =>
                    renderVideoCard(v, queueByVideoId.get(v.id) ?? null, dq, c.judges_required),
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </AdminShell>
  );
}
