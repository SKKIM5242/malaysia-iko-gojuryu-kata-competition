import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderCertificatePng, type CertificateInput, type CertificateKind, type CertificateTemplate } from "@/lib/certificate-render";
import { computeCategoryRankings } from "@/lib/winners-ranking";
import { winnersRevealed } from "@/lib/winners";
import { kataBaseOf } from "@/lib/division";
import { formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const VALID_KINDS: CertificateKind[] = ["winner", "participant", "referee", "sensei", "school", "support"];

/** Placeholder data for the admin Template Preview page (app/admin/certificates)
 * — lets Admin/Organizer/Staff see exactly how every certificate kind looks
 * without needing a real qualifying registration/assignment on file yet.
 * Requested via id="sample", gated to managers only (see GET below). */
const SAMPLE_DATA: Record<
  CertificateKind,
  Omit<CertificateInput, "signerName" | "signerTitle" | "signerName2" | "signerTitle2" | "signatureUrl" | "stampUrl" | "template">
> = {
  winner: {
    kind: "winner", recipientName: "Jane Doe",
    competitionName: "Malaysia Open Virtual Karate-do Kata Competition 2026 — USD 100 Tier",
    categoryName: "Color/Kyu Belt — Age 15–40 — Male", kataName: "Kata Saifa", rank: 1,
    dateLabel: "12/09/2026",
  },
  participant: {
    kind: "participant", recipientName: "John Tan",
    competitionName: "Malaysia Open Virtual Karate-do Kata Competition 2026 — USD 10 Tier",
    categoryName: "Color/Kyu Belt — Age 4–14 — Female", kataName: "Kata Gekisai Dai Ichi", rank: null,
    dateLabel: "12/09/2026",
  },
  referee: {
    kind: "referee", recipientName: "Ahmad Zulkifli",
    competitionName: "Malaysia Open Virtual Karate-do Kata Competition 2026 — USD 10 Tier",
    categoryName: null, kataName: null, rank: null, dateLabel: "12/09/2026",
  },
  sensei: {
    kind: "sensei", recipientName: "Sensei Lim Wei Chen",
    competitionName: "Malaysia Open Virtual Karate-do Kata Competition 2026 — USD 10 Tier",
    categoryName: null, kataName: null, rank: null, dateLabel: "12/09/2026",
  },
  school: {
    kind: "school", recipientName: "Goju-ryu Karate Academy KL",
    competitionName: "Malaysia Open Virtual Karate-do Kata Competition 2026 — USD 10 Tier",
    categoryName: null, kataName: null, rank: null, dateLabel: "12/09/2026",
  },
  support: {
    kind: "support", recipientName: "Nurul Huda",
    competitionName: "Malaysia Open Virtual Karate-do Kata Competition 2026 — USD 10 Tier",
    categoryName: null, kataName: null, rank: null, dateLabel: "12/09/2026",
  },
};

async function certificateSettings(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("certificate_settings").select("*").eq("id", true).maybeSingle();
  const signatureUrl = data?.signature_path
    ? supabase.storage.from("branding").getPublicUrl(data.signature_path as string).data.publicUrl
    : null;
  const stampUrl = data?.stamp_path
    ? supabase.storage.from("branding").getPublicUrl(data.stamp_path as string).data.publicUrl
    : null;
  return {
    signerName: (data?.signer_name as string | null) ?? null,
    signerTitle: (data?.signer_title as string | null) ?? null,
    signerName2: (data?.signer_name_2 as string | null) ?? null,
    signerTitle2: (data?.signer_title_2 as string | null) ?? null,
    signatureUrl,
    stampUrl,
  };
}

/** The organizer-edited design for one certificate kind (migration 0128) --
 * resolves logo1_path/logo2_path/medal_path to public URLs here, same
 * pattern as certificateSettings above, so lib/certificate-render.tsx never
 * needs a Supabase client of its own. Falls back to a plain "everything
 * off" template if the row is somehow missing (shouldn't happen -- all 6
 * kinds are seeded by the migration -- but a missing template row should
 * degrade to unbranded text, not a crash). */
async function certificateTemplate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: CertificateKind,
): Promise<CertificateTemplate> {
  const { data } = await supabase.from("certificate_templates").select("*").eq("kind", kind).maybeSingle();
  const urlFor = (path: string | null) =>
    path ? supabase.storage.from("branding").getPublicUrl(path).data.publicUrl : null;
  return {
    header1: (data?.header1 as string | null) ?? "",
    header2: (data?.header2 as string | null) ?? "",
    body1: (data?.body1 as string | null) ?? "",
    body2: (data?.body2 as string | null) ?? "",
    body3: (data?.body3 as string | null) ?? "",
    logoCount: (data?.logo_count as 1 | 2 | null) ?? 2,
    logo1Url: urlFor((data?.logo1_path as string | null) ?? null),
    logo2Url: urlFor((data?.logo2_path as string | null) ?? null),
    showMedal: (data?.show_medal as boolean | null) ?? false,
    medalPosition: (data?.medal_position as CertificateTemplate["medalPosition"] | null) ?? "between",
    medalUrl: urlFor((data?.medal_path as string | null) ?? null),
  };
}

