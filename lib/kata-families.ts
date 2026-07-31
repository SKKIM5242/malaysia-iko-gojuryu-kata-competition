import type { Category } from "@/lib/types";
import { kataBaseOf, groupByKata } from "@/lib/division";

/** The organizer's own grouping of the 24 kata events, independent of the
 * belt/age/gender sub-categorisation each one is further split into. Order
 * here is the display order within each family. */
export const KATA_FAMILIES = ["Elementary", "Intermediate", "Advanced", "Kobudo"] as const;
export type KataFamily = (typeof KATA_FAMILIES)[number];

/** Maps each kata event's exact name (as stored in categories.name, before
 * the first " — ") to its family. Keep in sync with the family lists the
 * organizer gave verbatim -- do not reorder without also checking
 * FAMILY_ORDER_WITHIN below, which drives display order. */
const FAMILY_BY_KATA: Record<string, KataFamily> = {
  "Kata Taikyoku Jodan": "Elementary",
  "Kata Taikyoku Chudan": "Elementary",
  "Kata Taikyoku Gedan": "Elementary",
  "Kata Taikyoku Tora Guchi": "Elementary",
  "Kata Taikyoku Kake Uke": "Elementary",

  "Kata Geksai Dai Ichi": "Intermediate",
  "Kata Geksai Dai Ni": "Intermediate",
  "Kata Geiksai Dai Ichi - IKO V2": "Intermediate",
  "Kata Geiksai Dai Ni - IKO V2": "Intermediate",
  "Kata Sanchi - (forward & backward version)": "Intermediate",
  "Kata Tensho": "Intermediate",

  "Kata Sanseru": "Advanced",
  "Kata Seiyunchin": "Advanced",
  "Kata Saifa": "Advanced",
  "Kata Shisochin": "Advanced",
  "Kata Sepai": "Advanced",
  "Kata Kururunfa": "Advanced",
  "Kata Suparinpei": "Advanced",

  "Kata Sai - Open Version - Subject to Weapons rules & regulations": "Kobudo",
  "Kata Nunchaku - Open Version - Subject to Weapons rules & regulations": "Kobudo",
  "Kata Bo - Open Version - Subject to Weapons rules & regulations": "Kobudo",
  "Kata Tonfa - Open Version - Subject to Weapons rules & regulations": "Kobudo",
  "Kata of Weapons other than Sai, Nunchaku, Bo, Tonfa - Open Version - Subject to rules & regulations": "Kobudo",
};

/** Which family a kata event belongs to, tolerant of the small naming
 * drift that exists between tiers for one kata -- "Kata Sesan or Seisan
 * (The Cat or IOGKF Version)" is stored with a trailing space on the USD
 * 100 tier and as "...(The Cat Version)" (missing "or IOGKF") on the USD
 * 200 tier, so an exact lookup alone would miss two of the three tiers'
 * copies of the same kata. */
export function kataFamilyOf(kataBaseName: string): KataFamily | null {
  const normalized = kataBaseName.trim();
  if (FAMILY_BY_KATA[normalized]) return FAMILY_BY_KATA[normalized];
  if (/sesan|seisan/i.test(normalized)) return "Advanced";
  return null;
}

/**
 * Groups an already kata-grouped category list (see groupByKata) one level
 * further, into the 4 families, in Elementary → Intermediate → Advanced →
 * Kobudo order. A kata whose name doesn't match any known family (should
 * only happen for genuinely new/renamed kata not yet added to
 * FAMILY_BY_KATA above) is dropped into its own "Other" bucket at the end
 * rather than silently disappearing.
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
  return [...buckets.entries()].filter(([, entries]) => entries.length > 0);
}

/** All categories (any belt/age/gender) whose kata falls in the given
 * family, for a single competition -- the input a family-wide merge acts
 * on. */
export function categoriesInFamily(categories: Category[], family: KataFamily): Category[] {
  return categories.filter((c) => kataFamilyOf(kataBaseOf(c.name)) === family);
}
