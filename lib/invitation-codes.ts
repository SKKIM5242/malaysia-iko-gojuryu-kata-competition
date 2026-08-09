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
 * becomes "USD 100 Tier" — used in every tier dropdown and tier table
 * column so neither repeats the full event name three times over. */
export function shortTierName(competitionName: string): string {
  const m = competitionName.match(/USD\s*(\d+)/i);
  return m ? `USD ${m[1]} Tier` : competitionName;
}

/** Everything except the running number. Multiple tiers (a code covering a
 * combination) join their tokens with "-", e.g. IKO-SCHOOL-TIER-USD10-USD100-2026-.
 * An empty list (no tier picked — e.g. a personal code generated with
 * Competition Tier left blank) drops the "TIER-" segment entirely rather
 * than leaving a dangling separator, e.g. IKO-SCHOOL-2026-. */
export function codePrefix(role: string, feesUsd: number[]): string {
  const roleToken = CODE_ROLE_TOKEN[role] ?? role.toUpperCase();
  if (feesUsd.length === 0) return `IKO-${roleToken}-2026-`;
  const tierTokens = feesUsd.map(tierToken).join("-");
  return `IKO-${roleToken}-TIER-${tierTokens}-2026-`;
}

export interface TierCombo {
  /** Cheapest-first, matching how the label and code prefix order tiers. */
  competitionIds: string[];
  label: string;
}

/** Every contiguous range of tiers, sorted by fee ascending — for 3 tiers
 * (10/100/200) this yields exactly the 6 combinations the organiser asked
 * for: {10}, {10,100}, {10,100,200}, {100}, {100,200}, {200}. Deliberately
 * excludes non-contiguous combinations like {10,200} skipping the middle
 * tier, since a code is meant to cover a single continuous range of access,
 * not an arbitrary pick-list. Scales automatically if a tier is added or
 * removed. */
export function tierCombinations(
  competitions: Array<{ id: string; name: string; registration_fee_usd: number | null }>,
): TierCombo[] {
  const sorted = [...competitions].sort(
    (a, b) => (a.registration_fee_usd ?? 0) - (b.registration_fee_usd ?? 0),
  );
  const combos: TierCombo[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i; j < sorted.length; j++) {
      const slice = sorted.slice(i, j + 1);
      combos.push({
        competitionIds: slice.map((c) => c.id),
        label: slice.map((c) => shortTierName(c.name)).join(" + "),
      });
    }
  }
  return combos;
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