/** `inline` (the "View" link) opens the PNG in the browser tab it's linked
 * from instead of forcing a download — everything else about the response
 * is identical, same live-rendered bytes as "Download". */
function pngResponse(
  image: Awaited<ReturnType<typeof renderCertificatePng>>,
  filename: string,
  inline: boolean,
) {
  const headers = new Headers(image.headers);
  headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename}"`);
  // next/og's ImageResponse defaults to a 1-year Cache-Control, which made the
  // admin Template Preview page (and social-style thumbnails) show stale
  // designs after every code change. Every certificate here is meant to be
  // "computed live" (see lib/certificate-render.tsx), so never cache it.
  headers.set("Cache-Control", "no-store");
  return new Response(image.body, { status: image.status, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id: registrationId } = await params;
  if (!VALID_KINDS.includes(kind as CertificateKind)) {
    return new Response("Unknown certificate type.", { status: 400 });
  }
  const inline = new URL(request.url).searchParams.get("view") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The Winner Certificate small-preview window on the public /winners page
  // (see CertificatePreviewButton) is viewable by anyone, signed in or not
  // — same "open to public" treatment already given to the testimonial text
  // itself. Every other kind, and downloading a winner certificate rather
  // than just viewing it, still needs a real session (checked further down).
  const isPublicWinnerView = kind === "winner" && inline && registrationId !== "sample";
  if (!user && !isPublicWinnerView) return new Response("Sign in first.", { status: 401 });

  const myProfile = user
    ? (
        await supabase
          .from("profiles")
          .select("role, registration_id, sensei_id, school_id")
          .eq("user_id", user.id)
          .maybeSingle()
      ).data
    : null;
  const isManager = ["admin", "organizer", "staff"].includes((myProfile?.role as string) ?? "");
  const settings = await certificateSettings(supabase);
  const template = await certificateTemplate(supabase, kind as CertificateKind);

  if (registrationId === "sample") {
    if (!isManager) return new Response("Not authorized.", { status: 403 });
    const sampleRankParam = Number(new URL(request.url).searchParams.get("rank"));
    const sampleRank = ([1, 2, 3] as const).includes(sampleRankParam as 1 | 2 | 3) ? (sampleRankParam as 1 | 2 | 3) : 1;
    const sample = SAMPLE_DATA[kind as CertificateKind];
    const image = await renderCertificatePng({
      ...sample,
      rank: kind === "winner" ? sampleRank : sample.rank,
      ...settings,
      template,
    });
    return pngResponse(image, `${kind}-certificate-sample.png`, inline);
  }

  if (kind === "winner" || kind === "participant") {
    const { data: regRaw } = await supabase
      .from("registrations")
      .select(
        "id, payment_status, competition_id, participant:participants(full_name), category:categories(name), " +
          "competition:competitions(name, event_date, certificate_date, registration_deadline, winners_announce_date)",
      )
      .eq("id", registrationId)
      .maybeSingle();
    const reg = regRaw as unknown as {
      id: string;
      payment_status: string;
      competition_id: string;
      participant: { full_name: string } | null;
      category: { name: string } | null;
      competition: {
        name: string;
        event_date: string | null;
        certificate_date: string | null;
        registration_deadline: string | null;
        winners_announce_date: string | null;
      } | null;
    } | null;

    const participant = reg?.participant ?? null;
    const competition = reg?.competition ?? null;
    if (!reg || !participant || !competition) {
      return new Response("Registration not found.", { status: 404 });
    }

    let isOwner = !!user && myProfile?.registration_id === registrationId;
    if (!isOwner && user) {
      const { data: link } = await supabase
        .from("profile_participants")
        .select("registration_id")
        .eq("user_id", user.id)
        .eq("registration_id", registrationId)
        .maybeSingle();
      isOwner = !!link;
    }
    if (!isOwner && !isManager && !isPublicWinnerView) {
      return new Response(user ? "Not authorized for this certificate." : "Sign in first.", { status: user ? 403 : 401 });
    }
    if (reg.payment_status !== "paid") return new Response("This registration is not paid.", { status: 403 });

    if (
      !isManager &&
      !winnersRevealed(competition.registration_deadline, competition.winners_announce_date)
    ) {
      return new Response("Certificates unlock once winners are announced for this tier.", { status: 403 });
    }

    const category = reg.category as unknown as { name: string } | null;
    const categoryLabel = category?.name ? category.name.split(" — ").slice(1).join(" — ") || category.name : null;
    const kataName = category?.name ? kataBaseOf(category.name) : null;

    let rank: 1 | 2 | 3 | null = null;
    if (kind === "winner") {
      // The service-role client, not the session client: kata_videos and
      // video_scores have no RLS policy for the anon role at all (only
      // authenticated, and only once a competition's registration_deadline
      // has passed) -- so a genuinely signed-out isPublicWinnerView request
      // couldn't compute rankings otherwise. Safe here specifically because
      // isOwner/isManager/isPublicWinnerView was already decided above --
      // this only ever resolves a rank (1-3) for the one registration this
      // request was already authorized to see.
      const rankings = await computeCategoryRankings(createAdminClient(), reg.competition_id as string);
      outer: for (const entries of rankings.values()) {
        for (const e of entries) {
          if (e.registrationId === registrationId) {
            rank = e.rank as 1 | 2 | 3;
            break outer;
          }
        }
      }
      if (!rank) return new Response("This registration did not place in the Top 3.", { status: 404 });

      if (!isManager) {
        const { count: testimonialCount } = await supabase
          .from("winner_testimonials")
          .select("id", { count: "exact", head: true })
          .eq("registration_id", registrationId);
        if ((testimonialCount ?? 0) === 0) {
          return new Response("Submit your testimonial on My Account before downloading your Winner Certificate.", {
            status: 403,
          });
        }
      }
    }

    const image = await renderCertificatePng({
      kind,
      recipientName: participant.full_name,
      competitionName: competition.name,
      categoryName: categoryLabel,
      kataName,
      rank,
      dateLabel: formatDate(competition.certificate_date ?? competition.winners_announce_date ?? competition.event_date),
      ...settings,
      template,
    });
    return pngResponse(image, `${kind}-certificate.png`, inline);
  }

  if (kind === "referee") {
    const refereeUserId = registrationId;
    const competitionId = new URL(request.url).searchParams.get("competition_id");
    if (!competitionId) return new Response("Missing competition_id.", { status: 400 });

    const isOwner = user!.id === refereeUserId;
    if (!isOwner && !isManager) return new Response("Not authorized for this certificate.", { status: 403 });

    const { data: comp } = await supabase
      .from("competitions")
      .select("name, event_date, certificate_date, registration_deadline, winners_announce_date")
      .eq("id", competitionId)
      .maybeSingle();
    if (!comp) return new Response("Competition not found.", { status: 404 });
    if (!isManager && !winnersRevealed(comp.registration_deadline as string | null, comp.winners_announce_date as string | null)) {
      return new Response("Certificates unlock once winners are announced for this tier.", { status: 403 });
    }

    const { data: refRow } = await supabase.from("referees").select("full_name").eq("user_id", refereeUserId).maybeSingle();
    const { data: profRow } = await supabase.from("profiles").select("full_name").eq("user_id", refereeUserId).maybeSingle();
    const recipientName = (refRow?.full_name as string | null) ?? (profRow?.full_name as string | null) ?? "Judge";

    const { data: assignments } = await supabase.from("referee_assignments").select("video_id").eq("referee_user_id", refereeUserId);
    const videoIds = (assignments ?? []).map((a) => a.video_id as string);
    let judgedThisComp = false;
    if (videoIds.length > 0) {
      const { data: videos } = await supabase
        .from("kata_videos")
        .select("registration:registrations(competition_id)")
        .in("id", videoIds);
      judgedThisComp = (videos ?? []).some(
        (v) => (v.registration as unknown as { competition_id: string } | null)?.competition_id === competitionId,
      );
    }
    if (!judgedThisComp) return new Response("No judging record found for this competition.", { status: 404 });

    const image = await renderCertificatePng({
      kind: "referee",
      recipientName,
      competitionName: comp.name as string,
      categoryName: null,
      kataName: null,
      rank: null,
      dateLabel: formatDate((comp.certificate_date ?? comp.winners_announce_date ?? comp.event_date) as string | null),
      ...settings,
      template,
    });
    return pngResponse(image, "referee-certificate.png", inline);
  }

  if (kind === "sensei" || kind === "school") {
    const recordId = registrationId;
    const competitionId = new URL(request.url).searchParams.get("competition_id");
    if (!competitionId) return new Response("Missing competition_id.", { status: 400 });

    const table = kind === "sensei" ? "senseis" : "schools";
    const linkField = kind === "sensei" ? "sensei_id" : "school_id";
    const myLinkedId = kind === "sensei" ? myProfile?.sensei_id : myProfile?.school_id;
    const isOwner = myLinkedId === recordId;
    if (!isOwner && !isManager) return new Response("Not authorized for this certificate.", { status: 403 });

    const { data: comp } = await supabase
      .from("competitions")
      .select("name, event_date, certificate_date, registration_deadline, winners_announce_date")
      .eq("id", competitionId)
      .maybeSingle();
    if (!comp) return new Response("Competition not found.", { status: 404 });
    if (!isManager && !winnersRevealed(comp.registration_deadline as string | null, comp.winners_announce_date as string | null)) {
      return new Response("Certificates unlock once winners are announced for this tier.", { status: 403 });
    }

    const { data: recordRow } = await supabase.from(table).select("name").eq("id", recordId).maybeSingle();
    if (!recordRow) return new Response(`${kind === "sensei" ? "Sensei" : "School"} not found.`, { status: 404 });

    const { data: myParticipants } = await supabase.from("participants").select("id").eq(linkField, recordId);
    const participantIds = (myParticipants ?? []).map((p) => p.id as string);
    let hasStudent = false;
    if (participantIds.length > 0) {
      const { count } = await supabase
        .from("registrations")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", competitionId)
        .eq("payment_status", "paid")
        .in("participant_id", participantIds);
      hasStudent = (count ?? 0) > 0;
    }
    if (!hasStudent) return new Response("No students found for this competition.", { status: 404 });

    const image = await renderCertificatePng({
      kind,
      recipientName: recordRow.name as string,
      competitionName: comp.name as string,
      categoryName: null,
      kataName: null,
      rank: null,
      dateLabel: formatDate((comp.certificate_date ?? comp.winners_announce_date ?? comp.event_date) as string | null),
      ...settings,
      template,
    });
    return pngResponse(image, `${kind}-certificate.png`, inline);
  }

  if (kind === "support") {
    const targetUserId = registrationId;
    const competitionId = new URL(request.url).searchParams.get("competition_id");
    if (!competitionId) return new Response("Missing competition_id.", { status: 400 });

    const isOwner = user!.id === targetUserId;
    if (!isOwner && !isManager) return new Response("Not authorized for this certificate.", { status: 403 });

    const { data: profRow } = await supabase
      .from("profiles")
      .select("full_name, role, roles, approved")
      .eq("user_id", targetUserId)
      .maybeSingle();
    const roles = (profRow?.roles as string[] | undefined)?.length ? (profRow!.roles as string[]) : [profRow?.role as string];
    if (!profRow || !roles.includes("customer_support") || !profRow.approved) {
      return new Response("Not eligible for a Support certificate.", { status: 404 });
    }

    const { data: comp } = await supabase
      .from("competitions")
      .select("name, event_date, certificate_date, registration_deadline, winners_announce_date")
      .eq("id", competitionId)
      .maybeSingle();
    if (!comp) return new Response("Competition not found.", { status: 404 });
    if (!isManager && !winnersRevealed(comp.registration_deadline as string | null, comp.winners_announce_date as string | null)) {
      return new Response("Certificates unlock once winners are announced for this tier.", { status: 403 });
    }

    const image = await renderCertificatePng({
      kind: "support",
      recipientName: profRow.full_name ?? "Support Team Member",
      competitionName: comp.name as string,
      categoryName: null,
      kataName: null,
      rank: null,
      dateLabel: formatDate((comp.certificate_date ?? comp.winners_announce_date ?? comp.event_date) as string | null),
      ...settings,
      template,
    });
    return pngResponse(image, "support-certificate.png", inline);
  }

  return new Response("This certificate type isn't available yet.", { status: 501 });
}
