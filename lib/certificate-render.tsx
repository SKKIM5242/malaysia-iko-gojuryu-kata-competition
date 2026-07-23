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

const RANK_ACCENT: Record<1 | 2 | 3, string> = { 1: "#B8860B", 2: "#8A8D93", 3: "#A15C2E" };

const MEDAL_THEME: Record<
  1 | 2 | 3,
  { discLight: string; discMid: string; discDark: string; ribbon: string; ribbonDark: string; label: string }
> = {
  1: { discLight: "#FFF1C2", discMid: "#D4AF37", discDark: "#8B6914", ribbon: "#DC2626", ribbonDark: "#7F1D1D", label: "1ST" },
  2: { discLight: "#F5F5F5", discMid: "#C0C0C0", discDark: "#79797F", ribbon: "#2563EB", ribbonDark: "#1E3A8A", label: "2ND" },
  3: { discLight: "#EAC094", discMid: "#CD7F32", discDark: "#7A4A1E", ribbon: "#16A34A", ribbonDark: "#14532D", label: "3RD" },
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

function Medal({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const t = MEDAL_THEME[rank];
  const ribbonW = Math.round(size * 0.34);
  const ribbonH = Math.round(size * 0.46);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          width: ribbonW,
          height: ribbonH,
          backgroundImage: `linear-gradient(180deg, ${t.ribbon}, ${t.ribbonDark})`,
          marginBottom: `-${Math.round(size * 0.16)}px`,
        }}
      />
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
              marginTop: "26px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 27,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "#57534e",
              }}
            >
              2026 Malaysia Open Virtual Karate-do Kata Championship
            </div>
            <div
              style={{
                marginTop: "8px",
                display: "flex",
                fontSize: 19,
                fontWeight: 500,
                color: "#a8a29e",
                maxWidth: "1500px",
                textAlign: "center",
              }}
            >
              Goju-ryu Version &amp; IKO Goju-ryu Version Only — Open Version for Kobudo (Weapon) Kata
            </div>
          </div>

          <div
            style={{
              marginTop: "34px",
              display: "flex",
              fontSize: 54,
              fontWeight: 900,
              letterSpacing: 1,
              color: accent,
            }}
          >
            {KIND_TITLE[input.kind]}
          </div>

          <div
            style={{
              marginTop: "44px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "14px",
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
                marginTop: "10px",
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
            }}
          >
            <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: "#44403c" }}>{input.dateLabel}</div>
            <div style={{ display: "flex", width: "620px", borderTop: "3px solid #a8a29e", marginTop: "16px" }} />
            <div
              style={{
                marginTop: "18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "40px",
              }}
            >
              {input.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={input.signatureUrl} width={190} height={70} style={{ objectFit: "contain" }} alt="" />
              ) : (
                <div style={{ height: "70px", display: "flex" }} />
              )}
              {input.stampUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={input.stampUrl} width={110} height={110} style={{ objectFit: "contain" }} alt="" />
              )}
            </div>
            <div style={{ marginTop: "12px", display: "flex", fontSize: 22, color: "#44403c" }}>
              {input.signerName ?? "Organizer"}
              {input.signerTitle ? ` — ${input.signerTitle}` : ""}
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 2200, height: 1850 },
  );
}
