/**
 * Regenerates public/winner-testimonial-sample-scripts.pdf from the single
 * source of truth, lib/testimonial-scripts.ts, so the downloadable PDF and
 * the in-app script picker can never drift apart.
 *
 *   node scripts/build-testimonial-scripts-pdf.mjs
 *
 * Deliberately dependency-free. Adding a PDF library to a Next.js app's
 * package.json for one build-time script would ship it to every install
 * for no runtime benefit, so this writes the PDF by hand: base-14 Helvetica
 * (no font embedding needed), one content stream per page, and the real
 * Helvetica advance widths below so text wraps where it actually wraps
 * rather than where a guessed average character width says it should.
 *
 * Layout mirrors the organizer's own table: a two-column row per script,
 * cues on the left, the written first-person script on the right.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Helvetica base-14 advance widths (units of 1/1000 em) ────────────────
// Only the printable ASCII range is needed; anything outside it falls back
// to the width of "n", which is close enough for the rare stray character.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELV_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

function widthOf(text, size, bold) {
  const table = bold ? HELV_BOLD : HELV;
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    total += code >= 32 && code <= 126 ? table[code - 32] : table[110 - 32];
  }
  return (total * size) / 1000;
}

/** Greedy word wrap against real glyph widths. */
function wrap(text, size, bold, maxWidth) {
  const out = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate, size, bold) <= maxWidth || !line) {
        line = candidate;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** PDF string literals escape backslash and both parentheses. Everything
 * outside Latin-1 is transliterated, because a base-14 font has no glyphs
 * for it — better a plain hyphen than a missing-glyph box. */
function pdfEscape(text) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

// ── Read the scripts straight out of the TypeScript source ───────────────
// Importing the .ts module would need a TypeScript loader; the file is a
// plain data module, so stripping the type annotations and evaluating it is
// both simpler and has no build-order dependency.
function loadScripts() {
  const source = readFileSync(join(ROOT, "lib", "testimonial-scripts.ts"), "utf8");
  const js = source
    .replace(/^import[^;]+;$/gm, "")
    .replace(/^export type [^;]+;$/gm, "")
    .replace(/^export interface [\s\S]*?^}$/gm, "")
    .replace(/export const SCRIPT_LENGTH_LABEL[\s\S]*?^};$/gm, "")
    .replace(/^export function [\s\S]*?^}$/gm, "")
    .replace(/: TestimonialScript\[\]/g, "")
    .replace(/: Record<ScriptLengthBand, string>/g, "")
    .replace(/\bexport /g, "");
  const factory = new Function(`${js}\nreturn TESTIMONIAL_SCRIPTS;`);
  return factory();
}

// ── Page layout ──────────────────────────────────────────────────────────
const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 40;
const GUTTER = 14;
const COL_W = (PAGE_W - MARGIN * 2 - GUTTER) / 2;
const BODY_SIZE = 8.5;
const LEAD = 11;
const TITLE_SIZE = 11;

const BAND_HEADING = {
  "3min": "~3 Minutes (10 scripts)",
  "5min": "~5 Minutes (10 scripts)",
  "10min": "~10 Minutes (20 scripts)",
};

const pages = [];
let ops = [];
let y = 0;

function newPage() {
  if (ops.length) pages.push(ops);
  ops = [];
  y = PAGE_H - MARGIN;
}

function text(str, x, yPos, size, bold) {
  ops.push(
    `BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${yPos.toFixed(2)} Td (${pdfEscape(str)}) Tj ET`,
  );
}

function line(x1, y1, x2, y2, gray = 0.75) {
  ops.push(`${gray} G 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S 0 G`);
}

function ensure(space) {
  if (y - space < MARGIN) newPage();
}

const scripts = loadScripts();

