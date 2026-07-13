import type { Category } from "@/lib/types";

/**
 * Categories are a hierarchy: Kata event → belt sub-category (Color/Kyu vs
 * Black Belt & Dan) → age sub-sub-category. Names follow
 * "«kata» — «belt label» — Age «lo»–«hi»". The registrant picks only the
 * kata; the correct sub-category is resolved from belt rank + date of birth.
 */

export const AGE_BRACKETS: Array<[number, number]> = [
  [4, 14],
  [15, 40],
  [41, 65],
  [66, 99],
];

export function ageAt(dateOfBirth: string, onDate: string | null | undefined): number {
  const dob = new Date(dateOfBirth + "T00:00:00");
  const ref = onDate ? new Date(onDate + "T00:00:00") : new Date();
  let age = ref.getFullYear() - dob.getFullYear();
  const m = ref.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) age--;
  return age;
}

export function beltGroup(beltRank: string): "dan" | "kyu" {
  return /dan|black/i.test(beltRank) ? "dan" : "kyu";
}

/** The kata event part of a hierarchical category name. */
export function kataBaseOf(categoryName: string): string {
  return categoryName.split(" — ")[0];
}

/** Unique kata event names, in listing (sort_order) order. */
export function kataBases(categories: Category[]): string[] {
  const seen = new Set<string>();
  const bases: string[] = [];
  for (const c of categories) {
    const base = kataBaseOf(c.name);
    if (!seen.has(base)) {
      seen.add(base);
      bases.push(base);
    }
  }
  return bases;
}

/** Groups categories by kata event, preserving each kata's first-seen order. */
export function groupByKata(categories: Category[]): Array<[string, Category[]]> {
  const groups = new Map<string, Category[]>();
  for (const c of categories) {
    const base = kataBaseOf(c.name);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push(c);
  }
  return [...groups.entries()];
}

export function genderCode(gender: string): "male" | "female" {
  return gender.toLowerCase() === "female" ? "female" : "male";
}

/**
 * Resolve the exact sub-category for a registrant. Returns the category or
 * an error message when the age falls outside every bracket. Registrants
 * always resolve into a Male or Female sub-category; Mix (Male & Female)
 * categories are created and populated manually by an admin when a Male or
 * Female category doesn't reach its cap by the registration deadline.
 */
export function resolveCategory(
  categories: Category[],
  kataBase: string,
  dateOfBirth: string,
  beltRank: string,
  gender: string,
  eventDate: string | null | undefined,
): { category?: Category; error?: string } {
  const age = ageAt(dateOfBirth, eventDate);
  const grp = beltGroup(beltRank);
  const genderVal = genderCode(gender);
  const match = categories.find(
    (c) =>
      kataBaseOf(c.name) === kataBase &&
      c.belt_group === grp &&
      c.gender === genderVal &&
      c.age_min != null &&
      c.age_max != null &&
      age >= c.age_min &&
      age <= c.age_max,
  );
  if (!match) {
    return {
      error: `No ${grp === "dan" ? "Black Belt & Dan" : "Color/Kyu Belt"} age category covers age ${age} for this kata.`,
    };
  }
  return { category: match };
}
