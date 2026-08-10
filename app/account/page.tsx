import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/ensure-profile";
import { signOut } from "@/app/actions/auth";
import { schemaReady } from "@/lib/data";
import { SetupNotice, TelegramFullAccessLinks } from "@/components/ui";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import AuthForms from "@/components/AuthForms";
import ClaimForm from "@/components/ClaimForm";
import DirectoryClaimForm from "@/components/DirectoryClaimForm";
import KataRecorder from "@/components/KataRecorder";
import VideoWatchButton from "@/components/VideoWatchButton";
import DeleteRecordingControls from "@/components/DeleteRecordingControls";
import RefereeScoring, { type ScoringItem } from "@/components/RefereeScoring";
import CertificatesSection from "@/components/CertificatesSection";
import IssueReportForm from "@/components/IssueReportForm";
import { getAllTelegramLinks, getTelegramBotConnectUrl } from "@/lib/telegram";
import { isWithinSignInQuota } from "@/lib/sign-in-quota";
import SubscriptionBlocked from "@/components/SubscriptionBlocked";
import EmailVerificationBlocked from "@/components/EmailVerificationBlocked";
import { isEmailVerified } from "@/lib/email-verification";
import SignInInfoTables from "@/components/SignInInfoTables";
import PendingRecordingsList, { type PendingRegistration } from "@/components/PendingRecordingsList";
import SignInQuotaLine from "@/components/SignInQuotaLine";
import { resolveWatermarkSettings, type WatermarkSettings } from "@/lib/watermark";
import { shortTierName } from "@/lib/invitation-codes";

export const dynamic = "force-dynamic";

export const metadata = { title: "My account" };

interface ProfileRow {
  user_id: string;
  role: "participant" | "referee" | "staff" | "admin" | "organizer" | "customer_support" | "audience" | "school" | "sensei";
  full_name: string | null;
  country: string | null;
  email: string | null;
  approved: boolean;
  participant_id: string | null;
  registration_id: string | null;
  sensei_id: string | null;
  school_id: string | null;
  record_attempts: number;
  bonus_record_attempts: number;
  telegram_chat_id: string | null;
  sign_in_limit: number | null;
  sign_in_count: number;
  sign_in_valid_from: string | null;
  sign_in_valid_until: string | null;
}

/** Every paid registration whose participant email matches this account's
 * sign-in email and that has no recording yet — including whatever
 * registration is currently "active" for the recorder, since the
 * tier-grouped summary (PendingRecordingsList) now covers every tier
 * uniformly rather than singling one out. "Start Recording" on any of them
 * swaps which registration is active without retyping reference ID + IC. */
async function getPendingRegistrations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string | null,
): Promise<PendingRegistration[]> {
  if (!email) return [];
  const { data: myParticipants } = await supabase.from("participants").select("id").ilike("email", email);
  const participantIds = (myParticipants ?? []).map((p) => p.id as string);
  if (participantIds.length === 0) return [];

  const { data: regs } = await supabase
    .from("registrations")
    .select(
      "id, category:categories(name, sort_order), competition:competitions(id, name, event_date, registration_deadline, registration_fee_usd), participant:participants(full_name)",
    )
    .in("participant_id", participantIds)
    .eq("payment_status", "paid");
  const regList =
    (regs as unknown as Array<{
      id: string;
      category: { name: string; sort_order: number } | null;
      competition: {
        id: string;
        name: string;
        event_date: string | null;
        registration_deadline: string | null;
        registration_fee_usd: number | null;
      } | null;
      participant: { full_name: string | null } | null;
    }>) ?? [];
  if (regList.length === 0) return [];

  const regIds = regList.map((r) => r.id);
  const { data: videos } = await supabase.from("kata_videos").select("registration_id").in("registration_id", regIds);
  const recorded = new Set((videos ?? []).map((v) => v.registration_id as string));

  return regList
    .filter((r) => !recorded.has(r.id) && r.competition)
    .map((r) => ({
      id: r.id,
      categoryName: r.category?.name ?? null,
      categorySortOrder: r.category?.sort_order ?? 0,
      competitionId: r.competition!.id,
      // Shortened to just the tier ("USD 10 Tier"): this reads inline in
      // sentences like "for your competition tier — X — based on today's
      // date", where the full event name is both redundant and collides
      // with the surrounding em-dashes.
      competitionName: r.competition?.name ? shortTierName(r.competition.name) : null,
      eventDate: r.competition?.event_date ?? null,
      registrationDeadline: r.competition?.registration_deadline ?? null,
      registrationFeeUsd: r.competition?.registration_fee_usd ?? null,
      participantName: r.participant?.full_name ?? null,
    }));
}

