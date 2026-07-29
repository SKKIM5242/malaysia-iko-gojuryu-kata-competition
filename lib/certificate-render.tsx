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

/** Crystal-shine 3D look for the rank label, per rank's own metal color --
 * a banded top-to-bottom gradient (light -> bright -> a darker "groove" ->
 * bright again -> dark edge) reads as a polished, reflective surface, the
 * same way a chrome/gem 3D text effect works. `shadowDeep` builds the
 * beveled extrusion behind it; `outline` is a thin 4-directional ring that
 * keeps every letter reading crisply against the medal art it sits on. */
const MEDAL_LABEL_STYLE: Record<1 | 2 | 3, { gradient: string; shadowDeep: string; outline: string }> = {
  1: {
    gradient: "linear-gradient(180deg, #FFFFFF 0%, #FFF3B0 14%, #FFD700 28%, #FFEC8B 42%, #C9960C 56%, #FFD700 74%, #A67C0A 100%)",
    shadowDeep: "#4A3305",
    outline: "#6B4C08",
  },
  2: {
    gradient: "linear-gradient(180deg, #FFFFFF 0%, #F2F2F4 14%, #D6D8DB 28%, #FFFFFF 42%, #9A9DA3 56%, #E0E2E5 74%, #71747A 100%)",
    shadowDeep: "#2E3033",
    outline: "#4A4D52",
  },
  3: {
    gradient: "linear-gradient(180deg, #FFF0DD 0%, #F2C994 14%, #E8A659 28%, #FFD9A8 42%, #A9662E 56%, #E0A566 74%, #6B3F1B 100%)",
    shadowDeep: "#361F0C",
    outline: "#5C3814",
  },
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
// These PNGs are now cropped tight to the ribbon+disc artwork itself (the
// original files had the medal filling only ~48% of a much wider canvas,
// which made the logo-medal-logo cluster read as far more spread out than
// intended even with a small flex gap -- see the coordinate note below).
const MEDAL_NATURAL_W = 247;
const MEDAL_NATURAL_H = 391;
// Bounding box (in the source image's own pixel coordinates) of the wreath's
// open center, where the rank label gets rendered -- moved up closer to the
// star (small gap only) and enlarged to better fill that circular opening,
// measured directly off a zoomed crop of the medal artwork.
const MEDAL_LABEL_BOX = { x: 35, y: 216, w: 177, h: 104 };

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
        <RankLabel3D rank={rank} width={width} />
      </div>
    </div>
  );
}

/** The "1ST"/"2ND"/"3RD" rank label, rendered as a crystal-shine 3D block:
 * a stack of solid copies offset diagonally builds the beveled extrusion
 * (deep-shadow-colored, like a chiseled edge), a single thin highlight
 * copy on the opposite corner catches the light, and the glossy banded
 * gradient face sits on top -- same construction as a chrome/gem 3D text
 * effect, per the organizer's reference image. */
// "2ND"/"3RD" carry wider glyphs (N, D, R) than "1ST"'s (S, T) at the same
// font size, so one shared ratio let them spill past the wreath's leaves
// while "1ST" fit fine -- Satori can't measure rendered text width like a
// canvas can, so these per-rank ratios are tuned by eye against the actual
// wreath opening instead of computed.
const MEDAL_LABEL_FONT_SCALE: Record<1 | 2 | 3, number> = { 1: 0.34, 2: 0.27, 3: 0.27 };

function RankLabel3D({ rank, width }: { rank: 1 | 2 | 3; width: number }) {
  const t = MEDAL_THEME[rank];
  const s = MEDAL_LABEL_STYLE[rank];
  const fontSize = Math.round(width * MEDAL_LABEL_FONT_SCALE[rank]);
  const step = Math.max(1, Math.round(width * 0.009));
  const depthSteps = 6;
  return (
    <div style={{ position: "relative", display: "flex" }}>
      {Array.from({ length: depthSteps }, (_, i) => depthSteps - i).map((i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: i * step,
            top: i * step,
            display: "flex",
            fontSize,
            fontWeight: 900,
            color: s.shadowDeep,
          }}
        >
          {t.label}
        </span>
      ))}
      {/* Thin outline in a 4-directional ring, close to the face -- keeps
          every letter reading crisply against the medal art behind it,
          which the depth stack alone (offset only down-right) doesn't
          guarantee on the up-left side. */}
      {[
        [1, 0], [-1, 0], [0, 1], [0, -1],
      ].map(([dx, dy]) => (
        <span
          key={`${dx}-${dy}`}
          style={{
            position: "absolute",
            left: dx,
            top: dy,
            display: "flex",
            fontSize,
            fontWeight: 900,
            color: s.outline,
          }}
        >
          {t.label}
        </span>
      ))}
      <span
        style={{
          display: "flex",
          fontSize,
          fontWeight: 900,
          backgroundImage: s.gradient,
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          color: "transparent",
        }}
      >
        {t.label}
      </span>
    </div>
  );
}