// Cover
newPage();
text("Malaysia Open Virtual Karate-do Kata Competition", MARGIN, y - 6, 15, true);
y -= 26;
text("Winner Testimonial - 40 Sample Scripts", MARGIN, y - 6, 13, true);
y -= 22;
for (const paragraph of [
  "Every script below is written on your behalf, in the first person. Start with Hi, finish with Thank you.",
  "Replace XXX with a name, and fill in each ______ with your own details.",
  "Left column: what to cover.  Right column: the words to say.",
  "You may read it as written, or change any sentence into your own words - both are accepted.",
  "The same 40 scripts are selectable, editable and copyable inside the testimonial recorder on the website.",
]) {
  for (const l of wrap(paragraph, 9.5, false, PAGE_W - MARGIN * 2)) {
    text(l, MARGIN, y - 6, 9.5, false);
    y -= 13;
  }
  y -= 3;
}

let currentBand = null;
let index = 0;

for (const script of scripts) {
  if (script.lengthBand !== currentBand) {
    currentBand = script.lengthBand;
    index = 0;
    newPage();
    text(BAND_HEADING[currentBand], MARGIN, y - 10, 13, true);
    y -= 24;
    line(MARGIN, y, PAGE_W - MARGIN, y, 0.4);
    y -= 14;
  }
  index += 1;

  const cueLines = [];
  script.prompts.forEach((prompt, i) => {
    const letter = String.fromCharCode(97 + i);
    const wrapped = wrap(`${letter}. ${prompt}`, BODY_SIZE, false, COL_W - 4);
    wrapped.forEach((l, n) => cueLines.push(n === 0 ? l : `   ${l}`));
  });
  const scriptLines = [];
  for (const paragraph of script.script) {
    scriptLines.push(...wrap(paragraph, BODY_SIZE, false, COL_W - 4));
  }

  const rowLines = Math.max(cueLines.length, scriptLines.length);
  const rowHeight = rowLines * LEAD + 26;

  // A script is only split across a page break when it genuinely cannot fit
  // on a page at all — otherwise the two columns would stop lining up.
  if (rowHeight <= PAGE_H - MARGIN * 2) ensure(rowHeight);

  text(`${index}. ${script.title}`, MARGIN, y - TITLE_SIZE, TITLE_SIZE, true);
  y -= TITLE_SIZE + 8;

  const rowTop = y;
  let cueY = y;
  for (const l of cueLines) {
    if (cueY - LEAD < MARGIN) {
      newPage();
      cueY = y = PAGE_H - MARGIN;
    }
    text(l, MARGIN, cueY - BODY_SIZE, BODY_SIZE, false);
    cueY -= LEAD;
  }
  let scriptY = rowTop;
  for (const l of scriptLines) {
    if (scriptY - LEAD < MARGIN) break;
    text(l, MARGIN + COL_W + GUTTER, scriptY - BODY_SIZE, BODY_SIZE, false);
    scriptY -= LEAD;
  }

  y = Math.min(cueY, scriptY) - 8;
  ensure(20);
  line(MARGIN, y, PAGE_W - MARGIN, y);
  y -= 12;
}

newPage();

// ── Assemble the PDF file ────────────────────────────────────────────────
const objects = [];
function addObject(body) {
  objects.push(body);
  return objects.length; // 1-based object number
}

const fontRegular = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
const fontBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
const pagesObjNumber = objects.length + 1 + pages.length * 2; // reserved below

const pageObjNumbers = [];
for (const pageOps of pages) {
  const stream = pageOps.join("\n");
  const contentObj = addObject(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  pageObjNumbers.push(
    addObject(
      `<< /Type /Page /Parent ${pagesObjNumber} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentObj} 0 R >>`,
    ),
  );
}

const pagesObj = addObject(
  `<< /Type /Pages /Count ${pageObjNumbers.length} /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`,
);
if (pagesObj !== pagesObjNumber) throw new Error(`page tree object number mismatch: ${pagesObj} vs ${pagesObjNumber}`);
const catalog = addObject(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf, "latin1"));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefStart = Buffer.byteLength(pdf, "latin1");
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i += 1) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const outPath = join(ROOT, "public", "winner-testimonial-sample-scripts.pdf");
writeFileSync(outPath, Buffer.from(pdf, "latin1"));
console.log(`Wrote ${outPath} - ${scripts.length} scripts, ${pageObjNumbers.length} pages`);
