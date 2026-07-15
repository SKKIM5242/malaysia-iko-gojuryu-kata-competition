import { parseCsv } from "@/lib/csv";

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
