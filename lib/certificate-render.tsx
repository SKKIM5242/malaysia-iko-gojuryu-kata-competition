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
  signerName2?: string | null;
  signerTitle2?: string | null;
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

/** Rank label text color -- the medal artwork's own dark tone for that
 * rank, not a fixed white, per "wreath & rank text must be the medal
 * color." */
const MEDAL_THEME: Record<1 | 2 | 3, { discDark: string; label: string }> = {
  1: { discDark: "#8B6914", label: "1ST" },
  2: { discDark: "#6B6E73", label: "2ND" },
  3: { discDark: "#7A4A1E", label: "3RD" },
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

let cachedLogo2: string | null | undefined;
function logo2DataUri(): string | null {
  // Second org crest (IKO International / All Japan), shown on the right of
  // every certificate, mirroring the primary crest on the left. Optional --
  // renders as an empty slot until "IKO International Logo.png" is added to
  // /public, so the layout doesn't break in the meantime.
  if (cachedLogo2 === undefined) cachedLogo2 = readAsDataUri("IKO International Logo.png", "image/png");
  return cachedLogo2;
}

/** Pre-made medal artwork (ribbon + wreath-rim disc), one PNG per rank
 * color -- sourced from the organizer's own reference image with its
 * baked-in "1st" text erased (clone-stamped over from the neighboring
 * gradient, see scripts used to produce these), so a fresh rank label can
 * be rendered on top for whichever ordinal actually applies. Silver and
 * bronze are the same artwork re-toned (grayscale+tint, hue-shift) rather
 * than separate assets, so all three stay perfectly in sync. */
const MEDAL_IMAGE_FILE: Record<1 | 2 | 3, string> = {
  1: "Medal Gold.png",
  2: "Medal Silver.png",
  3: "Medal Bronze.png",
};
const MEDAL_NATURAL_W = 511;
const MEDAL_NATURAL_H = 488;
// Bounding box (in the source image's own pixel coordinates) of the blank
// patch left after erasing "1st" -- where the rank label gets rendered.
const MEDAL_LABEL_BOX = { x: 180, y: 278, w: 160, h: 82 };

const cachedMedalImage: Partial<Record<1 | 2 | 3, string | null>> = {};
function medalImageDataUri(rank: 1 | 2 | 3): string | null {
  if (!(rank in cachedMedalImage)) {
    cachedMedalImage[rank] = readAsDataUri(MEDAL_IMAGE_FILE[rank], "image/png");
  }
  return cachedMedalImage[rank] ?? null;
}

/** The medal: the pre-made ribbon+wreath artwork for this rank's color,
 * with the rank label ("1ST"/"2ND"/"3RD") rendered fresh on top, in the
 * medal's own dark tone, positioned over the artwork's blank center. */
function Medal({ rank, width }: { rank: 1 | 2 | 3; width: number }) {
  const t = MEDAL_THEME[rank];
  const img = medalImageDataUri(rank);
  const scale = width / MEDAL_NATURAL_W;
  const height = Math.round(MEDAL_NATURAL_H * scale);
  return (
    <div style={{ display: "flex", position: "relative", width, height }}>
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} width={width} height={height} alt="" />
      )}
      <div
        style={{
          position: "absolute",
          left: Math.round(MEDAL_LABEL_BOX.x * scale),
          top: Math.round(MEDAL_LABEL_BOX.y * scale),
          width: Math.round(MEDAL_LABEL_BOX.w * scale),
          height: Math.round(MEDAL_LABEL_BOX.h * scale),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ display: "flex", fontSize: Math.round(width * 0.13), fontWeight: 900, color: t.discDark }}>
          {t.label}
        </span>
      </div>
    </div>
  );
}

/** One signature block: signature image with the stamp overlapping its
 * trailing edge by ~10% (rather than sitting fully apart), an hr, then the
 * signer's name/title. Reused for both the primary (center) and second
 * (bottom-right) signer, at different scales. */
