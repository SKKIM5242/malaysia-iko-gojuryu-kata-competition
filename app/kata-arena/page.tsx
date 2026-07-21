import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCategories, schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { groupArenaByKata, loadKataArena, type ArenaEntry } from "@/lib/arena";
import { CategoryName, NoTranslate, SetupNotice, SiteFooter, SiteHeader } from "@/components/ui";
import ArenaFilterBar from "@/components/ArenaFilterBar";
import { kataBases, splitCategoryName } from "@/lib/division";
import { winnersRevealed } from "@/lib/winners";
import AuthForms from "@/components/AuthForms";
import ClaimForm from "@/components/ClaimForm";
import VideoWatchButton from "@/components/VideoWatchButton";
import { isWithinSignInQuota } from "@/lib/sign-in-quota";
import SubscriptionBlocked from "@/components/SubscriptionBlocked";
import EmailVerificationBlocked from "@/components/EmailVerificationBlocked";
import { isEmailVerified } from "@/lib/email-verification";
import { signOut } from "@/app/actions/auth";
import { ensureProfile } from "@/lib/ensure-profile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kata Arena" };

const PRIVILEGED_ROLES = ["admin", "organizer", "staff", "customer_support", "referee", "audience"];

interface ProfileRow {
  role: "participant" | "referee" | "staff" | "admin" | "organizer" | "customer_support" | "audience" | "school" | "sensei";
  full_name: string | null;
  approved: boolean;
  participant_id: string | null;
  registration_id: string | null;
  record_attempts: number;
  bonus_record_attempts: number;
  school_id: string | null;
  sensei_id: string | null;
  sign_in_limit: number | null;
  sign_in_count: number;
  sign_in_valid_from: string | null;
  sign_in_valid_until: string | null;
}

/** Round status indicator, derived purely from the assigned judges' scores
 * — not a button. Gray while judging is still in progress; red if any one
 * judge gave a Total Score of 0 (disqualified, no score shown); green with
 * the total once every required judge has scored and nobody gave a 0. */
function StatusDot({ entry, judgesRequired }: { entry: ArenaEntry; judgesRequired: number }) {
  const complete = entry.scoresSubmitted >= judgesRequired;
  if (!complete) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-500">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
        Judging {entry.scoresSubmitted}/{judgesRequired}
      </span>
    );
  }
  if (entry.disqualified) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-red-600" />
        Disqualified
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">
      <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-green-600" />
      Score {entry.finalScore != null ? entry.finalScore.toFixed(1) : "—"}
    </span>
  );
}

