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

const ORDINAL: Record<1 | 2 | 3, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

const KIND_TITLE: Record<CertificateKind, string> = {
  winner: "Certificate of Achievement",
  participant: "Certificate of Participation",
  referee: "Certificate of Appreciation",
  sensei: "Certificate of Appreciation",
  school: "Certificate of Appreciation",
  support: "Certificate of Appreciation",
};

function subtitleLine1(input: CertificateInput): string {
  const event = input.categoryName ?? input.kataName ?? "the event";
  switch (input.kind) {
    case "winner":
      return `for placing ${ORDINAL[input.rank ?? 1]} PLACE in ${event} Event`;
    case "participant":
      return `for taking part in ${event} Event`;
    case "referee":
      return "for serving as a Referee / Judge";
    case "sensei":
      return "for guiding your students' participation, as Sensei,";
    case "school":
      return "for your students' participation, as a School / Dojo,";
    case "support":
      return "for supporting the organizing team";
  }
}

/** Non-winner kinds keep one fixed accent; winner's accent is rank-based
 * (gold/silver/bronze) instead — see RANK_ACCENT below. */
const ACCENT: Record<Exclude<CertificateKind, "winner">, string> = {
  participant: "#B91C1C",
  referee: "#1D4ED8",
  sensei: "#7C3AED",
  school: "#0F766E",
  support: "#B45309",
};

const RANK_ACCENT: Record<1 | 2 | 3, string> = { 1: "#B8860B", 2: "#64748B", 3: "#A15C2E" };

/** Ribbon color is the same red/white/blue for every rank (like a real
 * medal ribbon, e.g. the standard 🥇🥈🥉 icon set) — only the disc color
 * changes with placement. */
const MEDAL_THEME: Record<1 | 2 | 3, { discLight: string; discMid: string; discDark: string; label: string }> = {
  1: { discLight: "#FFF1C2", discMid: "#D4AF37", discDark: "#8B6914", label: "1ST" },
  2: { discLight: "#F5F5F5", discMid: "#C0C0C0", discDark: "#79797F", label: "2ND" },
  3: { discLight: "#EAC094", discMid: "#CD7F32", discDark: "#7A4A1E", label: "3RD" },
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
  // Square crest (not the wider logo.jpg banner) so a circular crop doesn't clip it.
  if (cachedLogo === undefined) cachedLogo = readAsDataUri("M Logo 400x400px.png", "image/png");
  return cachedLogo;
}

/** Two tricolor (red/white/blue) strips fanning out in a V from a shared
 * point at the top of the medal disc — like a ribbon threaded through a
 * clip and folded, the classic look used by real medal-ribbon icons.
 * Built from real SVG rects/rotation, not CSS transforms — Satori doesn't
 * miter CSS border-triangles into real triangles (tried that first; it
 * just rendered a rectangle), but native SVG transform="rotate(...)" on
 * <g> is core SVG and renders correctly. */
function RibbonV({ size }: { size: number }) {
  const vbW = size;
  const vbH = Math.round(size * 0.58);
  const stripW = Math.round(size * 0.24);
  const stripLen = Math.round(vbH * 1.05);
  const angle = 34;
  const vertexX = vbW / 2;
  const vertexY = vbH;
  const bandH = stripLen / 3;

  const strip = (rotate: number) => (
    <g transform={`translate(${vertexX}, ${vertexY}) rotate(${rotate})`} stroke="#374151" strokeWidth={3}>
      <rect x={-stripW / 2} y={-bandH} width={stripW} height={bandH + 1} fill="#DC2626" />
      <rect x={-stripW / 2} y={-2 * bandH} width={stripW} height={bandH + 1} fill="#FFFFFF" />
      <rect x={-stripW / 2} y={-stripLen} width={stripW} height={bandH + 1} fill="#1D4ED8" />
    </g>
  );

  return (
    <svg width={vbW} height={vbH} viewBox={`0 0 ${vbW} ${vbH}`}>
      {strip(-angle)}
      {strip(angle)}
    </svg>
  );
}