interface RecordingContext {
  /** Which registration this context actually resolved to -- the primary
   * (profile.registration_id) unless a valid ?registration= query param
   * pointed at a different one of this login's linked participants. */
  registrationId: string;
  existingVideo: { id: string; storage_path: string } | null;
  ownVideoUrl: string | null;
  /** This registration's own free-attempts usage -- independent per linked
   * registration (migration 0118), not shared across everything a login
   * can record for. */
  recordAttempts: number;
  maxAttempts: number;
  hasPendingPurchase: boolean;
  eventDate: string | null;
  registrationDeadline: string | null;
  pendingOthers: PendingRegistration[];
  /** Which kata this specific linked registration is for -- shown on the
   * recorder itself so it's obvious a "Start Recording" click on a
   * different pending item actually switched something, instead of
   * looking identical to whatever was showing before (the recorder never
   * displayed which kata it was for at all). */
  categoryName: string | null;
  /** Whose kata this is -- burned into the recording itself alongside the
   * watermark, so a login linked to several participants (a Sensei
   * recording for several students) can tell whose take is whose. */
  participantName: string | null;
  /** This registration's own tier's watermark customization (organizer-set
   * per competition, Create/Edit Competition page) -- was a single
   * hardcoded string+styling shared by every tier. */
  watermark: WatermarkSettings;
}

/** Everything needed to render the personal recording card for whichever
 * registration is linked to this profile — shared by every role branch
 * below so an Admin/Organizer/Referee/Support/Audience account that has
 * also linked a paid registration (see ClaimForm) sees the same
 * record/watch experience a plain participant login gets.
 *
 * requestedRegistrationId (from the page's own ?registration= query param)
 * lets a login linked to several participants pick which one's recorder to
 * render -- validated against profile_participants before being trusted,
 * falling back to the profile's own primary link when absent or when it
 * doesn't actually belong to this account. */
async function getRecordingContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  profile: Pick<ProfileRow, "email" | "registration_id">,
  requestedRegistrationId?: string | null,
): Promise<RecordingContext> {
  let registrationId = profile.registration_id!;
  if (requestedRegistrationId && requestedRegistrationId !== registrationId) {
    const { data: link } = await supabase
      .from("profile_participants")
      .select("registration_id")
      .eq("user_id", userId)
      .eq("registration_id", requestedRegistrationId)
      .maybeSingle();
    if (link) registrationId = link.registration_id;
  }
  const pendingOthers = await getPendingRegistrations(supabase, profile.email);
  // Re-record budget is independent per linked registration (see migration
  // 0118) -- a login linked to several participants doesn't share one pool
  // across them.
  const { data: attemptsRow } = await supabase
    .from("profile_participants")
    .select("record_attempts, bonus_record_attempts")
    .eq("user_id", userId)
    .eq("registration_id", registrationId)
    .maybeSingle();
  const recordAttempts = attemptsRow?.record_attempts ?? 0;
  const maxAttempts = 3 + (attemptsRow?.bonus_record_attempts ?? 0);
  const { data: pendingPurchase } = await supabase
    .from("attempt_purchases")
    .select("id")
    .eq("user_id", userId)
    .eq("registration_id", registrationId)
    .eq("status", "pending")
    .maybeSingle();

  const { data: existingVideo } = await supabase
    .from("kata_videos")
    .select("id, storage_path")
    .eq("registration_id", registrationId)
    .maybeSingle();

  const { data: registration } = await supabase
    .from("registrations")
    .select(
      "category:categories(name), competition:competitions(id, event_date, registration_deadline, watermark_text, watermark_font_size_px, watermark_font_family, watermark_bold, watermark_color, watermark_direction), participant:participants(full_name)",
    )
    .eq("id", registrationId)
    .maybeSingle();
  const competition = (
    registration as unknown as {
      category: { name: string } | null;
      competition:
        | ({ id: string; event_date: string | null; registration_deadline: string | null } & Parameters<
            typeof resolveWatermarkSettings
          >[0])
        | null;
      participant: { full_name: string | null } | null;
    } | null
  )?.competition ?? null;
  const categoryName =
    (
      registration as unknown as {
        category: { name: string } | null;
      } | null
    )?.category?.name ?? null;
  const participantName =
    (
      registration as unknown as {
        participant: { full_name: string | null } | null;
      } | null
    )?.participant?.full_name ?? null;

  let ownVideoUrl: string | null = null;
  if (existingVideo) {
    const { data: signed } = await supabase.storage
      .from("kata-videos")
      .createSignedUrl(existingVideo.storage_path, 3600);
    ownVideoUrl = signed?.signedUrl ?? null;
  }

  return {
    registrationId,
    existingVideo,
    ownVideoUrl,
    recordAttempts,
    maxAttempts,
    hasPendingPurchase: !!pendingPurchase,
    eventDate: competition?.event_date ?? null,
    registrationDeadline: competition?.registration_deadline ?? null,
    pendingOthers,
    categoryName,
    participantName,
    watermark: resolveWatermarkSettings(competition),
  };
}

