/**
 * Renders a certificate as a PNG using Next.js's built-in next/og image
 * generator (Satori under the hood) -- no new dependency, works natively on
 * Vercel. Certificates are never stored; every download re-renders from
 * live data, same "computed live" philosophy as winners/rewards/commissions
 * elsewhere in this app.
 */
import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

export type CertificateKind = "winner" | "participant" | "referee" | "sensei" | "school" | "support";

export interface CertificateInput {
  kind: CertificateKind;
  recipientName: string;
  competitionName: string;
  categoryName?: string | null;
  kataName?: string | null;
  rank?: 1 | 2 | 3 | null;
  dateLabel: string;
  signerName: string | null;
  signerTitle: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
}

const RANK_LABEL: Record<1 | 2 | 3, string> = { 1: "1ST PLACE", 2: "2ND PLACE", 3: "3RD PLACE" };

const KIND_TITLE: Record<CertificateKind, string> = {
  winner: "Certificate of Achievement",
  participant: "Certificate of Participation",
  referee: "Certificate of Appreciation",
  sensei: "Certificate of Appreciation",
  school: "Certificate of Appreciation",
  support: "Certificate of Appreciation",
};

function kindSubtitle(input: CertificateInput): string {
  const event = input.categoryName ?? input.kataName ?? "the event";
  switch (input.kind) {
    case "winner":
      return `for placing ${RANK_LABEL[input.rank ?? 1]} in ${event} at`;
    case "participant":
      return `for taking part in ${event} at`;
    case "referee":
      return "for serving as a Referee / Judge at";
    case "sensei":
      return "for guiding your students' participation, as Sensei, at";
    case "school":
      return "for your students' participation, as a School / Dojo, at";
    case "support":
      return "for supporting the organizing team at";
  }
}

const ACCENT: Record<CertificateKind, string> = {
  winner: "#B8860B",
  participant: "#B91C1C",
  referee: "#1D4ED8",
  sensei: "#7C3AED",
  school: "#0F766E",
  support: "#B45309",
};

function readAsDataUri(relPath: string, mime: string): string | null {
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), "public", relPath));
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

let cachedLogo: string | null | undefined;
function logoDataUri(): string | null {
  if (cachedLogo === undefined) cachedLogo = readAsDataUri("logo.jpg", "image/jpeg");
  return cachedLogo;
}

export async function renderCertificatePng(input: CertificateInput): Promise<ImageResponse> {
  const accent = ACCENT[input.kind];
  const logo = logoDataUri();
  const rankBadge = input.kind === "winner" && input.rank ? RANK_LABEL[input.rank] : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fffaf0",
          backgroundImage: "linear-gradient(135deg, #fff7ed 0%, #fffaf0 55%, #fef2f2 100%)",
          padding: "36px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            border: `10px solid ${accent}`,
            borderRadius: "14px",
            padding: "56px 76px",
            backgroundColor: "#ffffff",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "16px",
              left: "16px",
              right: "16px",
              bottom: "16px",
              border: `2px solid ${accent}`,
              borderRadius: "6px",
              display: "flex",
            }}
          />

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} width={84} height={84} style={{ borderRadius: "999px" }} alt="" />
            )}
            <div
              style={{
                marginTop: "14px",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "#78716c",
                display: "flex",
              }}
            >
              Malaysia Open IKO Goju-ryu Karate-do Kata Championship
            </div>
            {rankBadge && (
              <div
                style={{
                  marginTop: "14px",
                  fontSize: 16,
                  fontWeight: 800,
                  letterSpacing: 3,
                  color: "#ffffff",
                  backgroundColor: accent,
                  padding: "6px 22px",
                  borderRadius: "999px",
                  display: "flex",
                }}
              >
                {rankBadge}
              </div>
            )}
            <div
              style={{
                marginTop: "16px",
                fontSize: 44,
                fontWeight: 800,
                color: accent,
                display: "flex",
              }}
            >
              {KIND_TITLE[input.kind]}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <div style={{ fontSize: 18, color: "#57534e", display: "flex" }}>
              This certificate is proudly presented to
            </div>
            <div
              style={{
                fontSize: 50,
                fontWeight: 700,
                color: "#1c1917",
                borderBottom: `3px solid ${accent}`,
                padding: "0 28px 10px",
                display: "flex",
              }}
            >
              {input.recipientName}
            </div>
            <div
              style={{
                marginTop: "6px",
                fontSize: 20,
                color: "#57534e",
                textAlign: "center",
                maxWidth: "820px",
                display: "flex",
              }}
            >
              {kindSubtitle(input)} {input.competitionName}
            </div>
            <div style={{ fontSize: 16, color: "#a8a29e", display: "flex" }}>{input.dateLabel}</div>
          </div>

          <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "260px" }}>
              {input.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={input.signatureUrl} width={160} height={58} style={{ objectFit: "contain" }} alt="" />
              ) : (
                <div style={{ height: "58px", display: "flex" }} />
              )}
              <div
                style={{
                  width: "100%",
                  borderTop: "1px solid #a8a29e",
                  marginTop: "6px",
                  paddingTop: "6px",
                  fontSize: 14,
                  color: "#44403c",
                  textAlign: "center",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                {input.signerName ?? "Organizer"}
                {input.signerTitle ? ` — ${input.signerTitle}` : ""}
              </div>
            </div>
            {input.stampUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={input.stampUrl} width={96} height={96} style={{ objectFit: "contain" }} alt="" />
            ) : (
              <div style={{ width: "96px", display: "flex" }} />
            )}
          </div>
        </div>
      </div>
    ),
    { width: 1600, height: 1131 },
  );
}
