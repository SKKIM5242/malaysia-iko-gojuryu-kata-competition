import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { claimAndStartRecording } from "@/app/actions/account";
import { schemaReady } from "@/lib/data";
import { SetupNotice, SiteFooter, SiteHeader, TelegramFullAccessLinks } from "@/components/ui";
import AuthForms from "@/components/AuthForms";
import ClaimForm from "@/components/ClaimForm";
import KataRecorder from "@/components/KataRecorder";
import VideoWatchButton from "@/components/VideoWatchButton";
import RefereeScoring, { type ScoringItem } from "@/components/RefereeScoring";
import { getAllTelegramLinks, getTelegramBotConnectUrl } from "@/lib/telegram";
import { isWithinSignInQuota } from "@/lib/sign-in-quota";
import SubscriptionBlocked from "@/components/SubscriptionBlocked";

export const dynamic = "force-dynamic";

export const metadata = { title: "My account" };

interface ProfileRow {
  user_id: string;
  role: "participant" | "referee" | "staff" | "admin" | "organizer" | "customer_support" | "audience";
  full_name: string | null;
  country: string | null;
  email: string | null;
  approved: boolean;
  participant_id: string | null;
  registration_id: string | null;
  record_attempts: number;
  bonus_record_attempts: number;
  telegram_chat_id: string | null;
  sign_in_limit: number | null;
  sign_in_count: number;
  sign_in_valid_from: string | null;
  sign_in_valid_until: string | null;
}

interface PendingRegistration {
  id: string;
  categoryName: string | null;
  competitionName: string | null;
}

/** Every OTHER paid registration whose participant email matches this
 * account's sign-in email and that has no recording yet — lets a
 * participant who registered up to 3 times switch which one they're
 * currently recording without retyping reference ID + IC each time. */
async function getPendingRegistrations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string | null,
  excludeRegistrationId: string | null,
): Promise<PendingRegistration[]> {
  if (!email) return [];
  const { data: myParticipants } = await supabase.from("participants").select("id").ilike("email", email);
  const participantIds = (myParticipants ?? []).map((p) => p.id as string);
  if (participantIds.length === 0) return [];

  const { data: regs } = await supabase
    .from("registrations")
    .select("id, category:categories(name), competition:competitions(name)")
    .in("participant_id", participantIds)
    .eq("payment_status", "paid");
  const regList =
    (regs as unknown as Array<{
      id: string;
      category: { name: string } | null;
      competition: { name: string } | null;
    }>) ?? [];
  if (regList.length === 0) return [];

  const regIds = regList.map((r) => r.id);
  const { data: videos } = await supabase.from("kata_videos").select("registration_id").in("registration_id", regIds);
  const recorded = new Set((videos ?? []).map((v) => v.registration_id as string));

  return regList
    .filter((r) => !recorded.has(r.id) && r.id !== excludeRegistrationId)
    .map((r) => ({ id: r.id, categoryName: r.category?.name ?? null, competitionName: r.competition?.name ?? null }));
}