function PersonalRecordingSection({
  ctx,
}: {
  ctx: RecordingContext;
}) {
  return (
    <div id="record-your-kata" className="mt-6 scroll-mt-28">
      <h2 className="mb-3 text-lg font-bold">
        {ctx.existingVideo ? "Your Kata Recording" : "Record Your Kata"}
      </h2>
      {ctx.existingVideo ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-green-300 bg-green-50 p-6">
            <p className="font-bold text-green-900">✅ Your kata recording is submitted</p>
            {ctx.ownVideoUrl ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <VideoWatchButton
                  url={ctx.ownVideoUrl}
                  label="Watch your recording"
                  className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
                />
                <DeleteRecordingControls
                  registrationId={ctx.registrationId}
                  attemptsUsed={ctx.recordAttempts}
                  maxAttempts={ctx.maxAttempts}
                  hasPendingPurchase={ctx.hasPendingPurchase}
                />
              </div>
            ) : (
              <p className="mt-2 text-sm text-green-800">Thank you — it is ready for judging.</p>
            )}
          </div>
          <PendingRecordingsList items={ctx.pendingOthers} />
        </div>
      ) : (
        <div className="space-y-6">
          <KataRecorder
            registrationId={ctx.registrationId}
            initialAttempts={ctx.recordAttempts}
            maxAttempts={ctx.maxAttempts}
            hasPendingPurchase={ctx.hasPendingPurchase}
            watermark={ctx.watermark}
            recordingStart={ctx.eventDate}
            recordingEnd={ctx.registrationDeadline}
            categoryName={ctx.categoryName}
            participantName={ctx.participantName}
          />
          <PendingRecordingsList items={ctx.pendingOthers} />
        </div>
      )}
    </div>
  );
}

/** Shown to every non-participant role that hasn't linked a paid
 * registration yet — collapsed by default so it doesn't crowd their own
 * role dashboard, since most staff/referee/audience accounts never need
 * it. */
