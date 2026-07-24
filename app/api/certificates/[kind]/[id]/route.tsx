import { createClient } from "@/lib/supabase/server";
import { renderCertificatePng, type CertificateInput, type CertificateKind } from "@/lib/certificate-render";
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
  Omit<CertificateInput, "signerName" | "signerTitle" | "signerName2" | "signerTitle2" | "signatureUrl" | "stampUrl">
> = {
  winner: {
    kind: "winner", recipientName: "Jane Doe",
    competitionName: "Malaysia Open Virtual Karate-do Kata Championship 2026 — USD 100 Tier",
    categoryName: "Color/Kyu Belt — Age 15–40 — Male", kataName: "Kata Saifa", rank: 1,
    dateLabel: "12/09/2026",
  },
  participant: {
    kind: "participant", recipientName: "John Tan",
    competitionName: "Malaysia Open Virtual Karate-do Kata Championship 2026 — USD 10 Tier",
    categoryName: "Color/Kyu Belt — Age 4–14 — Female", kataName: "Kata Gekisai Dai Ichi", rank: null,
    dateLabel: "12/09/2026",
  },
  referee: {
    kind: "referee", recipientName: "Ahmad Zulkifli",
    competitionName: "Malaysia Open Virtual Karate-do Kata Championship 2026",
    categoryName: null, kataName: null, rank: null, dateLabel: "12/09/2026",
  },
  sensei: {
    kind: "sensei", recipientName: "Sensei Lim Wei Chen",
    competitionName: "Malaysia Open Virtual Karate-do Kata Championship 2026",
    categoryName: null, kataName: null, rank: null, dateLabel: "12/09/2026",
  },
  school: {
    kind: "school", recipientName: "Goju-ryu Karate Academy KL",
    competitionName: "Malaysia Open Virtual Karate-do Kata Championship 2026",
    categoryName: null, kataName: null, rank: null, dateLabel: "12/09/2026",
  },
  support: {
    kind: "support", recipientName: "Nurul Huda",
    competitionName: "Malaysia Open Virtual Karate-do Kata Championship 2026",
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

function pngResponse(image: Awaited<ReturnType<typeof renderCertificatePng>>, filename: string) {
  const headers = new Headers(image.headers);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role, registration_id, sensei_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const isManager = ["admin", "organizer", "staff"].includes((myProfile?.role as string) ?? "");
  const settings = await certificateSettings(supabase);

  if (registrationId === "sample") {
    if (!isManager) return new Response("Not authorized.", { status: 403 });
    const sampleRankParam = Number(new URL(request.url).searchParams.get("rank"));
    const sampleRank = ([1, 2, 3] as const).includes(sampleRankParam as 1 | 2 | 3) ? (sampleRankParam as 1 | 2 | 3) : 1;
    const sample = SAMPLE_DATA[kind as CertificateKind];
    const image = await renderCertificatePng({
      ...sample,
      rank: kind === "winner" ? sampleRank : sample.rank,
      ...settings,
    });
    return pngResponse(image, `${kind}-certificate-sample.png`);
  }

  if (kind === "winner" || kind === "participant") {
    const { data: regRaw } = await supabase
      .from("registrations")
      .select(
        "id, payment_status, competition_id, participant:participants(full_name), category:categories(name), " +
          "competition:competitions(name, event_date, registration_deadline, winners_announce_date)",
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
        registration_deadline: string | null;
        winners_announce_date: string | null;
      } | null;
    } | null;

    const participant = reg?.participant ?? null;
    const competition = reg?.competition ?? null;
    if (!reg || !participant || !competition) {
      return new Response("Registration not found.", { status: 404 });
    }

    const isOwner = myProfile?.registration_id === registrationId;
    if (!isOwner && !isManager) return new Response("Not authorized for this certificate.", { status: 403 });
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
      const rankings = await computeCategoryRankings(supabase, reg.competition_id as string);
      outer: for (const entries of rankings.values()) {
        for (const e of entries) {
          if (e.registrationId === registrationId) {
            rank = e.rank as 1 | 2 | 3;
            break outer;
          }
        }
      }
      if (!rank) return new Response("This registration did not place in the Top 3.", { status: 404 });
    }

    const image = await renderCertificatePng({
      kind,
      recipientName: participant.full_name,
      competitionName: competition.name,
      categoryName: categoryLabel,
      kataName,
      rank,
      dateLabel: formatDate(competition.event_date),
      ...settings,
    });
    return pngResponse(image, `${kind}-certificate.png`);
  }

  if (kind === "referee") {
    const refereeUserId = registrationId;
    const competitionId = new URL(request.url).searchParams.get("competition_id");
    if (!competitionId) return new Response("Missing competition_id.", { status: 400 });

    const isOwner = user!.id === refereeUserId;
    if (!isOwner && !isManager) return new Response("Not authorized for this certificate.", { status: 403 });

    const { data: comp } = await supabase
      .from("competitions")
      .select("name, event_date, registration_deadline, winners_announce_date")
      .eq("id", competitionId)
      .maybeSingle();
    if (!comp) return new Response("Competition not found.", { status: 404 });
    if (!isManager && !winnersRevealed(comp.registration_deadline as string | null, comp.winners_announce_date as string | null)) {
      return new Response("Certificates unlock once winners are announced for this tier.", { status: 403 });
    }

    const { data: refRow } = await supabase.from("referees").select("full_name").eq("user_id", refereeUserId).maybeSingle();
    const { data: profRow } = await supabase.from("profiles").select("full_name").eq("user_id", refereeUserId).maybeSingle();
    const recipientName = (refRow?.full_name as string | null) ?? (profRow?.full_name as string | null) ?? "Referee / Judge";

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
      dateLabel: formatDate(comp.event_date as string | null),
      ...settings,
    });
    return pngResponse(image, "referee-certificate.png");
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
      .select("name, event_date, registration_deadline, winners_announce_date")
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
      dateLabel: formatDate(comp.event_date as string | null),
      ...settings,
    });
    return pngResponse(image, `${kind}-certificate.png`);
  }

  if (kind === "support") {
    const targetUserId = registrationId;
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

    const image = await renderCertificatePng({
      kind: "support",
      recipientName: profRow.full_name ?? "Support Team Member",
      competitionName: "Malaysia Open Virtual Karate-do Kata Championship",
      categoryName: null,
      kataName: null,
      rank: null,
      dateLabel: formatDate(new Date().toISOString().slice(0, 10)),
      ...settings,
    });
    return pngResponse(image, "support-certificate.png");
  }

  return new Response("This certificate type isn't available yet.", { status: 501 });
}
