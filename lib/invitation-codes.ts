/**
 * Systematic invitation-code format: IKO-<ROLE>-TIER-<TIER>-2026-<NNNNN>
 * e.g. IKO-REFEREE-TIER-USD100-2026-00001. The running number is scoped to
 * one role+tier combination (its own counter, not a single shared one) and
 * is computed on demand from the highest existing number for that exact
 * prefix — never written to the database until the code itself is actually
 * created, so a number shown by "Run" but never submitted is automatically
 * available again next time, with no separate reservation/release
 * bookkeeping needed.
 */

export const CODE_ROLE_TOKEN: Record<string, string> = {
  participant: "PARTICIPANT",
  school: "SCHOOL",
  sensei: "SENSEI",
  referee: "REFEREE",
  audience: "AUDIENCE",
  customer_support: "SUPPORT",
  organizer: "ORGANIZER",
  admin: "ADMIN",
  staff: "STAFF",
  any: "ANY",
};

export function tierToken(feeUsd: number): string {
  return `USD${Math.round(feeUsd)}`;
}

/** Shortens a competition's full event name down to just its tier — e.g.
 * "Malaysia Open Virtual Karate-do Kata Competition 2026 — USD 100 Tier"
 * becomes "Tier USD100" — used in every tier dropdown so options don't
 * repeat the full event name three times over. */
export function shortTierName(competitionName: string): string {
  const m = competitionName.match(/USD\s*(\d+)/i);
  return m ? `Tier USD${m[1]}` : competitionName;
}

/** Everything except the running number. */
export function codePrefix(role: string, feeUsd: number): string {
  const roleToken = CODE_ROLE_TOKEN[role] ?? role.toUpperCase();
  return `IKO-${roleToken}-TIER-${tierToken(feeUsd)}-2026-`;
}

const SEQUENCE_DIGITS = 5;

/** Given every existing code sharing this exact prefix, returns the next
 * running number, zero-padded. */
export function nextSequentialCode(prefix: string, existingCodes: string[]): string {
  let max = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const n = Number(code.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(SEQUENCE_DIGITS, "0")}`;
}
