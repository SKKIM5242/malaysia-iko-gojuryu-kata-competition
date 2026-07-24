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

let cachedLogo2: string | null | undefined;
function logo2DataUri(): string | null {
  // Second org crest (IKO International / All Japan), shown on the right of
  // every certificate, mirroring the primary crest on the left. Optional --
  // renders as an empty slot until "IKO International Logo.png" is added to
  // /public, so the layout doesn't break in the meantime.
  if (cachedLogo2 === undefined) cachedLogo2 = readAsDataUri("IKO International Logo.png", "image/png");
  return cachedLogo2;
}

/** Two ribbon tails fanning out in a wide V from a small clasp/hook on top
 * of the medal — like a single ribbon threaded through that hook, each
 * tail striped red/white/blue running ALONG its own length (three
 * parallel bars), with the second tail's stripe order mirrored
 * (blue/white/red) the way the far side of a single folded ribbon reads
 * in reverse. Built from real SVG rects/rotation, not CSS transforms —
 * Satori doesn't miter CSS border-triangles into real triangles (tried
 * that first; it just rendered a rectangle), but native SVG
 * transform="rotate(...)" on <g> is core SVG and renders correctly. */
function RibbonV({ size }: { size: number }) {
  const vbW = size;
  const vbH = Math.round(size * 0.62);
  const stripW = Math.round(size * 0.26);
  const stripLen = Math.round(vbH * 1.05);
  const angle = 40;
  const vertexX = vbW / 2;
  const vertexY = vbH;
  const bandW = stripW / 3;

  const strip = (rotate: number, order: [string, string, string]) => (
    <g transform={`translate(${vertexX}, ${vertexY}) rotate(${rotate})`} stroke="#374151" strokeWidth={2.5}>
      <rect x={-stripW / 2} y={-stripLen} width={bandW + 1} height={stripLen} fill={order[0]} />
      <rect x={-stripW / 2 + bandW} y={-stripLen} width={bandW + 1} height={stripLen} fill={order[1]} />
      <rect x={-stripW / 2 + 2 * bandW} y={-stripLen} width={bandW + 1} height={stripLen} fill={order[2]} />
    </g>
  );

  return (
    <svg width={vbW} height={vbH} viewBox={`0 0 ${vbW} ${vbH}`}>
      {strip(-angle, ["#DC2626", "#FFFFFF", "#1D4ED8"])}
      {strip(angle, ["#1D4ED8", "#FFFFFF", "#DC2626"])}
      {/* Hook the ribbon threads through -- a real ring (stroke only), not
       * a filled blob, sitting right on the medal's rim. */}
      <ellipse
        cx={vertexX}
        cy={vertexY - Math.round(size * 0.02)}
        rx={Math.round(size * 0.075)}
        ry={Math.round(size * 0.05)}
        fill="none"
        stroke="#4B5563"
        strokeWidth={Math.round(size * 0.018)}
      />
    </svg>
  );
}

/** A continuous laurel-leaf ring running the full inner rim of the disc --
 * like the engraved wreath border on a real medal (a photo of one, not a
 * standalone wreath badge, is what this now matches): even-sized pointed
 * leaves all the way around, no top opening, no stars/berries. Mirrored
 * left/right, meeting near the top and bottom poles. Positions are plain
 * trigonometry (not SVG rotate groups) since each leaf needs both a
 * different position AND a different own rotation. */
