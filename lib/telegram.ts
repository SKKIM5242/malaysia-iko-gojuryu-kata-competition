import { createAdminClient } from "@/lib/supabase/admin";

export type TelegramCategory = "participant" | "school" | "referee" | "audience" | "staff" | "class";

/** Used only if a known category's row is somehow missing from the DB —
 * every category still gets a sensible label instead of showing raw text. */
const FALLBACK_LABELS: Record<TelegramCategory, string> = {
  participant: "Participants",
  school: "School / Dojo & Sensei / Coach",
  referee: "Referees / Judges",
  audience: "Audience / Spectators",
  staff: "Admin / Organizer / Participant Support",
  class: "Dojo Class Students",
};

export interface TelegramGroupRow {
  id: string;
  category: string;
  label: string;
  url: string;
  sortOrder: number;
}

/**
 * Each registration category has its own dedicated Telegram group (private
 * invite links) — genuine per-category access, since Telegram fully
 * separates membership between groups (unlike Topics within one group,
 * which everyone in the group can browse regardless of role). Stored in the
 * telegram_groups table (see supabase/migrations/0081_telegram_groups_table.sql)
 * so Admin/Organizer/Staff can add, edit, and delete groups from
 * /admin/telegram without a Vercel env var change + redeploy. Uses the
 * service-role client since this is called from public registration pages
 * (no session) as well as admin pages and background jobs — the data
 * itself isn't sensitive (these are invite links meant to be shared), so
 * bypassing RLS here is safe.
 */
export async function listTelegramGroups(): Promise<TelegramGroupRow[]> {
  const { data } = await createAdminClient()
    .from("telegram_groups")
    .select("id, category, label, url, sort_order")
    .order("sort_order", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    category: r.category as string,
    label: r.label as string,
    url: r.url as string,
    sortOrder: r.sort_order as number,
  }));
}

export async function getTelegramLink(category: string): Promise<string | null> {
  const groups = await listTelegramGroups();
  return groups.find((g) => g.category === category)?.url ?? null;
}

export async function getTelegramLabel(category: string): Promise<string> {
  const groups = await listTelegramGroups();
  return groups.find((g) => g.category === category)?.label ?? FALLBACK_LABELS[category as TelegramCategory] ?? category;
}

/** Approved Referee/Judge and Admin/Organizer/Staff get every group — they
 * moderate or judge across the whole competition, not just one category. */
export async function getAllTelegramLinks(): Promise<Array<{ category: string; label: string; url: string }>> {
  const groups = await listTelegramGroups();
  return groups.map(({ category, label, url }) => ({ category, label, url }));
}

/** Deep link that starts a chat with the assignment-notification bot and
 * links it to this user's account (see app/api/telegram-webhook/route.ts).
 * Returns null until the organizer sets TELEGRAM_BOT_USERNAME. */
export function getTelegramBotConnectUrl(userId: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim();
  if (!username) return null;
  return `https://t.me/${username}?start=${userId}`;
}
