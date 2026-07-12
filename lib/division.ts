/**
 * Competition divisions are derived, not picked: each kata event is split by
 * age group (at event date), belt group (Kyu/colour vs Dan), and gender.
 */

const AGE_GROUPS: Array<[number, number]> = [
  [4, 12],
  [13, 21],
  [22, 40],
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

export function beltGroup(beltRank: string): "Dan" | "Kyu" {
  return /dan/i.test(beltRank) ? "Dan" : "Kyu";
}

export function computeDivision(
  dateOfBirth: string,
  beltRank: string,
  gender: string,
  eventDate: string | null | undefined,
): string {
  const age = ageAt(dateOfBirth, eventDate);
  const group = AGE_GROUPS.find(([min, max]) => age >= min && age <= max);
  const ageLabel = group ? `Age ${group[0]}–${group[1]}` : `Age ${age}`;
  const g = gender.toLowerCase() === "female" ? "Female" : "Male";
  return `${ageLabel} · ${beltGroup(beltRank)} · ${g}`;
}