function PendingRecordingsList({ items }: { items: PendingRegistration[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="font-bold text-amber-900">
        {items.length} more registration{items.length === 1 ? "" : "s"} waiting for a recording
      </p>
      <div className="mt-3 space-y-2">
        {items.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-2"
          >
            <div>
              <p className="text-sm font-semibold text-neutral-800">{r.categoryName ?? "Category not set"}</p>
              <p className="text-xs text-neutral-500">{r.competitionName ?? ""}</p>
            </div>
            <form action={claimAndStartRecording}>
              <input type="hidden" name="registration_id" value={r.id} />
              <button className="rounded-md bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600">
                Start Recording
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}

function watermarkText(eventDate: string | null | undefined): string {
  const label = eventDate
    ? new Date(eventDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : "Sep 2026";
  return `Malaysia Open - IKO Goju-ryu Karate-do - Kata Competition ${label}`;
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; claim_error?: string }>;
}) {
  const { mode, claim_error: claimError } = await searchParams;
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
          <AuthForms defaultMode={mode === "signup" ? "signup" : "signin"} />
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
    <div>
      <form action={signOut}>
        <button className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
          Sign out
        </button>
      </form>
      <p className="mt-1.5 text-xs text-neutral-400">
        Signing out takes you to the Sign in / Create account page.
      </p>
    </div>
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

  const quota = isWithinSignInQuota(profile);
  if (!quota.ok) {
    return (
      <>
        <SiteHeader />
        <SubscriptionBlocked title="My account" reason={quota.reason!} signOutForm={SignOutButton} />
        <SiteFooter />
      </>
    );
  }

  // ── Staff / Admin / Organizer / Customer Support ────────────────────────
  if (["staff", "admin", "organizer", "customer_support"].includes(profile.role)) {
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

  // ── Audience / Spectator ─────────────────────────────────────────────────
  if (profile.role === "audience") {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold">Audience / Spectator</h1>
          {profile.approved ? (
            <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-6">
              <p className="font-semibold text-green-900">Your account is approved.</p>
              <p className="mt-1 text-sm text-green-800">
                Watch every submitted kata recording in{" "}
                <Link href="/kata-arena" className="underline font-semibold">Kata Arena</Link>.
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
              <p className="font-semibold text-amber-900">Waiting for approval.</p>
              <p className="mt-1 text-sm text-amber-800">
                Your Audience / Spectator account activates once the organiser confirms your USD 10
                sign-in (or your invitation code — enter it at sign-up next time).
              </p>
            </div>
          )}
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Participant ──────────────────────────────────────────────────────────
  if (!profile.registration_id) {
    const pending = await getPendingRegistrations(supabase, profile.email, null);
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold">Link your registration</h1>
          <p className="mt-1 mb-6 text-sm text-neutral-500">
            Signed in as {profile.full_name ?? user.email}.
          </p>
          {claimError && (
            <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
              {claimError}
            </div>
          )}
          {pending.length > 0 && (
            <div className="mb-6">
              <PendingRecordingsList items={pending} />
            </div>
          )}
          <p className="mb-2 text-sm font-semibold text-neutral-700">
            Registered with a different email, or none of the above is yours?
          </p>
          <ClaimForm />
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const pendingOthers = await getPendingRegistrations(supabase, profile.email, profile.registration_id);

  const maxAttempts = 3 + (profile.bonus_record_attempts ?? 0);
  const { data: pendingPurchase } = await supabase
    .from("attempt_purchases")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .maybeSingle();
  const hasPendingPurchase = !!pendingPurchase;

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

  let ownVideoUrl: string | null = null;
  if (existingVideo) {
    const { data: signed } = await supabase.storage
      .from("kata-videos")
      .createSignedUrl(existingVideo.storage_path, 3600);
    ownVideoUrl = signed?.signedUrl ?? null;
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold">{existingVideo ? "Your kata recording" : "Record your kata"}</h1>
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          Signed in as {profile.full_name ?? user.email}.
        </p>
        {existingVideo ? (
          <div className="space-y-8">
            <div className="rounded-lg border border-green-300 bg-green-50 p-6">
              <p className="font-bold text-green-900">✅ Your kata recording is submitted</p>
              {ownVideoUrl ? (
                <div className="mt-3">
                  <VideoWatchButton
                    url={ownVideoUrl}
                    label="Watch your recording"
                    className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
                    deletable={{
                      registrationId: profile.registration_id,
                      attemptsUsed: profile.record_attempts,
                      maxAttempts,
                      hasPendingPurchase,
                    }}
                  />
                </div>
              ) : (
                <p className="mt-2 text-sm text-green-800">Thank you — it is ready for judging.</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm text-neutral-500">
                Watch every participant&apos;s recording for this competition in Kata Arena. Final
                judge scores unlock there once winners are announced.
              </p>
              <Link
                href="/kata-arena"
                className="inline-block rounded-md bg-red-700 px-5 py-2.5 font-semibold text-white hover:bg-red-600"
              >
                Go to Kata Arena
              </Link>
            </div>
            <PendingRecordingsList items={pendingOthers} />
          </div>
        ) : (
          <div className="space-y-8">
            <KataRecorder
              initialAttempts={profile.record_attempts}
              maxAttempts={maxAttempts}
              hasPendingPurchase={hasPendingPurchase}
              watermark={watermarkText(eventDate)}
            />
            <div>
              <p className="mb-2 text-sm text-neutral-500">
                Already registered but not ready to record yet? You can still watch every submitted
                recording in Kata Arena.
              </p>
              <Link
                href="/kata-arena"
                className="inline-block rounded-md border border-neutral-300 bg-white px-5 py-2.5 font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Go to Kata Arena
              </Link>
            </div>
            <PendingRecordingsList items={pendingOthers} />
          </div>
        )}
        <div className="mt-6">{SignOutButton}</div>
      </main>
      <SiteFooter />
    </>
  );
}
