import { createClient } from "@/lib/supabase/server";
import { winnersRevealed } from "@/lib/winners";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import ProtectedCertificateViewer from "@/components/ProtectedCertificateViewer";

interface CertLink {
  label: string;
  href: string;
  /** Participation certificates are view-only — no download link, opened
   * in a hardened in-app viewer instead of a new tab (see
   * ProtectedCertificateViewer.tsx). Every other kind keeps View + Download. */
  viewOnly?: boolean;
}

type CompetitionRow = { name: string; registration_deadline: string | null; winners_announce_date: string | null };

async function participantLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  registrationId: string,
): Promise<CertLink[]> {
  const { data: reg } = await supabase
    .from("registrations")
    .select("payment_status, competition_id, competition:competitions(name, registration_deadline, winners_announce_date)")
    .eq("id", registrationId)
    .maybeSingle();
  const competition = reg?.competition as unknown as CompetitionRow | null;
  if (!reg || reg.payment_status !== "paid" || !competition) return [];
  if (!winnersRevealed(competition.registration_deadline, competition.winners_announce_date)) return [];

  const rankings = await computeCategoryRankings(supabase, reg.competition_id as string);
  const isWinner = [...rankings.values()].flat().some((e) => e.registrationId === registrationId);
  const participationLink: CertLink = {
    label: `Certificate of Participation — ${competition.name}`,
    href: `/api/certificates/participant/${registrationId}`,
    viewOnly: true,
  };
  if (!isWinner) return [participationLink];

  // Winners get both — the achievement certificate on top of, not instead
  // of, the same participation certificate every other paid entrant gets.
  // The Winner Certificate itself, though, is held back until a testimonial
  // has been given (see WinnerTestimonialInline.tsx on /winners and the
  // matching server-side check in app/api/certificates/[kind]/[id]/route.tsx).
  const { count: testimonialCount } = await supabase
    .from("winner_testimonials")
    .select("id", { count: "exact", head: true })
    .eq("registration_id", registrationId);
  const winnerLink =
    (testimonialCount ?? 0) > 0
      ? { label: `Winner Certificate — ${competition.name}`, href: `/api/certificates/winner/${registrationId}` }
      : null;
  return winnerLink ? [winnerLink, participationLink] : [participationLink];
}

async function refereeLinks(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<CertLink[]> {
  const { data: assignments } = await supabase.from("referee_assignments").select("video_id").eq("referee_user_id", userId);
  const videoIds = (assignments ?? []).map((a) => a.video_id as string);
  if (videoIds.length === 0) return [];

  const { data: videos } = await supabase
    .from("kata_videos")
    .select("registration:registrations(competition_id, competition:competitions(name, registration_deadline, winners_announce_date))")
    .in("id", videoIds);

  const seen = new Map<string, CompetitionRow>();
  for (const v of videos ?? []) {
    const registration = v.registration as unknown as { competition_id: string | null; competition: CompetitionRow | null } | null;
    if (!registration?.competition_id || !registration.competition || seen.has(registration.competition_id)) continue;
    seen.set(registration.competition_id, registration.competition);
  }

  return [...seen.entries()]
    .filter(([, c]) => winnersRevealed(c.registration_deadline, c.winners_announce_date))
    .map(([compId, c]) => ({
      label: `Referee / Judge Certificate — ${c.name}`,
      href: `/api/certificates/referee/${userId}?competition_id=${compId}`,
    }));
}

async function roleRecordLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: "sensei" | "school",
  recordId: string,
): Promise<CertLink[]> {
  const linkField = kind === "sensei" ? "sensei_id" : "school_id";
  const { data: participants } = await supabase.from("participants").select("id").eq(linkField, recordId);
  const participantIds = (participants ?? []).map((p) => p.id as string);
  if (participantIds.length === 0) return [];

  const { data: regs } = await supabase
    .from("registrations")
    .select("competition_id, competition:competitions(name, registration_deadline, winners_announce_date)")
    .in("participant_id", participantIds)
    .eq("payment_status", "paid");

  const seen = new Map<string, CompetitionRow>();
  for (const r of regs ?? []) {
    const competitionId = r.competition_id as string | null;
    const competition = r.competition as unknown as CompetitionRow | null;
    if (!competitionId || !competition || seen.has(competitionId)) continue;
    seen.set(competitionId, competition);
  }

  return [...seen.entries()]
    .filter(([, c]) => winnersRevealed(c.registration_deadline, c.winners_announce_date))
    .map(([compId, c]) => ({
      label: `${kind === "sensei" ? "Sensei" : "School / Dojo"} Certificate — ${c.name}`,
      href: `/api/certificates/${kind}/${recordId}?competition_id=${compId}`,
    }));
}

/** Every revealed competition gets its own Support certificate — Support
 * isn't linked to any specific participant/registration the way
 * sensei/school are, so (unlike roleRecordLinks) this doesn't filter by
 * "did this person's students compete here," just by whether the tier
 * itself has revealed winners yet, same gate every other kind uses. */
async function supportLinks(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<CertLink[]> {
  const { data: competitions } = await supabase
    .from("competitions")
    .select("id, name, registration_deadline, winners_announce_date");
  return ((competitions ?? []) as unknown as Array<CompetitionRow & { id: string }>)
    .filter((c) => winnersRevealed(c.registration_deadline, c.winners_announce_date))
    .map((c) => ({
      label: `Certificate of Appreciation — ${c.name}`,
      href: `/api/certificates/support/${userId}?competition_id=${c.id}`,
    }));
}

/**
 * "Your Certificate" download box — appears on /account for every role
 * eligible for at least one certificate right now (winner, participant,
 * referee, sensei, school, support). Renders nothing for accounts with no
 * eligible certificate yet (e.g. no winners announced, or plain
 * Audience/Admin, which never get one). Certificates are rendered on
 * demand at the linked URL, never pre-generated — see
 * app/api/certificates/[kind]/[id]/route.tsx.
 */
export default async function CertificatesSection({
  userId,
  registrationId,
  senseiId,
  schoolId,
  isSupport,
}: {
  userId: string;
  registrationId: string | null;
  senseiId: string | null;
  schoolId: string | null;
  isSupport: boolean;
}) {
  const supabase = await createClient();
  const linkGroups = await Promise.all([
    registrationId ? participantLinks(supabase, registrationId) : Promise.resolve([]),
    refereeLinks(supabase, userId),
    senseiId ? roleRecordLinks(supabase, "sensei", senseiId) : Promise.resolve([]),
    schoolId ? roleRecordLinks(supabase, "school", schoolId) : Promise.resolve([]),
    isSupport ? supportLinks(supabase, userId) : Promise.resolve([]),
  ]);
  const links = linkGroups.flat();
  if (links.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-lg font-bold">Your Certificate</h2>
      <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        {links.map((l) => (
          <div key={l.href} className="rounded-md border border-neutral-200 p-3">
            <p className="mb-2 text-sm font-semibold text-neutral-700">{l.label}</p>
            <div className="flex flex-wrap gap-2">
              {l.viewOnly ? (
                <ProtectedCertificateViewer viewHref={viewHref(l.href)} label={l.label} />
              ) : (
                <>
                  <a
                    href={viewHref(l.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
                  >
                    👁 View
                  </a>
                  <a
                    href={l.href}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700"
                  >
                    ⬇ Download
                  </a>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Appends `view=1` — see the `inline` flag in
 * app/api/certificates/[kind]/[id]/route.tsx — correctly whether the href
 * already has a query string (referee/sensei/school links carry
 * `?competition_id=...`) or not (winner/participant/support links don't). */
function viewHref(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}view=1`;
}