function LinkRegistrationPrompt() {
  return (
    <details className="mt-6 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-700">
        Also competing as a participant? Link your paid registration
      </summary>
      <div className="mt-3">
        <ClaimForm />
      </div>
    </details>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; claim_error?: string; registration?: string }>;
}) {
  const { mode, claim_error: claimError, registration: requestedRegistrationId } = await searchParams;
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
          <h1 className="mb-2 text-2xl font-bold tracking-tight">My Account</h1>
          <p className="mb-8 text-sm text-neutral-500">
            Sign in or create an account to record your kata, judge as a referee, or use your
            organizer/staff access.
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
  const profile = (profileData as ProfileRow | null) ?? (await ensureProfile<ProfileRow>(user));

  const SignOutButton = (
    <div>
      <form action={signOut}>
        <button className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600">
          Sign out
        </button>
      </form>
      <p className="mt-1.5 text-xs text-neutral-400">
        Signing out takes you to the Sign in / Create account page.
      </p>
      <IssueReportForm />
    </div>
  );

  if (!profile) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <h1 className="text-2xl font-bold">My Account</h1>
          <p className="mt-2 text-sm text-neutral-500">
            We couldn&apos;t set up your account automatically. Please sign out and sign in again —
            if this keeps happening, contact the organizer with the email you signed up with. This
            is not related to any competition deadline; it does not affect your own recording.
          </p>
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  if (!(await isEmailVerified(user.id))) {
    return (
      <>
        <SiteHeader />
        <EmailVerificationBlocked title="My Account" signOutForm={SignOutButton} />
        <SiteFooter />
      </>
    );
  }

  let hasPendingRefereeWork = false;
  if (profile.role === "referee") {
    const { data: myAssignments } = await supabase
      .from("referee_assignments")
      .select("video_id")
      .eq("referee_user_id", user.id);
    const videoIds = (myAssignments ?? []).map((a) => a.video_id as string);
    if (videoIds.length > 0) {
      const { data: myScores } = await supabase
        .from("video_scores")
        .select("video_id")
        .eq("referee_user_id", user.id)
        .in("video_id", videoIds);
      const scoredIds = new Set((myScores ?? []).map((s) => s.video_id as string));
      hasPendingRefereeWork = videoIds.some((id) => !scoredIds.has(id));
    }
  }

  const quota = isWithinSignInQuota(profile, hasPendingRefereeWork);
  if (!quota.ok) {
    return (
      <>
        <SiteHeader />
        <SubscriptionBlocked
          title="My account"
          reason={quota.reason!}
          canRenew={quota.canRenew}
          signOutForm={SignOutButton}
          quota={{
            signInCount: profile.sign_in_count,
            signInLimit: profile.sign_in_limit,
            validFrom: profile.sign_in_valid_from,
            validUntil: profile.sign_in_valid_until,
          }}
        />
        <SiteFooter />
      </>
    );
  }

  // Every registration this login can reach -- the primary link plus
  // whatever else got bulk-linked into profile_participants (e.g. a Sensei
  // whose email is on several students' registrations). Fetched once, fed
  // into CertificatesSection below so a login linked to several
  // participants sees every one of their certificates, not just the
  // primary's.
  const { data: myLinkedRegs } = await supabase
    .from("profile_participants")
    .select("registration_id")
    .eq("user_id", user.id);
  const myRegistrationIds = [
    ...new Set([
      ...(myLinkedRegs ?? []).map((r) => r.registration_id as string),
      ...(profile.registration_id ? [profile.registration_id] : []),
    ]),
  ];

  // ── Staff / Admin / Organizer / Participant Support ────────────────────────
  if (["staff", "admin", "organizer", "customer_support"].includes(profile.role)) {
    const recordingCtx = profile.registration_id ? await getRecordingContext(supabase, user.id, profile, requestedRegistrationId) : null;
    const staffTelegramLinks = profile.approved ? await getAllTelegramLinks() : [];
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <SignInQuotaLine
            signInCount={profile.sign_in_count}
            signInLimit={profile.sign_in_limit}
            validFrom={profile.sign_in_valid_from}
            validUntil={profile.sign_in_valid_until}
            className="mb-2"
          />
          <h1 className="text-2xl font-bold">Admin / Organizer / Participant Support</h1>
          <SignInInfoTables canManage={["admin", "organizer", "staff"].includes(profile.role)} />
          {profile.approved ? (
            <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-6">
              <p className="font-semibold text-green-900">Your account is approved.</p>
              <p className="mt-1 text-sm text-green-800">
                You have unlimited sign-in access — no payment required. Manage the competition in{" "}
                <Link href="/admin" className="underline font-semibold">the admin panel</Link>.
              </p>
              {["staff", "admin", "organizer"].includes(profile.role) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href="/admin/judging"
                    className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
                  >
                    Judging page (full access)
                  </Link>
                  <Link
                    href="/kata-arena"
                    className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
                  >
                    Kata Arena
                  </Link>
                </div>
              )}
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-green-900">
                  Full access — every Telegram group:
                </p>
                <TelegramFullAccessLinks links={staffTelegramLinks} />
              </div>
              {(() => {
                const connectUrl = getTelegramBotConnectUrl(user.id);
                if (profile.telegram_chat_id) {
                  return (
                    <p className="mt-3 text-sm font-semibold text-green-700">
                      ✅ Telegram connected — you&apos;ll be notified here for issue reports, testimonial
                      removals, and other admin alerts.
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
                    Connect Telegram for admin alerts
                  </a>
                );
              })()}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
              <p className="font-semibold text-amber-900">Waiting for organizer approval.</p>
              <p className="mt-1 text-sm text-amber-800">
                Your Admin / Organizer / Participant Support account needs the organizer&apos;s
                approval before it activates. Contact the organizer.
              </p>
            </div>
          )}
          {recordingCtx ? (
            <PersonalRecordingSection ctx={recordingCtx} />
          ) : (
            <LinkRegistrationPrompt />
          )}
          <CertificatesSection
            userId={user.id}
            registrationIds={myRegistrationIds}
            senseiId={profile.sensei_id}
            schoolId={profile.school_id}
            isSupport={profile.role === "customer_support"}
          />
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
            <SignInQuotaLine
              signInCount={profile.sign_in_count}
              signInLimit={profile.sign_in_limit}
              validFrom={profile.sign_in_valid_from}
              validUntil={profile.sign_in_valid_until}
              className="mb-2"
            />
            <h1 className="text-2xl font-bold">Referee / Judge</h1>
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
              <p className="font-semibold text-amber-900">Waiting for approval.</p>
              <p className="mt-1 text-sm text-amber-800">
                Your Referee / Judge account activates once the organizer confirms your USD 100
                deposit.
              </p>
            </div>
            <div className="mt-4">{SignOutButton}</div>
          </main>
          <SiteFooter />
        </>
      );
    }

    const recordingCtx = profile.registration_id ? await getRecordingContext(supabase, user.id, profile, requestedRegistrationId) : null;
    const refereeTelegramLinks = await getAllTelegramLinks();

    const { data: assignments } = await supabase
      .from("referee_assignments")
      .select("video_id")
      .eq("referee_user_id", user.id);
    const videoIds = (assignments ?? []).map((a) => a.video_id as string);

    let items: ScoringItem[] = [];
    if (videoIds.length > 0) {
      const { data: videos } = await supabase
        .from("kata_videos")
        .select(
          "id, storage_path, participant:participants(full_name, home_country), registration:registrations(category:categories(name), competition:competitions(name))",
        )
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
          registration: { category: { name: string } | null; competition: { name: string } | null } | null;
        }>) ?? []).map(async (v) => {
          const { data: signed } = await supabase.storage
            .from("kata-videos")
            .createSignedUrl(v.storage_path, 3600);
          return {
            videoId: v.id,
            participantName: v.participant?.full_name ?? "Unknown participant",
            participantCountry: v.participant?.home_country ?? null,
            categoryName: v.registration?.category?.name ?? null,
            competitionName: v.registration?.competition?.name ?? null,
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
          <SignInQuotaLine
            signInCount={profile.sign_in_count}
            signInLimit={profile.sign_in_limit}
            validFrom={profile.sign_in_valid_from}
            validUntil={profile.sign_in_valid_until}
            className="mb-2"
          />
          <h1 className="text-2xl font-bold">Referee / Judge Scoring</h1>
          <SignInInfoTables canManage={false} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/admin/judging"
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
            >
              Judging page (full access)
            </Link>
            <Link
              href="/kata-arena"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Kata Arena
            </Link>
          </div>
          <div className="mt-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <p className="mb-2 text-sm font-semibold text-neutral-700">
              Full access — every Telegram group:
            </p>
            <TelegramFullAccessLinks links={refereeTelegramLinks} />
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
          {recordingCtx ? (
            <PersonalRecordingSection ctx={recordingCtx} />
          ) : (
            <LinkRegistrationPrompt />
          )}
          <CertificatesSection
            userId={user.id}
            registrationIds={myRegistrationIds}
            senseiId={profile.sensei_id}
            schoolId={profile.school_id}
            isSupport={false}
          />
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Audience / Spectator ─────────────────────────────────────────────────
  if (profile.role === "audience") {
    const recordingCtx = profile.registration_id ? await getRecordingContext(supabase, user.id, profile, requestedRegistrationId) : null;
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <SignInQuotaLine
            signInCount={profile.sign_in_count}
            signInLimit={profile.sign_in_limit}
            validFrom={profile.sign_in_valid_from}
            validUntil={profile.sign_in_valid_until}
            className="mb-2"
          />
          <h1 className="text-2xl font-bold">Audience / Spectator</h1>
          <SignInInfoTables canManage={false} />
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
                Your Audience / Spectator account activates once the organizer confirms your USD 10
                sign-in.
              </p>
            </div>
          )}
          {recordingCtx ? (
            <PersonalRecordingSection ctx={recordingCtx} />
          ) : (
            <LinkRegistrationPrompt />
          )}
          <CertificatesSection
            userId={user.id}
            registrationIds={myRegistrationIds}
            senseiId={profile.sensei_id}
            schoolId={profile.school_id}
            isSupport={false}
          />
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── School / Dojo & Sensei ───────────────────────────────────────────────
  if (profile.role === "school" || profile.role === "sensei") {
    const recordId = profile.role === "sensei" ? profile.sensei_id : profile.school_id;
    const { data: record } = recordId
      ? await supabase
          .from(profile.role === "sensei" ? "senseis" : "schools")
          .select("name, payment_status")
          .eq("id", recordId)
          .maybeSingle()
      : { data: null };
    const label = profile.role === "sensei" ? "Sensei" : "School / Dojo";
    const recordingCtx = profile.registration_id ? await getRecordingContext(supabase, user.id, profile, requestedRegistrationId) : null;
    const paid = record?.payment_status === "paid" || record?.payment_status === "waived";
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <SignInQuotaLine
            signInCount={profile.sign_in_count}
            signInLimit={profile.sign_in_limit}
            validFrom={profile.sign_in_valid_from}
            validUntil={profile.sign_in_valid_until}
            className="mb-2"
          />
          <h1 className="text-2xl font-bold">{label}</h1>
          <SignInInfoTables canManage={false} />
          {record ? (
            <p className="mt-1 mb-4 text-sm text-neutral-500">Signed in as {record.name} ({label}).</p>
          ) : (
            <div className="mt-1 mb-4">
              <p className="text-sm text-neutral-500">
                Signed in as {profile.full_name ?? user.email}. Your account isn&apos;t linked to a{" "}
                {label.toLowerCase()} record yet — link it below, or contact the organizer.
              </p>
              <div className="mt-4">
                <DirectoryClaimForm kind={profile.role === "sensei" ? "sensei" : "school"} />
              </div>
            </div>
          )}
          {paid ? (
            <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-6">
              <p className="font-semibold text-green-900">Your account is approved.</p>
              <p className="mt-1 text-sm text-green-800">
                Watch your students&apos; submitted kata recordings in{" "}
                <Link href="/kata-arena" className="underline font-semibold">Kata Arena</Link>.
              </p>
              {(() => {
                const connectUrl = getTelegramBotConnectUrl(user.id);
                if (profile.telegram_chat_id) {
                  return (
                    <p className="mt-3 text-sm font-semibold text-green-700">
                      ✅ Telegram connected — you&apos;ll be notified here
                      {profile.role === "sensei" ? " for bulk upload confirmations and when" : " when"} certificates
                      are published.
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
                    Connect Telegram for {profile.role === "sensei" ? "bulk upload & certificate" : "certificate"} alerts
                  </a>
                );
              })()}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-6">
              <p className="font-semibold text-amber-900">Waiting for approval.</p>
              <p className="mt-1 text-sm text-amber-800">
                Your {label} account activates once the organizer confirms payment.
              </p>
            </div>
          )}
          {recordingCtx ? (
            <PersonalRecordingSection ctx={recordingCtx} />
          ) : (
            <LinkRegistrationPrompt />
          )}
          <CertificatesSection
            userId={user.id}
            registrationIds={myRegistrationIds}
            senseiId={profile.sensei_id}
            schoolId={profile.school_id}
            isSupport={false}
          />
          <div className="mt-4">{SignOutButton}</div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // ── Participant ──────────────────────────────────────────────────────────
  if (!profile.registration_id) {
    const pending = await getPendingRegistrations(supabase, profile.email);
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-4 py-10">
          <SignInQuotaLine
            signInCount={profile.sign_in_count}
            signInLimit={profile.sign_in_limit}
            validFrom={profile.sign_in_valid_from}
            validUntil={profile.sign_in_valid_until}
            className="mb-2"
          />
          <h1 className="text-2xl font-bold">Link Your Registration</h1>
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

  const ctx = await getRecordingContext(supabase, user.id, profile, requestedRegistrationId);
  const {
    pendingOthers,
    recordAttempts,
    maxAttempts,
    hasPendingPurchase,
    existingVideo,
    categoryName,
    participantName,
    eventDate,
    registrationDeadline,
    watermark,
    ownVideoUrl,
    registrationId,
  } = ctx;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <SignInQuotaLine
          signInCount={profile.sign_in_count}
          signInLimit={profile.sign_in_limit}
          validFrom={profile.sign_in_valid_from}
          validUntil={profile.sign_in_valid_until}
          className="mb-2"
        />
        <h1 id="record-your-kata" className="scroll-mt-28 text-2xl font-bold">
          {existingVideo ? "Your Kata Recording" : "Record Your Kata"}
        </h1>
        <SignInInfoTables canManage={false} />
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          Signed in as {profile.full_name ?? user.email}.
        </p>
        {existingVideo ? (
          <div className="space-y-8">
            <div className="rounded-lg border border-green-300 bg-green-50 p-6">
              <p className="font-bold text-green-900">✅ Your kata recording is submitted</p>
              {ownVideoUrl ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <VideoWatchButton
                    url={ownVideoUrl}
                    label="Watch your recording"
                    className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700"
                  />
                  <DeleteRecordingControls
                    registrationId={registrationId}
                    attemptsUsed={recordAttempts}
                    maxAttempts={maxAttempts}
                    hasPendingPurchase={hasPendingPurchase}
                  />
                </div>
              ) : (
                <p className="mt-2 text-sm text-green-800">Thank you — it is ready for judging.</p>
              )}
            </div>
            {(() => {
              const connectUrl = getTelegramBotConnectUrl(user.id);
              if (profile.telegram_chat_id) {
                return (
                  <p className="text-sm font-semibold text-green-700">
                    ✅ Telegram connected — you&apos;ll be notified here once all judges have scored your recording.
                  </p>
                );
              }
              if (!connectUrl) return null;
              return (
                <a
                  href={connectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-[#229ED9]/30 bg-[#229ED9]/5 px-4 py-2.5 text-sm font-semibold text-[#1c7fb5] hover:bg-[#229ED9]/10"
                >
                  Connect Telegram for judging alerts
                </a>
              );
            })()}
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
              registrationId={registrationId}
              initialAttempts={recordAttempts}
              maxAttempts={maxAttempts}
              hasPendingPurchase={hasPendingPurchase}
              watermark={watermark}
              recordingStart={eventDate}
              recordingEnd={registrationDeadline}
              categoryName={categoryName}
              participantName={participantName}
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
        <CertificatesSection
          userId={user.id}
          registrationIds={myRegistrationIds}
          senseiId={profile.sensei_id}
          schoolId={profile.school_id}
          isSupport={false}
        />
        <div className="mt-6">{SignOutButton}</div>
      </main>
      <SiteFooter />
    </>
  );
}
