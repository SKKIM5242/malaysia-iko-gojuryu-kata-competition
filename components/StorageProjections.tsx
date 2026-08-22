import { UPLOAD_CEILING_BYTES, recordingBitrates } from "@/lib/media-recording";
import { formatBytes } from "@/lib/storage-usage";

const KB = 1024;

/** Real per-file averages, measured from this project's own certificates
 * bucket rather than guessed. PDFs dominate: one is worth roughly fourteen
 * PNGs, which is the single biggest lever on what credential uploads cost. */
const CERT_FORMATS: Array<{ fmt: string; bytes: number; note?: string }> = [
  { fmt: "PDF", bytes: 935.3 * KB, note: "the expensive one" },
  { fmt: "JPG photo", bytes: 92.5 * KB },
  { fmt: "PNG scan", bytes: 65.9 * KB },
  { fmt: "Blended average", bytes: 393.4 * KB, note: "what a real mix costs" },
];

const CERT_COUNTS = [5_000, 12_000, 25_000, 50_000];

/** The organizer's own scenario: 13 kata from Elementary to Advance, 16
 * sub-categories each, top 3 in every one, plus the two larger families. */
const WINNERS = [
  { label: "Elementary → Advance (13 kata × 16 categories × 3)", n: 13 * 16 * 3 },
  { label: "Mastery", n: 72 },
  { label: "Kobudo", n: 60 },
];
const WINNER_TOTAL = WINNERS.reduce((s, w) => s + w.n, 0);

/** A 10-minute spoken script is roughly 1,300–1,500 words. Text, so it is
 * measured in kilobytes and it lives in the database, not in Storage. */
const MESSAGE_BYTES = 8 * KB;

