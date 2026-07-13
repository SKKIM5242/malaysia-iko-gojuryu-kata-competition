import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import { schemaReady } from "@/lib/data";
import { SetupNotice, SiteFooter, SiteHeader, TelegramFullAccessLinks } from "@/components/ui";
import AuthForms from "@/components/AuthForms";
import ClaimForm from "@/components/ClaimForm";
import KataRecorder from "@/components/KataRecorder";
import RefereeScoring, { type ScoringItem } from "@/components/RefereeScoring";
import { getAllTelegramLinks } from "@/lib/telegram";

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
    .select("id")
    .eq("registration_id", profile.registration_id)
    .maybeSingle();

  const { data: registration } = await supabase
    .from("registrations")
    .select("competition:competitions(event_date)")
    .eq("id", profile.registration_id)
    .maybeSingle();
  const eventDate =
    (registration as unknown as { competition: { event_date: string | null } | null } | null)?.competition
      ?.event_date ?? null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold">Record your kata</h1>
        <p className="mt-1 mb-6 text-sm text-neutral-500">
          Signed in as {profile.full_name ?? user.email}.
        </p>
        {existingVideo ? (
          <div className="rounded-lg border border-green-300 bg-green-50 p-8 text-center">
            <p className="text-3xl">✅</p>
            <h2 className="mt-2 text-xl font-bold text-green-900">Your kata recording is submitted</h2>
            <p className="mt-2 text-sm text-green-800">Thank you — it is ready for judging.</p>
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
