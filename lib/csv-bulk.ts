import { parseCsv } from "@/lib/csv";

/** Parses a "DD/MM/YYYY" (or "D/M/YYYY") date string into ISO "YYYY-MM-DD"
 * — the format senseis are asked to key dates in on the bulk CSV template,
 * since relying on Excel's own locale-dependent date entry (or a bare
 * `Date.parse`, which reads slash dates as MM/DD in JS) silently misreads
 * ambiguous dates like 02/03. Returns null if the string doesn't parse to
 * a real calendar date. */
export function parseDDMMYYYY(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(iso + "T00:00:00");
  if (d.getFullYear() !== year || d.getMonth() + 1 !== month || d.getDate() !== day) return null;
  return iso;
}

export interface CsvUploadResult {
  done: boolean;
  error?: string;
  succeeded?: number;
  failed?: number;
  failures?: Array<{ row: number; name: string; error: string }>;
}

/** Parses a CSV file's text against an expected header (case/space tolerant)
 * and returns a row getter. Shared by every admin bulk-upload action so each
 * one only has to define its own columns and per-row validation. */
export function parseCsvWithHeader(text: string, columns: readonly string[]) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { error: "The CSV has no data rows." } as const;
  }
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s/-]+/g, "_"));
  const colIndex = new Map<string, number>();
  for (const col of columns) colIndex.set(col, header.indexOf(col));
  const missingCols = columns.filter((c) => (colIndex.get(c) ?? -1) === -1);
  if (missingCols.length > 0) {
    return {
      error: `CSV is missing columns: ${missingCols.join(", ")}. Download the template and keep its header row.`,
    } as const;
  }
  const dataRows = rows.slice(1).filter((r) => r.some((v) => v.trim() !== ""));
  const get = (r: string[], col: (typeof columns)[number]) => (r[colIndex.get(col)!] ?? "").trim();
  return { dataRows, get } as const;
}