function Medal({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const t = MEDAL_THEME[rank];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", marginBottom: `-${Math.round(size * 0.185)}px` }}>
        <RibbonV size={size} />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: "999px",
          backgroundImage: `radial-gradient(circle at 32% 28%, ${t.discLight}, ${t.discMid} 55%, ${t.discDark} 100%)`,
          border: `${Math.round(size * 0.045)}px solid ${t.discDark}`,
        }}
      >
        <span style={{ display: "flex", fontSize: Math.round(size * 0.24), fontWeight: 900, color: "#ffffff" }}>
          {t.label}
        </span>
      </div>
    </div>
  );
}

export async function renderCertificatePng(input: CertificateInput): Promise<ImageResponse> {
  const isWinner = input.kind === "winner" && input.rank;
  const accent = isWinner ? RANK_ACCENT[input.rank!] : ACCENT[input.kind as Exclude<CertificateKind, "winner">];
  const logo = logoDataUri();
  const GOLD_LOGO_SIZE = 420;

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
          padding: "48px",
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
            border: `14px solid ${accent}`,
            borderRadius: "18px",
            padding: "60px 90px",
            backgroundColor: "#ffffff",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "20px",
              right: "20px",
              bottom: "20px",
              border: `3px solid ${accent}`,
              borderRadius: "8px",
              display: "flex",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "56px" }}>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} width={GOLD_LOGO_SIZE} height={GOLD_LOGO_SIZE} alt="" />
            )}
            {isWinner && <Medal rank={input.rank!} size={GOLD_LOGO_SIZE} />}
          </div>

          <div
            style={{
              marginTop: "20px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 56,
                fontWeight: 900,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: "#57534e",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              2026 Malaysia Open Virtual Karate-do Kata Championship
            </div>
            <div
              style={{
                marginTop: "4px",
                display: "flex",
                fontSize: 34,
                fontWeight: 900,
                color: "#a8a29e",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              Goju-ryu Version &amp; IKO Goju-ryu Version Only — Open Version for Kobudo (Weapon) Kata
            </div>
          </div>

          <div
            style={{
              marginTop: "14px",
              display: "flex",
              fontSize: 88,
              fontWeight: 900,
              letterSpacing: 1,
              color: accent,
            }}
          >
            {KIND_TITLE[input.kind]}
          </div>

          <div
            style={{
              marginTop: "4px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 88,
                fontWeight: 700,
                color: "#57534e",
                textAlign: "center",
                maxWidth: "1700px",
              }}
            >
              This certificate is proudly presented to
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 112,
                fontWeight: 700,
                color: "#1c1917",
                borderBottom: `4px solid ${accent}`,
                padding: "0 40px 16px",
              }}
            >
              {input.recipientName}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 46,
                fontWeight: 700,
                color: "#57534e",
                textAlign: "center",
                maxWidth: "1700px",
              }}
            >
              {subtitleLine1(input)}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 46,
                fontWeight: 700,
                color: "#57534e",
                textAlign: "center",
                maxWidth: "1700px",
              }}
            >
              at {input.competitionName}
            </div>
          </div>

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
              position: "relative",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "50px" }}>
              {input.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={input.signatureUrl} width={240} height={90} style={{ objectFit: "contain" }} alt="" />
              ) : (
                <div style={{ height: "90px", display: "flex" }} />
              )}
              {input.stampUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={input.stampUrl} width={140} height={140} style={{ objectFit: "contain" }} alt="" />
              )}
            </div>
            <div style={{ display: "flex", width: "500px", borderTop: "3px solid #a8a29e", marginTop: "18px" }} />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "12px" }}>
              <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#1c1917" }}>
                {input.signerName ?? "Organizer"}
              </div>
              {input.signerTitle && (
                <div style={{ display: "flex", fontSize: 22, color: "#57534e", textAlign: "center", maxWidth: "560px" }}>
                  {input.signerTitle}
                </div>
              )}
            </div>

            <div style={{ position: "absolute", left: 0, bottom: 0, display: "flex" }}>
              <div style={{ display: "flex", flexDirection: "column", width: "380px" }}>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#44403c", paddingBottom: "10px" }}>
                  {input.dateLabel}
                </div>
                <div style={{ display: "flex", width: "100%", borderTop: "3px solid #a8a29e" }} />
                <div style={{ marginTop: "8px", display: "flex", fontSize: 26, fontWeight: 600, color: "#78716c" }}>
                  {input.kind === "winner" ? "Winner Announcement Date" : "Certificate Issue Date"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 2200, height: 1850 },
  );
}
