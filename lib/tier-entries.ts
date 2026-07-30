import { shortTierName } from "@/lib/invitation-codes";

/** Schools/Senseis need MORE than this many paid entries to qualify for a
 * revenue share. Mirrors SCHOOL_SENSEI_THRESHOLD in lib/commissions.ts —
 * kept in step so the admin table's ✓/✗ marker never disagrees with the
 * Commissions page. */
export const COMMISSION_ENTRY_THRESHOLD = 10;

/** Renders a school's/sensei's paid entries per competition tier for the
 * admin table, e.g. "USD 10 Tier: 14 ✓ · USD 100 Tier: 3". The ✓ marks a
 * tier that on its own clears the >10 threshold.
 *
 * Counts ENTRIES (paid registrations = kata events), not participants,
 * because that is the unit the commission rule is written in. */
export function tierEntriesLabel(
  perTier: Map<string, number> | undefined,
  competitions: Array<{ id: string; name: string }>,
): string {
  if (!perTier || perTier.size === 0) return "— none yet";
  const parts: string[] = [];
  for (const c of competitions) {
    const n = perTier.get(c.id);
    if (!n) continue;
    parts.push(`${shortTierName(c.name)}: ${n}${n > COMMISSION_ENTRY_THRESHOLD ? " ✓" : ""}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "— none yet";
}
