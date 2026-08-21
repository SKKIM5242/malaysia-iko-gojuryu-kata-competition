import { createClient } from "@/lib/supabase/server";
import { winnersRevealed, winnersRevealDateFor, testimonialEditDeadline } from "@/lib/winners";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import { getRecordingAppearance } from "@/lib/recording-appearance-server";
import { shortTierName } from "@/lib/invitation-codes";
import { splitCategoryName } from "@/lib/division";
import WinnerTestimonialInline, { type WinnerTestimonialInfo } from "@/components/WinnerTestimonialInline";

/** Which block a certificate falls into within its tier. Ordered exactly as
 * the organizer asked for them to read down the page: the win first, then
 * the participation certificate everyone paid-and-entered gets, then
 * everything earned in another capacity (judging, teaching, hosting,
 * supporting). */
type CertGroup = "winner" | "participation" | "other";
const GROUP_ORDER: CertGroup[] = ["winner", "participation", "other"];
const GROUP_HEADING: Record<CertGroup, string> = {
  winner: "🏆 Winner Certificates",
  participation: "🎖 Participation Certificates",
  other: "📜 Other Certificates",
};

interface CertLink {
  /** The certificate's own name only. The tier is NOT repeated here any
   * more -- it is the heading of the group this link sits in, and
   * repeating it made every row wrap to two lines. */
  label: string;
  href: string;
  /** Winner Certificate only, before a testimonial has been given — shown
   * as a locked notice (with the testimonial recorder right there) instead
   * of being silently omitted, so it's clear why the download isn't there
   * yet rather than looking like it's just missing. */
  locked?: boolean;
  /** React list key. A locked link has no href (nothing to link to yet),
   * and two different linked participants can share the same label/href
   * shape (same competition, both winners, neither has testified yet) once
   * a login can hold more than one — so this has to be its own field
   * rather than reusing label/href, which is what silently collapsed
   * distinct entries under one React key when this was still 1:1. */
  key: string;
  group: CertGroup;
  competitionId: string;
  competitionName: string;
  /** Who the certificate names. For a participant/winner certificate that
   * is the competitor on the registration (which is NOT necessarily the
   * account holder — a Sensei login can reach several students' rows); for
   * the role certificates it is the account holder. */
  personName: string | null;
  /** Kata event and the rest of the division (belt — age — sex), split out
   * of the category label. Null for certificates not tied to one entry:
   * a Judge/Sensei/School/Support certificate covers the whole tier. */
  kataName: string | null;
  categoryName: string | null;
  /** Winner links only — what the inline recorder submits against. */
  registrationId?: string;
  /** Winner links only — 30 days after this tier revealed. */
  editDeadlineISO?: string | null;
  /** Winner links only. Null before one has been given (the locked state);
   * present afterwards so the same block can offer Edit / Retake here
   * instead of sending the winner off to the Winners page for it. */
  testimonial?: WinnerTestimonialInfo | null;
}

type CompetitionRow = {
  id?: string;
  name: string;
  registration_deadline: string | null;
  winners_announce_date: string | null;
};

/** Kata + "belt — age — sex" out of a full category label, for the detail
 * line under each certificate. splitCategoryName already knows the exact
 * separators this project's category names use. */
function splitCategory(categoryName: string | null): { kataName: string | null; categoryName: string | null } {
  if (!categoryName) return { kataName: null, categoryName: null };
  const p = splitCategoryName(categoryName);
  const rest = [p.belt, p.age, p.sex].filter(Boolean).join(" — ");
  return { kataName: p.kata || categoryName, categoryName: rest || null };
}