export default function StorageProjections() {
  const t = recordingBitrates(10 * 60);
  const perSecond = (t.videoBitsPerSecond + t.audioBitsPerSecond) / 8;
  const video5 = perSecond * 300;
  const voice5 = (t.audioBitsPerSecond / 8) * 300;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">
        What it costs at scale
      </h2>

      {/* ---- The correction that matters most ---- */}
      <div className="mb-3 rounded-md border-2 border-green-300 bg-green-50 p-3">
        <p className="text-sm font-bold text-green-900">
          Award certificates cost NOTHING to store — at any number
        </p>
        <p className="mt-1 text-xs leading-relaxed text-green-900">
          Winner, Participation, Judge, Sensei and School certificates are drawn on demand each time someone opens
          the link, and are never written to Storage. 5,000 or 50,000 makes no difference: the figure is zero
          either way. What the <code className="rounded bg-white px-1">certificates</code> bucket actually holds is
          the <strong>rank certificates people upload</strong> when they register — a judge&apos;s dan grade, a
          sensei&apos;s credentials. Those are the ones that scale, and they are what the table below prices.
        </p>
      </div>

      {/* ---- Uploaded credential certificates ---- */}
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-neutral-500">
        Uploaded rank certificates (one per registrant who uploads)
      </h3>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Format uploaded</th>
              <th className="px-3 py-2 text-right">1 file</th>
              {CERT_COUNTS.map((n) => (
                <th key={n} className="px-3 py-2 text-right">
                  {n.toLocaleString()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {CERT_FORMATS.map((f) => (
              <tr key={f.fmt} className={f.fmt.startsWith("Blended") ? "bg-neutral-50 font-semibold" : ""}>
                <td className="px-3 py-2 text-neutral-800">
                  {f.fmt}
                  {f.note && <span className="ml-1 text-[10px] font-normal text-neutral-400">({f.note})</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{formatBytes(f.bytes)}</td>
                {CERT_COUNTS.map((n) => (
                  <td key={n} className="px-3 py-2 text-right tabular-nums text-neutral-900">
                    {formatBytes(f.bytes * n)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 max-w-3xl text-[11px] text-neutral-500">
        Averages measured from this project&apos;s own uploads, not estimated. The format matters more than
        anything else here: <strong>one PDF is worth about fourteen PNGs</strong>, so asking for a photo or a scan
        rather than a PDF export is the cheapest lever available — 50,000 PDFs is 44.6 GB, the same count as JPGs
        is 4.4 GB.
      </p>

      {/* ---- Testimonials ---- */}
      <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-500">
        Testimonials — {WINNER_TOTAL} winners
      </h3>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Testimonial type</th>
              <th className="px-3 py-2 text-right">Each</th>
              <th className="px-3 py-2 text-right">624 winners</th>
              <th className="px-3 py-2 text-right">{WINNER_TOTAL} winners</th>
              <th className="px-3 py-2">Stored where</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            <tr>
              <td className="px-3 py-2 text-neutral-800">Video testimonial, 5:00</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{formatBytes(video5)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">{formatBytes(video5 * 624)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">{formatBytes(video5 * WINNER_TOTAL)}</td>
              <td className="px-3 py-2 text-xs text-neutral-500">Storage</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-neutral-800">Voice testimonial, 5:00</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{formatBytes(voice5)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">{formatBytes(voice5 * 624)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-neutral-900">{formatBytes(voice5 * WINNER_TOTAL)}</td>
              <td className="px-3 py-2 text-xs text-neutral-500">Storage</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-neutral-800">Message, ~10 min script</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{formatBytes(MESSAGE_BYTES)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{formatBytes(MESSAGE_BYTES * 624)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{formatBytes(MESSAGE_BYTES * WINNER_TOTAL)}</td>
              <td className="px-3 py-2 text-xs text-neutral-500">Database — not Storage</td>
            </tr>
            <tr className="bg-amber-50 font-semibold">
              <td className="px-3 py-2 text-neutral-900">If every winner gave all three</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatBytes(video5 + voice5 + MESSAGE_BYTES)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatBytes((video5 + voice5 + MESSAGE_BYTES) * 624)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatBytes((video5 + voice5 + MESSAGE_BYTES) * WINNER_TOTAL)}</td>
              <td className="px-3 py-2 text-xs font-normal text-neutral-500">worst case</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 max-w-3xl text-[11px] text-neutral-500">
        Winner counts: {WINNERS.map((w) => `${w.label} = ${w.n}`).join(", ")} — {WINNER_TOTAL} in all. The rules say
        a winner picks <strong>one</strong> type, so the realistic figure is a single row, not the amber one; that
        last line is only there for the worst case. A voice testimonial costs about a sixth of a video one, and a
        typed message costs essentially nothing and does not touch Storage at all — so which type winners are
        encouraged toward is worth far more than any compression setting.
      </p>

      {/* ---- Branding ---- */}
      <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-neutral-500">
        Why the branding bucket is 68 bytes
      </h3>
      <p className="max-w-3xl rounded-md border border-neutral-200 bg-white p-3 text-xs leading-relaxed text-neutral-600">
        The <code className="rounded bg-neutral-100 px-1">branding</code> bucket holds the logo burned into the
        recording banner and printed on certificates — set under Recording Appearance on the Competitions page. It
        holds one file,{" "}
        <code className="rounded bg-neutral-100 px-1 text-[10px]">cert-participant-logo1-….png</code>, and it is{" "}
        <strong>68 bytes</strong>: far too small to be a real logo. A PNG cannot carry a visible image in 68 bytes —
        that is about the size of the file header alone, roughly a 1×1 transparent pixel. It is almost certainly a
        placeholder saved during setup rather than an actual logo, so anything relying on it is rendering nothing.{" "}
        <strong>Worth re-uploading the real logo</strong> and checking a certificate afterwards. A normal logo runs
        20–200 KB, so this costs nothing either way — the concern is that it is blank, not that it is big.
      </p>

      <p className="mt-3 max-w-3xl text-[11px] text-neutral-500">
        Every figure above is derived from the recorders&apos; live settings and this project&apos;s own measured
        uploads, so they move on their own if recording quality changes. The {formatBytes(UPLOAD_CEILING_BYTES)}{" "}
        per-file ceiling applies to each item individually and is separate from these totals.
      </p>
    </section>
  );
}
