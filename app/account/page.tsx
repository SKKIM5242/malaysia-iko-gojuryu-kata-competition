import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { schemaReady } from "@/lib/data";
import { SetupNotice, SiteFooter, SiteHeader, TelegramFullAccessLinks } from "@/components/ui";
import AuthForms from "@/components/AuthForms";
import ClaimForm from "@/components/ClaimForm";
import KataRecorder from "@/components/KataRecorder";
import RefereeScoring, { type ScoringItem } from "@/components/RefereeScoring";
import { getAllTelegramLinks, getTelegramBotConnectUrl } from "@/lib/telegram";
import { finalScore } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export const metadata = { title: "My account" };

interface ProfileRow {
  user_id: string;
  role: "participant" | "referee" | "staff" | "admin";
  full_name: string | null;
  country: string | null;
  approved: boolean;
  participant_id: string | null;
  registration_id: string | null;
  record_attempts: number;
  telegram_chat_id: string | null;
}

interface ArenaEntry {
  videoId: string;
  participantName: string;
  categoryName: string | null;
  playbackUrl: string | null;
  finalScore: number | null;
}

/** All recordings + final (trimmed-mean) scores for a competition — shown to
 * participants only after that competition's registration deadline passes. */
async function loadKataArena(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitionId: string,
): Promise<ArenaEntry[]> {
  const { data: regs } = await supabase.from("registrations").select("id").eq("competition_id", competitionId);
  const regIds = (regs ?? []).map((r) => r.id as string);
  if (regIds.length === 0) return [];

  const { data: videos } = await supabase
    .from("kata_videos")
    .select(
      "id, storage_path, participant:participants(full_name), registration:registrations(category:categories(name))",
    )
    .in("registration_id", regIds);
  const videoList =
    (videos as unknown as Array<{
      id: string;
      storage_path: string;
      participant: { full_name: string } | null;
      registration: { category: { name: string } | null } | null;
    }>) ?? [];
  if (videoList.length === 0) return [];

  const videoIds = videoList.map((v) => v.id);
  const { data: scores } = await supabase.from("video_scores").select("video_id, score").in("video_id", videoIds);
  const scoresByVideo = new Map<string, number[]>();
  for (const s of scores ?? []) {
    const list = scoresByVideo.get(s.video_id as string) ?? [];
    list.push(Number(s.score));
    scoresByVideo.set(s.video_id as string, list);
  }

  return Promise.all(
    videoList.map(async (v) => {
      const { data: signed } = await supabase.storage.from("kata-videos").createSignedUrl(v.storage_path, 3600);
      return {
        videoId: v.id,
        participantName: v.participant?.full_name ?? "Unknown participant",
        categoryName: v.registration?.category?.name ?? null,
        playbackUrl: signed?.signedUrl ?? null,
        finalScore: finalScore(scoresByVideo.get(v.id) ?? []),
      };
    }),
  );
}