async function participantLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  registrationId: string,
): Promise<CertLink[]> {
  const { data: reg } = await supabase
    .from("registrations")
    // Deliberately ONE string literal, not a `+` concatenation: supabase-js
    // infers the row type from the literal, and a concatenated select
    // degrades every column to GenericStringError.
    .select("payment_status, competition_id, participant:participants(full_name), category:categories(name), competition:competitions(name, registration_deadline, winners_announce_date)")
    .eq("id", registrationId)
    .maybeSingle();
  const competition = reg?.competition as unknown as CompetitionRow | null;
  if (!reg || reg.payment_status !== "paid" || !competition) return [];
  if (!winnersRevealed(competition.registration_deadline, competition.winners_announce_date)) return [];

  const competitionId = reg.competition_id as string;
  const personName = (reg.participant as unknown as { full_name: string | null } | null)?.full_name ?? null;
  const { kataName, categoryName } = splitCategory(
    (reg.category as unknown as { name: string | null } | null)?.name ?? null,
  );
  const common = { competitionId, competitionName: competition.name, personName, kataName, categoryName };

  const rankings = await computeCategoryRankings(supabase, competitionId);
  const isWinner = [...rankings.values()].flat().some((e) => e.registrationId === registrationId);
  const participationLink: CertLink = {
    ...common,
    group: "participation",
    label: "Certificate of Participation",
    href: `/api/certificates/participant/${registrationId}`,
    key: `participant-${registrationId}`,
  };
  if (!isWinner) return [participationLink];

  // Winners get both — the achievement certificate on top of, not instead
  // of, the same participation certificate every other paid entrant gets.
  // The Winner Certificate itself, though, is held back until a testimonial
  // has been given (see WinnerTestimonialInline.tsx on /winners and the
  // matching server-side check in app/api/certificates/[kind]/[id]/route.tsx).
  const { data: tRow } = await supabase
    .from("winner_testimonials")
    .select("id, kind, media_path, message, deleted_at")
    .eq("registration_id", registrationId)
    .maybeSingle();
  const testimonial: WinnerTestimonialInfo | null = tRow
    ? {
        id: tRow.id as string,
        kind: tRow.kind as WinnerTestimonialInfo["kind"],
        mediaUrl: tRow.media_path
          ? supabase.storage.from("testimonials").getPublicUrl(tRow.media_path as string).data.publicUrl
          : null,
        message: tRow.message as string | null,
        deleted: tRow.deleted_at != null,
      }
    : null;
  const revealDate = winnersRevealDateFor(competition.registration_deadline, competition.winners_announce_date);
  const editDeadlineISO = revealDate ? testimonialEditDeadline(revealDate).toISOString() : null;
  const winnerLink: CertLink = testimonial
    ? {
        ...common,
        group: "winner",
        label: "Winner Certificate",
        href: `/api/certificates/winner/${registrationId}`,
        key: `winner-${registrationId}`,
        registrationId,
        editDeadlineISO,
        testimonial,
      }
    : {
        ...common,
        group: "winner",
        label: "Winner Certificate",
        href: "",
        locked: true,
        key: `winner-locked-${registrationId}`,
        registrationId,
        editDeadlineISO,
        testimonial: null,
      };
  return [winnerLink, participationLink];
}

async function refereeLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  personName: string | null,
): Promise<CertLink[]> {
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
      group: "other" as const,
      label: "Judge Certificate",
      href: `/api/certificates/referee/${userId}?competition_id=${compId}`,
      key: `referee-${userId}-${compId}`,
      competitionId: compId,
      competitionName: c.name,
      personName,
      // A judge's certificate covers the whole tier, not one entry — there
      // is no single kata or division to name on it.
      kataName: null,
      categoryName: null,
    }));
}

async function roleRecordLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: "sensei" | "school",
  recordId: string,
  personName: string | null,
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
      group: "other" as const,
      label: `${kind === "sensei" ? "Sensei" : "School / Dojo"} Certificate`,
      href: `/api/certificates/${kind}/${recordId}?competition_id=${compId}`,
      key: `${kind}-${recordId}-${compId}`,
      competitionId: compId,
      competitionName: c.name,
      personName,
      kataName: null,
      categoryName: null,
    }));
}

/** Every revealed competition gets its own Support certificate — Support
 * isn't linked to any specific participant/registration the way
 * sensei/school are, so (unlike roleRecordLinks) this doesn't filter by
 * "did this person's students compete here," just by whether the tier
 * itself has revealed winners yet, same gate every other kind uses. */
async function supportLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  personName: string | null,
): Promise<CertLink[]> {
  const { data: competitions } = await supabase
    .from("competitions")
    .select("id, name, registration_deadline, winners_announce_date");
  return ((competitions ?? []) as unknown as Array<CompetitionRow & { id: string }>)
    .filter((c) => winnersRevealed(c.registration_deadline, c.winners_announce_date))
    .map((c) => ({
      group: "other" as const,
      label: "Certificate of Appreciation",
      href: `/api/certificates/support/${userId}?competition_id=${c.id}`,
      key: `support-${userId}-${c.id}`,
      competitionId: c.id,
      competitionName: c.name,
      personName,
      kataName: null,
      categoryName: null,
    }));
}

/** The Name / Kata / Category line under a certificate's title. Rendered
 * as label-value pairs rather than one run-on sentence so a certificate
 * for a student (Sensei logins reach several) is identifiable at a glance
 * without opening it. */
