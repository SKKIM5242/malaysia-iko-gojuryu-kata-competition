/** Canonical IBAN/account-number storage format: uppercase alphanumeric
 * only, no dashes or spaces, max 34 characters (the ISO 13616 IBAN limit --
 * also used loosely here for SWIFT/BIC/BBAN/ACH numbers from non-Malaysian
 * banks, none of which exceed it either). Applied server-side on every
 * write so the stored value is clean no matter what the client sent. */
export function normalizeIban(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 34);
}

/** Groups a normalized IBAN into 4-character blocks for display/typing,
 * e.g. "MY29MBBE1234567890" -> "MY29 MBBE 1234 5678 90". */
export function formatIbanForDisplay(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})/g, "$1 ").trim();
}

/** Shared plain-text note appended to CSV upload help text (the `note`
 * prop on CsvUploadForm takes a plain string, not JSX). */
export const IBAN_CSV_NOTE =
  "Note: for participants outside Malaysia, provide their IBAN, SWIFT code, BIC, BBAN, or ACH " +
  "number in the bank_account_no column. If unsure, call the bank to check — this ensures smooth " +
  "processing with no delay in receiving any reward or commission.";