function watermarkText(eventDate: string | null | undefined): string {
  const label = eventDate
    ? new Date(eventDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "Sep 2026";
  return `Malaysia Open - IKO Goju-ryu Karate-do - Kata Competition ${label}`;
}

export default async function AccountPage() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10"><SetupNotice /></main>
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
          <h1 className="mb-2 text-2xl font-bold tracking-tight">My account</h1>
          <p className="mb-8 text-sm text-neutral-500">
            Sign in or create an account to record your kata, judge as a referee, or use your
            organiser/staff access.
          </p>
          <AuthForms />
        </main>
        <SiteFooter />
      </>
    );
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = profileData as ProfileRow | null;

  const SignOutButton = (
    <form action={signOut}>
      <button className="text-sm text-neutral-400 underline underline-offset-2 hover:text-neutral-700">
        Sign out
      </button>
    </form>
  );

  if (!profile) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold">My account</h1>
          <p className="mt-2 text-sm text-neutral-500">Setting up your account… please refresh in a moment.</p>
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Staff / Admin ────────────────────────────────────────────────────────
  if (profile.role === "staff" || profile.role === "admin") {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold">Admin / Organizer / Customer Support</h1>
          {profile.approved ? (
            <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-6">
              <p className="font-semibold text-green-900">Your account is approved.</p>
              <p className="mt-1 text-sm text-green-800">
                You have unlimited sign-in access — no payment required. Manage the competition in{" "}
                <Link href="/admin" className="underline font-semibold">the admin panel</Link>.
              </p>
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-green-900">
                  Full access — every Telegram group:
                </p>
                <TelegramFullAccessLinks links={getAllTelegramLinks()} />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
              <p className="font-semibold text-amber-900">Waiting for organiser approval.</p>
              <p className="mt-1 text-sm text-amber-800">
                Your Admin / Organizer / Customer Support account needs approval, or a valid
                invitation code at sign-up, before it activates. Contact the organiser.
              </p>
            </div>
          )}
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Referee / Judge ──────────────────────────────────────────────────────
  if (profile.role === "referee") {
    if (!profile.approved) {
      return (
        <>
          <SiteHeader />
          <main className="mx-auto max-w-2xl px-4 py-10">
            <h1 className="text-2xl font-bold">Referee / Judge</h1>
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
              <p className="font-semibold text-amber-900">Waiting for approval.</p>
              <p className="mt-1 text-sm text-amber-800">
                Your Referee / Judge account activates once the organiser confirms your USD 100
                deposit (or your invitation code — enter it at sign-up next time).
              </p>
            </div>
            <div className="mt-4">{SignOutButton}</div>
          </main>
          <SiteFooter />
        </>
      );
    }

    const { data: assignments } = await supabase
      .from("referee_assignments")
      .select("video_id")
      .eq("referee_user_id", user.id);
    const videoIds = (assignments ?? []).map((a) => a.video_id as string);

    let items: ScoringItem[] = [];
    if (videoIds.length > 0) {
      const { data: videos } = await supabase
        .from("kata_videos")
        .select("id, storage_path, participant:participants(full_name, home_country), registration:registrations(category:categories(name))")
        .in("id", videoIds);
      const { data: myScores } = await supabase
        .from("video_scores")
        .select("video_id, score")
        .eq("referee_user_id", user.id)
        .in("video_id", videoIds);
      const scoreMap = new Map((myScores ?? []).map((s) => [s.video_id as string, Number(s.score)]));

      items = await Promise.all(
        ((videos as unknown as Array<{
          id: string;
          storage_path: string;
          participant: { full_name: string; home_country: string | null } | null;
          registration: { category: { name: string } | null } | null;
        }>) ?? []).map(async (v) => {
          const { data: signed } = await supabase.storage
            .from("kata-videos")
            .createSignedUrl(v.storage_path, 3600);
          return {
            videoId: v.id,
            participantName: v.participant?.full_name ?? "Unknown participant",
            participantCountry: v.participant?.home_country ?? null,
            categoryName: v.registration?.category?.name ?? null,
            playbackUrl: signed?.signedUrl ?? null,
            existingScore: scoreMap.get(v.id) ?? null,
          };
        }),
      );
    }

    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold">Referee / Judge scoring</h1>
          <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <p className="mb-2 text-sm font-semibold text-neutral-700">
              Full access — every Telegram group:
            </p>
            <TelegramFullAccessLinks links={getAllTelegramLinks()} />
          </div>
          {(() => {
            const connectUrl = getTelegramBotConnectUrl(user.id);
            if (profile.telegram_chat_id) {
              return (
                <p className="mt-3 text-sm font-semibold text-green-700">
                  ✅ Telegram connected — you&apos;ll be notified here when you&apos;re assigned a new recording.
                </p>
              );
            }
            if (!connectUrl) return null;
            return (
              <a
                href={connectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-md border border-[#229ED9]/30 bg-[#229ED9]/5 px-4 py-2.5 text-sm font-semibold text-[#1c7fb5] hover:bg-[#229ED9]/10"
              >
                Connect Telegram for assignment notifications
              </a>
            );
          })()}
          <div className="mt-6">
            <RefereeScoring refereeName={profile.full_name ?? "Judge"} refereeCountry={profile.country} items={items} />
          </div>
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Participant ──────────────────────────────────────────────────────────
  if (!profile.registration_id) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold">Link your registration</h1>
          <p className="mt-1 mb-6 text-sm text-neutral-500">
            Signed in as {profile.full_name ?? user.email}.
          </p>
          <ClaimForm />
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const { data: existingVideo } = await supabase
    .from("kata_videos")
    .select("id, storage_path")
    .eq("registration_id", profile.registration_id)
    .maybeSingle();

  const { data: registration } = await supabase
    .from("registrations")
    .select("competition:competitions(id, event_date, registration_deadline)")
    .eq("id", profile.registration_id)
    .maybeSingle();
  const competition = (
    registration as unknown as {
      competition: { id: string; event_date: string | null; registration_deadline: string | null } | null;
    } | null
  )?.competition ?? null;
  const eventDate = competition?.event_date ?? null;
  const deadlinePassed =
    !!competition?.registration_deadline &&
    new Date(competition.registration_deadline + "T23:59:59") < new Date();

  let ownVideoUrl: string | null = null;
  if (existingVideo) {
    const { data: signed } = await supabase.storage
      .from("kata-videos")
      .createSignedUrl(existingVideo.storage_path, 3600);
    ownVideoUrl = signed?.signedUrl ?? null;
  }

  let arena: ArenaEntry[] = [];
  if (existingVideo && deadlinePassed && competition) {
    arena = await loadKataArena(supabase, competition.id);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">{deadlinePassed && existingVideo ? "Kata Arena" : "Record your kata"}</h1>
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          Signed in as {profile.full_name ?? user.email}.
        </p>
        {existingVideo ? (
          <div className="space-y-8">
            <div className="rounded-lg border border-green-300 bg-green-50 p-6">
              <p className="font-bold text-green-900">✅ Your kata recording is submitted</p>
              {ownVideoUrl ? (
                <video controls className="mt-3 w-full rounded-md bg-black" src={ownVideoUrl} />
              ) : (
                <p className="mt-2 text-sm text-green-800">Thank you — it is ready for judging.</p>
              )}
              {!deadlinePassed && (
                <p className="mt-2 text-xs text-green-800">
                  Other participants&apos; recordings and scores unlock here once the registration
                  deadline passes{" "}
                  {competition?.registration_deadline && (
                    <>(on {competition.registration_deadline})</>
                  )}
                  .
                </p>
              )}
            </div>
            {deadlinePassed && (
              <div>
                <h2 className="mb-1 text-lg font-bold">All recordings &amp; final scores</h2>
                <p className="mb-4 text-sm text-neutral-500">
                  The registration deadline has passed — every participant&apos;s recording and final
                  score for this competition is now visible below.
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
                            {a.finalScore != null && (
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
              </div>
            )}
          </div>
        ) : (
          <KataRecorder initialAttempts={profile.record_attempts} watermark={watermarkText(eventDate)} />
        )}
        <div className="mt-6">{SignOutButton}</div>
      </main>
      <SiteFooter />
    </>
  );
}