function RecordingCard({
  entry,
  number,
  judgesRequired,
  showJudgeScores,
  ownDelete,
}: {
  entry: ArenaEntry;
  number: number;
  judgesRequired: number;
  showJudgeScores: boolean;
  /** Set only for the signed-in participant's own entry — renders a Delete
   * option (capped at 3 + any purchased bonus) inside the Watch modal. */
  ownDelete?: { registrationId: string; attemptsUsed: number; maxAttempts: number; hasPendingPurchase: boolean };
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">
            {number}
          </span>
          <div>
            <p className="font-bold text-neutral-900">{entry.participantName}</p>
            <p className="text-sm text-neutral-500"><CategoryName name={entry.categoryName} /></p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot entry={entry} judgesRequired={judgesRequired} />
          <VideoWatchButton url={entry.playbackUrl} deletable={ownDelete} />
        </div>
      </div>
      {showJudgeScores && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-8">
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

function KataGroups({
  arena,
  judgesRequired,
  showJudgeScores,
  ownParticipantId,
  ownDelete,
  emptyMessage,
}: {
  arena: ArenaEntry[];
  judgesRequired: number;
  showJudgeScores: boolean;
  ownParticipantId?: string | null;
  ownDelete?: { registrationId: string; attemptsUsed: number; maxAttempts: number; hasPendingPurchase: boolean };
  emptyMessage: string;
}) {
  if (arena.length === 0) return <p className="text-sm text-neutral-400">{emptyMessage}</p>;
  return (
    <div className="space-y-2">
      {groupArenaByKata(arena).map(([base, entries]) => (
        <details key={base} className="rounded-lg border border-neutral-200 bg-white shadow-sm" open>
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50">
            <NoTranslate>{base}</NoTranslate>{" "}
            <span className="font-normal text-neutral-400">
              ({entries.length} recording{entries.length === 1 ? "" : "s"})
            </span>
          </summary>
          <div className="space-y-3 px-4 pb-4 pt-1">
            {entries.map((a, i) => (
              <RecordingCard
                key={a.videoId}
                entry={a}
                number={i + 1}
                judgesRequired={judgesRequired}
                showJudgeScores={showJudgeScores}
                ownDelete={ownParticipantId && a.participantId === ownParticipantId ? ownDelete : undefined}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

/** Builds the dropdown option lists from whatever recordings are actually
 * loaded, and applies the URL-selected filters to the entries. */
function arenaFilterTools(entries: ArenaEntry[], f: { kata?: string; belt?: string; age?: string; sex?: string }) {
  const katas = new Set<string>();
  const belts = new Set<string>();
  const ages = new Set<string>();
  const sexes = new Set<string>();
  for (const e of entries) {
    const p = splitCategoryName(e.categoryName);
    if (p.kata) katas.add(p.kata);
    if (p.belt) belts.add(p.belt);
    if (p.age) ages.add(p.age);
    if (p.sex) sexes.add(p.sex);
  }
  const apply = (list: ArenaEntry[]) =>
    list.filter((e) => {
      const p = splitCategoryName(e.categoryName);
      if (f.kata && p.kata !== f.kata) return false;
      if (f.belt && p.belt !== f.belt) return false;
      if (f.age && p.age !== f.age) return false;
      if (f.sex && p.sex !== f.sex) return false;
      return true;
    });
  return {
    katas: [...katas].sort(),
    belts: [...belts].sort(),
    ages: [...ages].sort(),
    sexes: [...sexes].sort(),
    apply,
  };
}

export default async function KataArenaPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; tier?: string; kata?: string; belt?: string; age?: string; sex?: string }>;
}) {
  const { mode, tier, kata, belt, age, sex } = await searchParams;
  const filterParams = { kata, belt, age, sex };
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
            Sign in to watch kata recordings. Every submitted recording is visible to every
            signed-in account as soon as it&apos;s submitted, listed by kata event in submission
            order, with a green (qualified, with total score) or red (disqualified) status once
            judging is complete.
          </p>
          <AuthForms defaultMode={mode === "signup" ? "signup" : "signin"} />
        </main>
        <SiteFooter />
      </>
    );
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select(
      "role, full_name, approved, participant_id, registration_id, record_attempts, bonus_record_attempts, school_id, sensei_id, sign_in_limit, sign_in_count, sign_in_valid_from, sign_in_valid_until",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const profile = (profileData as ProfileRow | null) ?? (await ensureProfile<ProfileRow>(user));

  if (!profile) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-2 text-sm text-neutral-500">
            We couldn&apos;t set up your account automatically. Please sign out and sign in again
            — if this keeps happening, contact the organizer with the email you signed up with.
          </p>
        </main>
        <SiteFooter />
      </>
    );
  }

  const signOutButtonForm = (
    <form action={signOut}>
      <button className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
        Sign out
      </button>
    </form>
  );

  if (!(await isEmailVerified(user.id))) {
    return (
      <>
        <SiteHeader />
        <EmailVerificationBlocked title="Kata Arena" signOutForm={signOutButtonForm} />
        <SiteFooter />
      </>
    );
  }

  const quota = isWithinSignInQuota(profile);
  if (!quota.ok) {
    return (
      <>
        <SiteHeader />
        <SubscriptionBlocked title="Kata Arena" reason={quota.reason!} signOutForm={signOutButtonForm} />
        <SiteFooter />
      </>
    );
  }

  // ── Participant: link registration first if not done yet. A participant's
  // "approved" flag is just a byproduct of claiming (see ClaimForm), not an
  // organizer-approval concept like the other roles below, so it's checked
  // here instead of the general !approved gate. ──────────────────────────
  if (profile.role === "participant" && !profile.registration_id) {
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

  if (profile.role !== "participant" && !profile.approved) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Your account is awaiting the organizer&apos;s approval.{" "}
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

  // ── Everyone except plain participants: every competition, every
  // recording, in submission order — no school/sensei ownership filter and
  // no deadline gate. Individual judge-by-judge scores stay limited to the
  // organising/judging roles (PRIVILEGED_ROLES); School/Sensei see the same
  // round status + total as everyone else. ──────────────────────────────
  if (profile.role !== "participant") {
    const competitions = await getAllCompetitions();
    const showJudgeScores = PRIVILEGED_ROLES.includes(profile.role);
    // Audience sees judge-by-judge scores only once a competition's Winners
    // are finalized; before that they see submitted recordings with round
    // status only. Every other privileged role sees scores live.
    const isAudience = profile.role === "audience";
    const shownCompetitions = tier ? competitions.filter((c) => c.id === tier) : competitions;
    const loaded = await Promise.all(
      shownCompetitions.map(async (c) => ({ competition: c, arena: await loadKataArena(supabase, c.id) })),
    );
    // The Kata filter lists every registered kata event for the shown
    // tier(s), not just ones with a submission so far — otherwise a kata
    // nobody has recorded yet simply can't be filtered to.
    const categoriesForShown = await Promise.all(shownCompetitions.map((c) => getCategories(c.id)));
    const allKatas = kataBases(categoriesForShown.flat()).sort();
    // School/Sensei logins are scoped to their own students — their own
    // competition tier and kata events only, never the whole arena. Once a
    // competition's Winners are announced, that scoping lifts for it and
    // they can view every participant's recording, same as everyone else.
    const arenas = loaded
      .map(({ competition, arena }) => {
        const revealed = winnersRevealed(competition.registration_deadline, competition.winners_announce_date);
        const scoped =
          profile.role === "school" && !revealed
            ? arena.filter((e) => e.schoolId != null && e.schoolId === profile.school_id)
            : profile.role === "sensei" && !revealed
              ? arena.filter((e) => e.senseiId != null && e.senseiId === profile.sensei_id)
              : arena;
        return { competition, arena: scoped, revealed };
      })
      .filter(({ arena, revealed }) => !["school", "sensei"].includes(profile.role) || revealed || arena.length > 0);
    const tools = arenaFilterTools(
      arenas.flatMap((a) => a.arena),
      filterParams,
    );
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
          <p className="mt-1 mb-2 text-sm text-neutral-500">
            Every submitted recording, listed by kata event in submission order.{" "}
            {showJudgeScores
              ? "Each referee's individual score is shown; the trimmed-mean total appears once judging is complete."
              : "A green status shows the total once judging is complete; red means disqualified by a judge."}
          </p>
          {showJudgeScores && (
            <p className="mb-4 text-xs font-semibold text-red-700">
              A Referee/Judge&apos;s score is final once submitted — no appeal is available.
            </p>
          )}
          <p className="mb-4 text-sm">
            <Link href="/kata-categories" className="font-semibold text-red-700 underline underline-offset-2">
              Browse recordings by kata category →
            </Link>
          </p>
          <ArenaFilterBar
            tiers={competitions.map((c) => ({ id: c.id, name: c.name }))}
            katas={allKatas}
            belts={tools.belts}
            ages={tools.ages}
            sexes={tools.sexes}
          />
          {arenas.length === 0 ? (
            <p className="text-sm text-neutral-400">No competitions yet.</p>
          ) : (
            arenas.map(({ competition: c, arena, revealed }) => (
              <div key={c.id} className="mb-10">
                <h2 className="mb-3 text-lg font-bold">{c.name}</h2>
                {isAudience && !revealed && (
                  <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Judge scores for this competition appear after Winners are finalized — until
                    then you can watch every submitted recording with its round status.
                  </p>
                )}
                {["school", "sensei"].includes(profile.role) && revealed && (
                  <p className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
                    Winners are announced for this competition — you can now view every
                    participant&apos;s recording, not just your own {profile.role === "school" ? "school" : "students"}.
                  </p>
                )}
                <KataGroups
                  arena={tools.apply(arena)}
                  judgesRequired={c.judges_required}
                  showJudgeScores={isAudience ? winnersRevealed(c.registration_deadline, c.winners_announce_date) : showJudgeScores}
                  emptyMessage="No recordings match — clear the filters above or check back later."
                />
              </div>
            ))
          )}
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Participant: their own competition's full arena — every participant
  // in it, not just their own entry. ─────────────────────────────────────
  const { data: registration } = await supabase
    .from("registrations")
    .select("competition:competitions(id, name, judges_required)")
    .eq("id", profile.registration_id)
    .maybeSingle();
  const competition = (
    registration as unknown as {
      competition: { id: string; name: string; judges_required: number } | null;
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

  const arena = await loadKataArena(supabase, competition.id);
  const participantTools = arenaFilterTools(arena, filterParams);
  const maxAttempts = 3 + (profile.bonus_record_attempts ?? 0);
  const { data: pendingPurchase } = await supabase
    .from("attempt_purchases")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();
  const hasPendingPurchase = !!pendingPurchase;
  const hasOwnRecording = arena.some((a) => a.participantId === profile.participant_id);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Kata Arena</h1>
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          {competition.name}. Every submitted recording is listed below by kata event, in
          submission order — green shows the total once judging is complete, red means
          disqualified by a judge.
        </p>
        {!hasOwnRecording && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">You haven&apos;t recorded your kata yet.</p>
            <p className="mt-1 text-sm text-red-800">
              Recording uses your device&apos;s camera, so it happens on the My Account page.
            </p>
            <Link
              href="/account"
              className="mt-3 inline-block rounded-md bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600"
            >
              Start Recording
            </Link>
          </div>
        )}
        <ArenaFilterBar
          tiers={[]}
          showTier={false}
          katas={participantTools.katas}
          belts={participantTools.belts}
          ages={participantTools.ages}
          sexes={participantTools.sexes}
        />
        <KataGroups
          arena={participantTools.apply(arena)}
          judgesRequired={competition.judges_required}
          showJudgeScores={false}
          ownParticipantId={profile.participant_id}
          ownDelete={
            profile.registration_id
              ? {
                  registrationId: profile.registration_id,
                  attemptsUsed: profile.record_attempts,
                  maxAttempts,
                  hasPendingPurchase,
                }
              : undefined
          }
          emptyMessage="No recordings submitted yet."
        />
      </main>
      <SiteFooter />
    </>
  );
}
