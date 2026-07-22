"use client";

import { CSV_DELIMITER } from "@/lib/csv";

function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const needsQuoting = new RegExp(`["${CSV_DELIMITER}\\n]`);
  const escape = (v: string) => (needsQuoting.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headers.join(CSV_DELIMITER)];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? "")).join(CSV_DELIMITER));
  }
  return lines.join("\n");
}

/** Exports the given rows as a downloaded CSV file — client-side only, no
 * server round-trip. Used on every admin listing table so Admin/Organizer,
 * Referee/Judge, and Participant Support can pull a spreadsheet copy of
 * whatever they're looking at (respects any active filters, since callers
 * pass the already-filtered rows). */
export default function DownloadCsvButton({
  rows,
  filename,
}: {
  rows: Array<Record<string, string>>;
  filename: string;
}) {
  const handleDownload = () => {
    const csv = toCsv(rows);
    // Leading BOM tells Excel the bytes are UTF-8 — without it, Excel
    // guesses a legacy codepage and non-ASCII characters render as mojibake.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={rows.length === 0}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
    >
      ⬇ Download CSV
    </button>
  );
}
