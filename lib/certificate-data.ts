/**
 * Supabase-backed data for certificate rendering -- resolving the org-wide
 * signer/signature/stamp settings and the per-kind editable template (both
 * storage-path -> public-URL) into the plain-data shapes
 * lib/certificate-render.tsx expects, plus the placeholder sample data used
 * by the admin Template Preview grid and the template-editor Preview
 * button. Split out from app/api/certificates/[kind]/[id]/route.tsx so the
 * new .../[kind]/preview route can reuse the exact same resolution logic
 * without duplicating it.
 */
import type { createClient } from "@/lib/supabase/server";
import {
  sanitizeTextStyle,
  type CertificateInput,
  type CertificateKind,
  type CertificateTemplate,
  type LineSpacingMode,
} from "@/lib/certificate-render";

const LINE_SPACING_MODES: readonly LineSpacingMode[] = ["single", "1.5", "double", "atLeast", "exactly", "multiple"];

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Placeholder data for the admin Template Preview page (app/admin/certificates)
 * and the template editor's Preview button — lets Admin/Organizer/Staff see
 * exactly how every certificate kind looks without needing a real
 * qualifying registration/assignment on file yet. */
export const SAMPLE_DATA: Record<
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

export async function certificateSettings(supabase: SupabaseServerClient) {
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

/** The organizer-edited design for one certificate kind (migrations 0128 +
 * 0129) -- resolves logo1_path/logo2_path/medal_path to public URLs here,
 * same pattern as certificateSettings above, so lib/certificate-render.tsx
 * never needs a Supabase client of its own. Falls back to a plain
 * "everything off, built-in defaults" template if the row is somehow
 * missing (shouldn't happen -- all 6 kinds are seeded by migration 0128 --
 * but a missing template row should degrade to unbranded text, not a
 * crash). */
export async function certificateTemplate(
  supabase: SupabaseServerClient,
  kind: CertificateKind,
): Promise<CertificateTemplate> {
  const { data } = await supabase.from("certificate_templates").select("*").eq("kind", kind).maybeSingle();
  const urlFor = (path: string | null) =>
    path ? supabase.storage.from("branding").getPublicUrl(path).data.publicUrl : null;
  const align3 = (v: unknown, fallback: "left" | "center" | "right"): "left" | "center" | "right" =>
    v === "left" || v === "center" || v === "right" ? v : fallback;
  const lineStyle3 = (v: unknown, fallback: "solid" | "dashed"): "solid" | "dashed" =>
    v === "solid" || v === "dashed" ? v : fallback;
  const lineSpacingMode6 = (v: unknown): LineSpacingMode =>
    (LINE_SPACING_MODES as readonly unknown[]).includes(v) ? (v as LineSpacingMode) : "single";
  return {
    header1: (data?.header1 as string | null) ?? "",
    header2: (data?.header2 as string | null) ?? "",
    body1: (data?.body1 as string | null) ?? "",
    body2: (data?.body2 as string | null) ?? "",
    body3: (data?.body3 as string | null) ?? "",
    logoCount: (data?.logo_count as 1 | 2 | null) ?? 2,
    logo1Url: urlFor((data?.logo1_path as string | null) ?? null),
    logo2Url: urlFor((data?.logo2_path as string | null) ?? null),
    logo1Size: (data?.logo1_size as number | null) ?? 420,
    logo2Size: (data?.logo2_size as number | null) ?? 420,
    logosAlignment: align3(data?.logos_alignment, "center"),
    logosNoSpacing: (data?.logos_no_spacing as boolean | null) ?? false,
    showMedal: (data?.show_medal as boolean | null) ?? false,
    medalPosition: (data?.medal_position as CertificateTemplate["medalPosition"] | null) ?? "between",
    medalUrl: urlFor((data?.medal_path as string | null) ?? null),
    medalSize: (data?.medal_size as number | null) ?? 368,
    dateColor: (data?.date_color as string | null) ?? "#44403c",
    dateSize: (data?.date_size as number | null) ?? 55,
    dateAlignment: align3(data?.date_alignment, "center"),
    dateDescription: (data?.date_description as string | null) ?? "Announcement Date",
    dateDescriptionAlignment: align3(data?.date_description_alignment, "center"),
    dateDescriptionLineSpacingMode: lineSpacingMode6(data?.date_description_line_spacing_mode),
    dateDescriptionLineSpacingAt: (data?.date_description_line_spacing_at as number | null) ?? null,
    dateLineStyle: lineStyle3(data?.date_line_style, "solid"),
    dateLineWidth: (data?.date_line_width as number | null) ?? 380,
    signerNameSize: (data?.signer_name_size as number | null) ?? 28,
    signerTitleSize: (data?.signer_title_size as number | null) ?? 22,
    signerNameBold: (data?.signer_name_bold as boolean | null) ?? true,
    signerTitleBold: (data?.signer_title_bold as boolean | null) ?? false,
    signerNameLineSpacingMode: lineSpacingMode6(data?.signer_name_line_spacing_mode),
    signerNameLineSpacingAt: (data?.signer_name_line_spacing_at as number | null) ?? null,
    signerTitleLineSpacingMode: lineSpacingMode6(data?.signer_title_line_spacing_mode),
    signerTitleLineSpacingAt: (data?.signer_title_line_spacing_at as number | null) ?? null,
    signerPosition: align3(data?.signer_position, "center"),
    signerLineStyle: lineStyle3(data?.signer_line_style, "solid"),
    signerLineWidth: (data?.signer_line_width as number | null) ?? 500,
    frameOuterWidth: (data?.frame_outer_width as number | null) ?? 14,
    frameInnerWidth: (data?.frame_inner_width as number | null) ?? 3,
    frameColor: (data?.frame_color as string | null) ?? null,
    header1Style: sanitizeTextStyle(data?.header1_style),
    header2Style: sanitizeTextStyle(data?.header2_style),
    body1Style: sanitizeTextStyle(data?.body1_style),
    body2Style: sanitizeTextStyle(data?.body2_style),
    body3Style: sanitizeTextStyle(data?.body3_style),
  };
}
