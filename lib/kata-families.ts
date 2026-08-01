import type { Category } from "@/lib/types";
import { kataBaseOf, groupByKata } from "@/lib/division";

/** The organizer's own grouping of the 24 kata events, independent of the
 * belt/age/gender sub-categorisation each one is further split into.
 *
 * Revised from an earlier 4-family version (Elementary/Intermediate/
 * Advanced/Kobudo) to this 5-family one: Advanced Kata's 8 kata split into
 * "Advance" (the 4 kihon/older-style kata) and a new "Mastery" family (the
 * 4 hardest/last-learned kata: Sesan/Seisan, Sepai, Kururunfa, Suparinpei).
 * "Advance" (not "Advanced") matches the organizer's own heading wording. */
export const KATA_FAMILIES = ["Elementary", "Intermediate", "Advance", "Mastery", "Kobudo"] as const;
export type KataFamily = (typeof KATA_FAMILIES)[number];

/** The organizer's exact numbered order (1-24), authoritative both for
 * which family a kata belongs to and for its position within that family.
 * The 3 tiers' categories.sort_order values were normalized to match this
 * order directly in the database (see the 2026-08-01 renumber) -- this
 * array is kept in sync as the source of truth for that ordering, and as
 * the lookup FAMILY_BY_KATA/KATA_RANK below are both derived from. */
const CANONICAL_KATA_ORDER: Array<{ name: string; family: KataFamily }> = [
  { name: "Kata Taikyoku Jodan", family: "Elementary" },
  { name: "Kata Taikyoku Chudan", family: "Elementary" },
  { name: "Kata Taikyoku Gedan", family: "Elementary" },
  { name: "Kata Taikyoku Tora Guchi", family: "Elementary" },
  { name: "Kata Taikyoku Kake Uke", family: "Elementary" },

  { name: "Kata Geksai Dai Ichi", family: "Intermediate" },
  { name: "Kata Geksai Dai Ni", family: "Intermediate" },
  { name: "Kata Geiksai Dai Ichi - IKO V2", family: "Intermediate" },
  { name: "Kata Geiksai Dai Ni - IKO V2", family: "Intermediate" },
  { name: "Kata Sanchi - (forward & backward version)", family: "Intermediate" },
  { name: "Kata Tensho", family: "Intermediate" },

  { name: "Kata Sanseru", family: "Advance" },
  { name: "Kata Seiyunchin", family: "Advance" },
  { name: "Kata Saifa", family: "Advance" },
  { name: "Kata Shisochin", family: "Advance" },

  { name: "Kata Sesan or Seisan (The Cat version & IOGKF version only)", family: "Mastery" },
  { name: "Kata Sepai", family: "Mastery" },
  { name: "Kata Kururunfa", family: "Mastery" },
  { name: "Kata Suparinpei", family: "Mastery" },

  { name: "Kata Sai - Open Version - Subject to Weapons rules & regulations", family: "Kobudo" },
  { name: "Kata Nunchaku - Open Version - Subject to Weapons rules & regulations", family: "Kobudo" },
  { name: "Kata Bo - Open Version - Subject to Weapons rules & regulations", family: "Kobudo" },
  { name: "Kata Tonfa - Open Version - Subject to Weapons rules & regulations", family: "Kobudo" },
  { name: "Kata of Weapons other than Sai, Nunchaku, Bo, Tonfa - Open Version - Subject to rules & regulations", family: "Kobudo" },
];

const FAMILY_BY_KATA: Record<string, KataFamily> = Object.fromEntries(
  CANONICAL_KATA_ORDER.map((k) => [k.name, k.family]),
);
const RANK_BY_KATA: Record<string, number> = Object.fromEntries(
  CANONICAL_KATA_ORDER.map((k, i) => [k.name, i]),
);

/** Which family a kata event belongs to. Exact-match only — as of the
 * 2026-08-01 name normalization, all 3 tiers store the Sesan/Seisan kata
 * under the one canonical spelling above, so the earlier fuzzy /sesan|
 * seisan/i fallback is no longer needed. */
export function kataFamilyOf(kataBaseName: string): KataFamily | null {
  return FAMILY_BY_KATA[kataBaseName.trim()] ?? null;
}

/**
 * Groups an already kata-grouped category list (see groupByKata) one level
 * further, into the 5 families, in Elementary → Intermediate → Advance →
 * Mastery → Kobudo order — and, within each family, in the organizer's
 * exact numbered order (not whatever order groupByKata happened to return,
 * which follows categories.sort_order — kept in sync with this canonical
 * order by the database, but this guards display even if that ever drifts).
 * A kata whose name doesn't match any known family (should only happen for
 * a genuinely new/renamed kata not yet added to CANONICAL_KATA_ORDER above)
 * is dropped into its own "Other" bucket at the end rather than silently
 * disappearing.
 */
export function groupByFamily(
  categories: Category[],
): Array<[KataFamily | "Other", Array<[string, Category[]]>]> {
  const byKata = groupByKata(categories);
  const buckets = new Map<KataFamily | "Other", Array<[string, Category[]]>>();
  for (const family of KATA_FAMILIES) buckets.set(family, []);
  for (const entry of byKata) {
    const [base] = entry;
    const family = kataFamilyOf(base) ?? "Other";
    if (!buckets.has(family)) buckets.set(family, []);
    buckets.get(family)!.push(entry);
  }
  for (const entries of buckets.values()) {
    entries.sort(([a], [b]) => (RANK_BY_KATA[a] ?? 999) - (RANK_BY_KATA[b] ?? 999));
  }
  return [...buckets.entries()].filter(([, entries]) => entries.length > 0);
}

/** All categories (any belt/age/gender) whose kata falls in the given
 * family, for a single competition -- the input a family-wide merge acts
 * on. */
export function categoriesInFamily(categories: Category[], family: KataFamily): Category[] {
  return categories.filter((c) => kataFamilyOf(kataBaseOf(c.name)) === family);
}

/** The kata event immediately above/below the given one in the canonical
 * 1-24 order -- the pairing "merge with kata above/below" acts on. Returns
 * null at either end of the list, and also null across a family boundary
 * (e.g. Kata Tensho, #11 Intermediate, has no "below" partner here even
 * though #12 Kata Sanseru exists) -- kept deliberately family-scoped so
 * this merge can never blur the family taxonomy the other merges rely on.
 * Also null for a name that isn't one of the 24 canonical kata (e.g. an
 * already-merged/combined category), so the button naturally disappears
 * once a kata has been merged away. */
export function adjacentKataOf(kataBaseName: string, direction: "above" | "below"): string | null {
  const rank = RANK_BY_KATA[kataBaseName.trim()];
  if (rank == null) return null;
  const neighborRank = direction === "above" ? rank - 1 : rank + 1;
  const neighbor = CANONICAL_KATA_ORDER[neighborRank];
  if (!neighbor) return null;
  if (neighbor.family !== CANONICAL_KATA_ORDER[rank].family) return null;
  return neighbor.name;
}