function CertDetail({ link }: { link: CertLink }) {
  const rows: Array<[string, string]> = [];
  if (link.personName) rows.push(["Name", link.personName]);
  if (link.kataName) rows.push(["Kata", link.kataName]);
  if (link.categoryName) rows.push(["Category", link.categoryName]);
  if (rows.length === 0) return null;
  return (
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs leading-tight text-neutral-600">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-neutral-400">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "Your Certificate" download box — appears on /account for every role
 * eligible for at least one certificate right now (winner, participant,
 * referee, sensei, school, support). Renders nothing for accounts with no
 * eligible certificate yet (e.g. no winners announced, or plain
 * Audience/Admin, which never get one). Certificates are rendered on
 * demand at the linked URL, never pre-generated — see
 * app/api/certificates/[kind]/[id]/route.tsx.
 *
 * Laid out COMPETITION TIER first, then Winner / Participation / Other
 * within it: a login can hold certificates from three tiers in several
 * capacities at once (competitor, sensei, judge), and a flat list of
 * near-identical "Certificate of Participation — Malaysia Open Virtual
 * Karate-do Kata Competition 2026 — USD 10 Tier" rows gave no way to tell
 * which was which. Each row now carries the name, kata and division it was
 * issued for.
 */
export default async function CertificatesSection({
  userId,
  registrationIds,
  senseiId,
  schoolId,
  isSupport,
  displayName = null,
}: {
  userId: string;
  /** Every registration this login can reach — the primary link plus
   * whatever else got bulk-linked into profile_participants (e.g. a Sensei
   * whose email is on several students' registrations), so this shows
   * every one of their certificates, not just the primary's. */
  registrationIds: string[];
  senseiId: string | null;
  schoolId: string | null;
  isSupport: boolean;
  /** The account holder's own name, for the role certificates (Judge,
   * Sensei, School, Support), which are issued to the login rather than to
   * a competitor row. */
  displayName?: string | null;
}) {
  const supabase = await createClient();
  const [linkGroups, { settings: recordingAppearance, logoUrl: recordingLogoUrl }] = await Promise.all([
    Promise.all([
      Promise.all(registrationIds.map((id) => participantLinks(supabase, id))).then((groups) => groups.flat()),
      refereeLinks(supabase, userId, displayName),
      senseiId ? roleRecordLinks(supabase, "sensei", senseiId, displayName) : Promise.resolve([]),
      schoolId ? roleRecordLinks(supabase, "school", schoolId, displayName) : Promise.resolve([]),
      isSupport ? supportLinks(supabase, userId, displayName) : Promise.resolve([]),
    ]),
    getRecordingAppearance(),
  ]);
  const links = linkGroups.flat();
  if (links.length === 0) return null;

  // Tier -> group -> links, both in a deliberate order (tier name, then
  // Winner/Participation/Other) rather than whatever order the queries
  // above happened to resolve in.
  const byTier = new Map<string, { name: string; links: CertLink[] }>();
  for (const l of links) {
    const bucket = byTier.get(l.competitionId) ?? { name: l.competitionName, links: [] };
    bucket.links.push(l);
    byTier.set(l.competitionId, bucket);
  }
  const tiers = [...byTier.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-lg font-bold">Your Certificate</h2>
      <div className="space-y-4">
        {tiers.map(([competitionId, tier]) => (
          <section key={competitionId} className="rounded-lg border border-neutral-200 bg-white shadow-sm">
            <h3 className="rounded-t-lg border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-sm font-bold text-neutral-800">
              {shortTierName(tier.name)}
              <span className="ml-2 font-normal text-xs text-neutral-400">{tier.name}</span>
            </h3>
            <div className="space-y-3 p-4">
              {GROUP_ORDER.filter((g) => tier.links.some((l) => l.group === g)).map((group) => (
                <div key={group}>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-neutral-500">
                    {GROUP_HEADING[group]}
                  </p>
                  <div className="space-y-2">
                    {tier.links
                      .filter((l) => l.group === group)
                      .map((l) =>
                        l.locked ? (
                          <div key={l.key} className="rounded-md border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-semibold text-amber-900">{l.label}</p>
                            <CertDetail link={l} />
                            <p className="mt-2 text-xs text-amber-800">
                              🔒 Give your testimonial to unlock this download — you can do it right here, or on the
                              Winners page.
                            </p>
                            {l.registrationId && (
                              <div className="mt-2">
                                {/* The same block the Winners page shows —
                                    4 buttons and the sample scripts beside
                                    the recorder — rather than only a link
                                    telling the winner to go and find it
                                    somewhere else. isOwner is safe here:
                                    every link in this section was built
                                    from a registration this login is
                                    already linked to, and submitTestimonial
                                    re-checks that server-side regardless. */}
                                <WinnerTestimonialInline
                                  registrationId={l.registrationId}
                                  isOwner
                                  isManager={false}
                                  canModerate={false}
                                  canAssist={false}
                                  testimonial={null}
                                  editDeadlineISO={l.editDeadlineISO ?? null}
                                  recordingAppearance={recordingAppearance}
                                  recordingLogoUrl={recordingLogoUrl}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <div key={l.key} className="rounded-md border border-neutral-200 p-3">
                            <p className="text-sm font-semibold text-neutral-700">{l.label}</p>
                            <CertDetail link={l} />
                            <div className="mt-2 flex flex-wrap gap-2">
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
                            </div>
                            {/* Already unlocked, so this renders the given
                                testimonial with Edit / Retake -- the same
                                component, same rules. No delete: that button
                                is behind canModerate, which is false here
                                and re-checked server-side anyway, so a
                                winner can replace their testimonial as often
                                as they like but can never leave themselves
                                with none. */}
                            {l.registrationId && l.testimonial && (
                              <div className="mt-3 border-t border-neutral-100 pt-3">
                                <WinnerTestimonialInline
                                  registrationId={l.registrationId}
                                  isOwner
                                  isManager={false}
                                  canModerate={false}
                                  canAssist={false}
                                  testimonial={l.testimonial}
                                  editDeadlineISO={l.editDeadlineISO ?? null}
                                  recordingAppearance={recordingAppearance}
                                  recordingLogoUrl={recordingLogoUrl}
                                />
                              </div>
                            )}
                          </div>
                        ),
                      )}
                  </div>
                </div>
              ))}
            </div>
          </section>
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