function SignerBlock({
  name,
  title,
  signatureUrl,
  stampUrl,
  sigW,
  sigH,
  stampSize,
  hrWidth,
}: {
  name: string | null;
  title: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
  sigW: number;
  sigH: number;
  stampSize: number;
  hrWidth: number;
}) {
  const overlap = Math.round(sigW * 0.1);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {signatureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signatureUrl} width={sigW} height={sigH} style={{ objectFit: "contain" }} alt="" />
        ) : (
          <div style={{ width: `${sigW}px`, height: `${sigH}px`, display: "flex" }} />
        )}
        {stampUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stampUrl}
            width={stampSize}
            height={stampSize}
            style={{ objectFit: "contain", marginLeft: `-${overlap}px` }}
            alt=""
          />
        )}
      </div>
      <div style={{ display: "flex", width: `${hrWidth}px`, borderTop: "3px solid #a8a29e", marginTop: "18px" }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "12px" }}>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#1c1917" }}>{name ?? "Organizer"}</div>
        {title && (
          <div style={{ display: "flex", fontSize: 22, color: "#57534e", textAlign: "center", maxWidth: `${hrWidth + 60}px` }}>
            {title}
          </div>
        )}
      </div>
    </div>
  );
}

export async function renderCertificatePng(input: CertificateInput): Promise<ImageResponse> {
  const isWinner = input.kind === "winner" && input.rank;
  const accent = isWinner ? RANK_ACCENT[input.rank!] : ACCENT[input.kind as Exclude<CertificateKind, "winner">];
  const logo = logoDataUri();
  const logo2 = logo2DataUri();
  const GOLD_LOGO_SIZE = 420;
  // Second (right-hand) crest reads ~25% bigger than the primary one.
  const LOGO2_SIZE = Math.round(GOLD_LOGO_SIZE * 1.25);
  // Width of the whole medal image (ribbon + disc together); the disc
  // itself is about 62% of that, so this reads at roughly the same disc
  // diameter as the logo crest beside it.
  const MEDAL_WIDTH = 530;

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

          {isWinner ? (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: "22px" }}>
              {logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} width={GOLD_LOGO_SIZE} height={GOLD_LOGO_SIZE} style={{ objectFit: "contain" }} alt="" />
              )}
              <Medal rank={input.rank!} width={MEDAL_WIDTH} />
              {logo2 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo2} width={LOGO2_SIZE} height={LOGO2_SIZE} style={{ objectFit: "contain" }} alt="" />
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: "56px" }}>
              {logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} width={GOLD_LOGO_SIZE} height={GOLD_LOGO_SIZE} style={{ objectFit: "contain" }} alt="" />
              )}
              {logo2 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo2} width={LOGO2_SIZE} height={LOGO2_SIZE} style={{ objectFit: "contain" }} alt="" />
              )}
            </div>
          )}

          <div
            style={{
              marginTop: "6px",
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
              marginTop: "-6px",
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
              marginTop: "-8px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0px",
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
            <SignerBlock
              name={input.signerName}
              title={input.signerTitle}
              signatureUrl={input.signatureUrl}
              stampUrl={input.stampUrl}
              sigW={240}
              sigH={90}
              stampSize={140}
              hrWidth={500}
            />

            <div style={{ position: "absolute", left: 0, bottom: 0, display: "flex" }}>
              <div style={{ display: "flex", flexDirection: "column", width: "380px" }}>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#44403c", paddingBottom: "10px" }}>
                  {input.dateLabel}
                </div>
                <div style={{ display: "flex", width: "100%", borderTop: "3px solid #a8a29e" }} />
                {input.kind === "winner" && (
                  <div style={{ marginTop: "8px", display: "flex", fontSize: 26, fontWeight: 600, color: "#78716c" }}>
                    Winner Announcement Date
                  </div>
                )}
              </div>
            </div>

            {input.signerName2 && (
              <div style={{ position: "absolute", right: 0, bottom: 0, display: "flex" }}>
                <SignerBlock
                  name={input.signerName2}
                  title={input.signerTitle2 ?? null}
                  signatureUrl={input.signatureUrl}
                  stampUrl={input.stampUrl}
                  sigW={180}
                  sigH={68}
                  stampSize={105}
                  hrWidth={380}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    { width: 2200, height: 1850 },
  );
}
