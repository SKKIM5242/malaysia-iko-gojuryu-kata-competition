/** Field delimiter for every CSV this app generates (downloadable templates
 * and admin "Download CSV" exports) — a pipe, not a comma, since addresses
 * and other free-text fields routinely contain commas, which would
 * otherwise silently shift every column after them. */
export const CSV_DELIMITER = "|";

/** A file someone uploads won't necessarily still use "|": opening our
 * pipe-delimited template in Excel and re-saving via "Save As → CSV"
 * always rejoins it with a comma, no matter what delimiter the template
 * started with — that's just how Excel's CSV export works, and there's no
 * ordinary way for a sensei to change it. Detect per-file instead of
 * assuming: our own templates/exports always have a pipe somewhere in the
 * header row, so its absence is a reliable signal to fall back to comma. */
function detectDelimiter(headerLine: string): string {
  return headerLine.includes(CSV_DELIMITER) ? CSV_DELIMITER : ",";
}

/** Minimal RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF,
 * auto-detected delimiter (see detectDelimiter above). */
export function parseCsv(text: string): string[][] {
  // Strip a leading UTF-8 BOM — present on our own CSV exports and on most
  // Excel-saved CSVs — so it doesn't get glued onto the first header name.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLineEnd = text.search(/\r\n|\r|\n/);
  const headerLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delimiter = detectDelimiter(headerLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}
