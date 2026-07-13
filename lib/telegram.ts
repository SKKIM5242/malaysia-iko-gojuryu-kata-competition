export type TelegramCategory = "participant" | "school" | "referee" | "audience" | "staff";

const LABELS: Record<TelegramCategory, string> = {
  participant: "Participants",
  school: "School / Dojo & Sensei / Coach",
  referee: "Referees / Judges",
  audience: "Audience / Spectators",
  staff: "Admin / Organizer / Customer Support",
};

/**
 * Each registration category has its own dedicated Telegram group (private
 * invite links) — genuine per-category access, since Telegram fully
 * separates membership between groups (unlike Topics within one group,
 * which everyone in the group can browse regardless of role).
 */
export function getTelegramLink(category: TelegramCategory): string | null {
  const envName = `TELEGRAM_GROUP_${category.toUpperCase()}`;
  return process.env[envName]?.trim() || null;
}

export function getTelegramLabel(category: TelegramCategory): string {
  return LABELS[category];
}

/** Approved Referee/Judge and Admin/Organizer/Staff get every group — they
 * moderate or judge across the whole competition, not just one category. */
export function getAllTelegramLinks(): Array<{ category: TelegramCategory; label: string; url: string }> {
  return (Object.keys(LABELS) as TelegramCategory[])
    .map((category) => ({ category, label: LABELS[category], url: getTelegramLink(category) }))
    .filter((x): x is { category: TelegramCategory; label: string; url: string } => !!x.url);
}