function laurelArc(cx: number, cy: number, ringR: number, leafLen: number, gradientId: string, outline: string, side: 1 | -1) {
  const leaves = [];
  const count = 17;
  const startDeg = -87;
  const endDeg = 87;
  const halfL = leafLen / 2;
  const bulge = leafLen * 0.15;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const deg = startDeg + t * (endDeg - startDeg);
    const rad = (deg * Math.PI) / 180;
    const x = cx + side * ringR * Math.cos(rad);
    const y = cy + ringR * Math.sin(rad);
    // Leaves point outward from the ring, angled forward along its curve.
    const leafRotate = side === 1 ? -(deg + 30) : deg + 30;
    leaves.push(
      <g key={`${side}-${i}`} transform={`translate(${x} ${y}) rotate(${leafRotate})`}>
        <path
          d={`M ${-halfL} 0 Q 0 ${-bulge} ${halfL} 0 Q 0 ${bulge} ${-halfL} 0 Z`}
          fill={`url(#${gradientId})`}
          stroke={outline}
          strokeWidth={Math.max(1, leafLen * 0.045)}
          strokeOpacity={0.5}
        />
        <line
          x1={-halfL * 0.75}
          y1={0}
          x2={halfL * 0.75}
          y2={0}
          stroke={outline}
          strokeOpacity={0.4}
          strokeWidth={Math.max(1, leafLen * 0.03)}
        />
      </g>,
    );
  }
  return leaves;
}

/** A stylized, sharp "V" silhouette woven into the base of the leaf
 * pattern, where the two wreath halves meet at the bottom -- the classic
 * "V for Victory" motif seen on Malaysian wreath-medal designs, distinct
 * from (and bolder than) the surrounding leaves. */
function victoryV(cx: number, cy: number, r: number, color: string) {
  const vertexY = cy + r * 0.85;
  const armY = cy + r * 0.6;
  const armX = r * 0.17;
  return (
    <path
      d={`M ${cx - armX} ${armY} L ${cx} ${vertexY} L ${cx + armX} ${armY}`}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(2, r * 0.055)}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Medal({ rank, size }: { rank: 1 | 2 | 3; size: number }) {
  const t = MEDAL_THEME[rank];
  const r = size / 2;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", marginBottom: `-${Math.round(size * 0.185)}px` }}>
        <RibbonV size={size} />
      </div>
      <div style={{ display: "flex", position: "relative", width: size, height: size }}>
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
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="leafGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={t.discLight} />
              <stop offset="55%" stopColor={t.discMid} />
              <stop offset="100%" stopColor={t.discDark} />
            </linearGradient>
          </defs>
          <circle cx={r} cy={r} r={r * 0.82} fill="none" stroke={t.discDark} strokeWidth={Math.max(2, r * 0.02)} opacity={0.55} />
          {laurelArc(r, r, r * 0.76, r * 0.15, "leafGrad", t.discDark, 1)}
          {laurelArc(r, r, r * 0.76, r * 0.15, "leafGrad", t.discDark, -1)}
          {victoryV(r, r, r, t.discDark)}
        </svg>
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
  // The medal's disc is a full-bleed circle with no internal padding, so
  // at the same box size it visually reads bigger than the logo (which
  // has margin baked into its square canvas) -- sized down to match.
  const MEDAL_SIZE = 330;

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
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <div style={{ display: "flex", width: `${GOLD_LOGO_SIZE}px`, height: `${GOLD_LOGO_SIZE}px`, alignItems: "center", justifyContent: "flex-start" }}>
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} alt="" />
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Medal rank={input.rank!} size={MEDAL_SIZE} />
              </div>
              <div style={{ display: "flex", width: `${GOLD_LOGO_SIZE}px`, height: `${GOLD_LOGO_SIZE}px`, alignItems: "center", justifyContent: "flex-end" }}>
                {logo2 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo2} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} alt="" />
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: "56px" }}>
              {logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} width={GOLD_LOGO_SIZE} height={GOLD_LOGO_SIZE} style={{ objectFit: "contain" }} alt="" />
              )}
              {logo2 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo2} width={GOLD_LOGO_SIZE} height={GOLD_LOGO_SIZE} style={{ objectFit: "contain" }} alt="" />
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
                <div style={{ marginTop: "8px", display: "flex", fontSize: 26, fontWeight: 600, color: "#78716c" }}>
                  {input.kind === "winner" ? "Winner Announcement Date" : "Certificate Issue Date"}
                </div>
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