/** Shared height for every footer column's "top" zone (signature+stamp
 * images, or the date number) -- bottom-anchored within it, so the hr line
 * that follows sits at the exact same y for the date and both signers,
 * regardless of how tall each column's own top content actually is. */
const FOOTER_TOP_H = 140;

/** One signature block: signature image with the stamp overlapping its
 * trailing edge by ~10% (rather than sitting fully apart), an hr, then the
 * signer's name/title. Reused for both the primary and second signer, at
 * different scales. */
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
      <div style={{ display: "flex", height: `${FOOTER_TOP_H}px`, alignItems: "flex-end", justifyContent: "center" }}>
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

/** The date column: mirrors SignerBlock's structure (fixed-height top
 * zone, hr, caption below) so its hr lines up with both signers'. */
function DateBlock({ dateLabel, caption, width }: { dateLabel: string; caption: string; width: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: `${width}px` }}>
      <div style={{ display: "flex", height: `${FOOTER_TOP_H}px`, alignItems: "flex-end", justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: 55, fontWeight: 800, color: "#44403c" }}>{dateLabel}</div>
      </div>
      <div style={{ display: "flex", width: "100%", borderTop: "3px solid #a8a29e", marginTop: "18px" }} />
      <div style={{ marginTop: "12px", display: "flex", fontSize: 33, fontWeight: 600, color: "#78716c" }}>
        {caption}
      </div>
    </div>
  );
}

export async function renderCertificatePng(input: CertificateInput): Promise<ImageResponse> {
  // Certificates say "Competition" even though the competition record itself
  // is still named "...Championship..." elsewhere on the site — a wording
  // choice scoped to this template only, not a site-wide rename.
  const competitionName = input.competitionName.replace(/Championship/g, "Competition");
  const isWinner = input.kind === "winner" && input.rank;
  const accent = isWinner ? RANK_ACCENT[input.rank!] : ACCENT[input.kind as Exclude<CertificateKind, "winner">];
  const logo = logoDataUri();
  const logo2 = logo2DataUri();
  const GOLD_LOGO_SIZE = 420;
  // Logo 2's own asset is now cropped just as tightly as Logo 1's (see
  // "IKO International Logo.png"), so equal boxes now read as equal sizes
  // — the old 1.25x bump was compensating for that asset's excess padding.
  const LOGO2_SIZE = GOLD_LOGO_SIZE;
  // Now that the medal PNG is cropped tight (bounding box == visible
  // content, same convention as the two logos), this width IS the visible
  // ribbon+disc width. 307px reproduced the prior visible medal size
  // exactly; bumped another 20% per the organizer's follow-up request.
  const MEDAL_WIDTH = Math.round(307 * 1.2);

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
            // Top padding trimmed from the original 60px, but kept well
            // clear of the inner double-border overlay below (a fixed 20px
            // inset from this box's own border, regardless of padding) --
            // going all the way down to 20px here made the logo row start
            // at the exact same Y as that border line and draw over it,
            // erasing it wherever a logo sat. 44px leaves a clean gap.
            padding: "44px 90px 60px",
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
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: "20px" }}>
              {logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} width={GOLD_LOGO_SIZE} height={GOLD_LOGO_SIZE} style={{ objectFit: "contain" }} alt="" />
              )}
              {/* Lifted so the ribbon tip touches the thin inner border
                  line above (a deliberate "linked to the frame" look) --
                  the row's own alignItems:"center" would otherwise keep it
                  flush with the top of the (now taller) row, 24px below
                  that line. */}
              <div style={{ display: "flex", marginTop: "-28px" }}>
                <Medal rank={input.rank!} width={MEDAL_WIDTH} />
              </div>
              {logo2 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo2}
                  width={LOGO2_SIZE}
                  height={LOGO2_SIZE}
                  style={{ objectFit: "contain", marginLeft: "46px" }}
                  alt=""
                />
              )}
            </div>
          ) : (
            // marginBottom matches the breathing room the winner row gets
            // "for free" below its taller medal -- these certs have no
            // medal, so the two same-height logos leave zero gap on their
            // own before the title text starts right underneath.
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: "20px",
                marginBottom: "40px",
              }}
            >
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
              marginTop: "0px",
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
              2026 Malaysia Open Virtual Karate-do Kata Competition
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
              fontSize: 112,
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
              at {competitionName}
            </div>
          </div>

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              width: "100%",
              paddingRight: "16%",
            }}
          >
            <DateBlock
              dateLabel={input.dateLabel}
              caption={input.kind === "winner" ? "Winner Announcement Date" : "Announcement Date"}
              width={380}
            />

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

            {input.signerName2 && (
              <SignerBlock
                name={input.signerName2}
                title={input.signerTitle2 ?? null}
                signatureUrl={input.signatureUrl}
                stampUrl={input.stampUrl}
                sigW={220}
                sigH={84}
                stampSize={130}
                hrWidth={460}
              />
            )}
          </div>
        </div>
      </div>
    ),
    { width: 2200, height: 1850 },
  );
}
