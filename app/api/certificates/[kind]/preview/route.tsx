/**
 * Renders a certificate PNG from the certificate-editor form's *current,
 * unsaved* field values -- backs the blue "Preview" button in
 * components/CertificateTemplateForm.tsx, so an Admin/Organizer can see the
 * effect of a style change before committing it with "Save template".
 * Content (recipient name, kata, etc.) always comes from the same
 * SAMPLE_DATA the admin Template Preview grid uses -- this route never
 * touches a real registration. Images (logo1/logo2/medal) are the ones
 * already saved for this kind; a file picked in the form but not yet
 * uploaded can't be reflected without a temp-upload round trip, which isn't
 * worth the complexity for a "check my text/layout edits" tool. Nothing is
 * written to the database.
 */
import { createClient } from "@/lib/supabase/server";
import { renderCertificatePng, sanitizeTextStyle, type CertificateKind, type CertificateTemplate } from "@/lib/certificate-render";
import { SAMPLE_DATA, certificateSettings, certificateTemplate } from "@/lib/certificate-data";

export const dynamic = "force-dynamic";

const VALID_KINDS: CertificateKind[] = ["winner", "participant", "referee", "sensei", "school", "support"];

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function align3(v: unknown, fallback: "left" | "center" | "right"): "left" | "center" | "right" {
  return v === "left" || v === "center" || v === "right" ? v : fallback;
}

function lineStyle3(v: unknown, fallback: "solid" | "dashed"): "solid" | "dashed" {
  return v === "solid" || v === "dashed" ? v : fallback;
}

export async function POST(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!VALID_KINDS.includes(kind as CertificateKind)) {
    return new Response("Unknown certificate type.", { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { data: myProfile } = await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
  if (!["admin", "organizer"].includes((myProfile?.role as string) ?? "")) {
    return new Response("Only Admin / Organizer can preview certificate templates.", { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return new Response("Invalid request body.", { status: 400 });
  const b = body as Record<string, unknown>;

  // Reuses whatever's already saved for this kind's images/defaults -- see
  // the file header note on why unsaved image picks can't be previewed.
  const saved = await certificateTemplate(supabase, kind as CertificateKind);

  const template: CertificateTemplate = {
    header1: String(b.header1 ?? ""),
    header2: String(b.header2 ?? ""),
    body1: String(b.body1 ?? ""),
    body2: String(b.body2 ?? ""),
    body3: String(b.body3 ?? ""),
    logoCount: Number(b.logo_count) === 1 ? 1 : 2,
    logo1Url: saved.logo1Url,
    logo2Url: saved.logo2Url,
    logo1Size: num(b.logo1_size, saved.logo1Size),
    logo2Size: num(b.logo2_size, saved.logo2Size),
    logosAlignment: align3(b.logos_alignment, saved.logosAlignment),
    logosNoSpacing: b.logos_no_spacing === true,
    showMedal: b.show_medal === true,
    medalPosition: b.medal_position === "left" || b.medal_position === "right" ? b.medal_position : "between",
    medalUrl: saved.medalUrl,
    medalSize: num(b.medal_size, saved.medalSize),
    dateColor: typeof b.date_color === "string" ? b.date_color : saved.dateColor,
    dateSize: num(b.date_size, saved.dateSize),
    dateAlignment: align3(b.date_alignment, saved.dateAlignment),
    dateDescription: typeof b.date_description === "string" ? b.date_description : saved.dateDescription,
    dateDescriptionAlignment: align3(b.date_description_alignment, saved.dateDescriptionAlignment),
    dateLineStyle: lineStyle3(b.date_line_style, saved.dateLineStyle),
    dateLineWidth: num(b.date_line_width, saved.dateLineWidth),
    signerNameSize: num(b.signer_name_size, saved.signerNameSize),
    signerTitleSize: num(b.signer_title_size, saved.signerTitleSize),
    signerNameBold: b.signer_name_bold === true,
    signerTitleBold: b.signer_title_bold === true,
    signerPosition: align3(b.signer_position, saved.signerPosition),
    signerLineStyle: lineStyle3(b.signer_line_style, saved.signerLineStyle),
    signerLineWidth: num(b.signer_line_width, saved.signerLineWidth),
    frameOuterWidth: num(b.frame_outer_width, saved.frameOuterWidth),
    frameInnerWidth: num(b.frame_inner_width, saved.frameInnerWidth),
    frameColor: b.frame_color_override === true ? (typeof b.frame_color === "string" ? b.frame_color : null) : null,
    header1Style: sanitizeTextStyle(b.header1_style),
    header2Style: sanitizeTextStyle(b.header2_style),
    body1Style: sanitizeTextStyle(b.body1_style),
    body2Style: sanitizeTextStyle(b.body2_style),
    body3Style: sanitizeTextStyle(b.body3_style),
  };

  // Winner's row covers all 3 medal ranks -- the caller picks which one to
  // render a sample of (see the 3 "Preview 1st/2nd/3rd" buttons for Winner
  // in CertificateTemplateForm); every other kind ignores this.
  const rankParam = Number(b.rank);
  const rank = ([1, 2, 3] as const).includes(rankParam as 1 | 2 | 3) ? (rankParam as 1 | 2 | 3) : 1;

  const settings = await certificateSettings(supabase);
  const sample = SAMPLE_DATA[kind as CertificateKind];
  const image = await renderCertificatePng({
    ...sample,
    rank: kind === "winner" ? rank : sample.rank,
    ...settings,
    template,
  });
  const headers = new Headers(image.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Disposition", `inline; filename="${kind}-certificate-preview.png"`);
  return new Response(image.body, { status: image.status, headers });
}
