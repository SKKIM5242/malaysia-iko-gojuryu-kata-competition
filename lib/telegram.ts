import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TelegramCategory = "participant" | "school" | "referee" | "audience" | "staff" | "class";

/** Used only if a known category's row is somehow missing from the DB —
 * every category still gets a sensible label instead of showing raw text. */
const FALLBACK_LABELS: Record<TelegramCategory, string> = {
  participant: "Participants",
  school: "School / Dojo & Sensei / Coach",
  referee: "Judges",
  audience: "Audience / Spectators",
  staff: "Admin / Organizer / Participant Support",
  class: "Dojo Class Students",
};

export interface TelegramGroupRow {
  id: string;
  category: string;
  label: string;
  /** Public invite link (https://t.me/+...) — the only kind that lets
   * someone who isn't a member yet actually join. Always shown as the main
   * "join" link/button. */
  url: string;
  /** Direct link into the group's Announcements topic
   * (https://t.me/c/<chat_id>/<topic_id>) — only opens for people who are
   * already members, so it supplements the invite link rather than
   * replacing it. Null until the organizer sets one for that category. */
  memberUrl: string | null;
  sortOrder: number;
}

/**
 * Each registration category has its own dedicated Telegram group (private
 * invite links) — genuine per-category access, since Telegram fully
 * separates membership between groups (unlike Topics within one group,
 * which everyone in the group can browse regardless of role). Stored in the
 * telegram_groups table (see supabase/migrations/0081_telegram_groups_table.sql,
 * 0082_telegram_groups_member_url.sql) so Admin/Organizer/Staff can add,
 * edit, and delete groups from /admin/telegram without a Vercel env var
 * change + redeploy. Uses the service-role client since this is called
 * from public registration pages (no session) as well as admin pages and
 * background jobs — the data itself isn't sensitive (these are invite
 * links meant to be shared), so bypassing RLS here is safe.
 */
export async function listTelegramGroups(): Promise<TelegramGroupRow[]> {
  const { data } = await createAdminClient()
    .from("telegram_groups")
    .select("id, category, label, url, member_url, sort_order")
    .order("sort_order", { ascending: true });
  return (data ?? []).map((r) => ({
    id: r.id as string,
    category: r.category as string,
    label: r.label as string,
    url: r.url as string,
    memberUrl: (r.member_url as string | null) ?? null,
    sortOrder: r.sort_order as number,
  }));
}

/** The Bot API chat id for a group, derived from its member link.
 *
 * The groups table stores invite links and member links, not chat ids —
 * a `https://t.me/c/<internal id>/<topic>` member link is the only place
 * the id appears. Telegram's Bot API addresses a supergroup as -100
 * followed by that internal id, so the member link is enough to post to
 * the group without the organizer having to find and paste a raw numeric
 * id anywhere. Returns null when a group has no member link set yet
 * (they're optional — see TelegramGroupRow.memberUrl), in which case
 * there's nothing to derive from and the group simply can't be posted to
 * until one is added on /admin/telegram. */
export function telegramGroupChatId(memberUrl: string | null): string | null {
  if (!memberUrl) return null;
  const match = memberUrl.match(/t\.me\/c\/(\d+)/);
  return match ? `-100${match[1]}` : null;
}

/** Whether a specific person has actually joined a specific group, via the
 * Bot API's getChatMember -- distinct from the Bot DM connection
 * (telegram_chat_id on profiles just means "has pressed Start with the
 * bot"; it says nothing about which, if any, group rooms they've joined).
 * Needs the bot to already be a member of that group (see /admin/telegram
 * Step 8) and the person's own chat id (only known once they've connected
 * the bot). Returns null -- not false -- whenever the question can't be
 * answered at all (bot not configured, group has no chat id yet, request
 * failed or timed out): callers should treat that the same as "not joined"
 * for display purposes, but it's kept distinct from a real "not joined" so
 * nothing ever claims someone definitely isn't in a group when the truth is
 * just unknown. A 3s timeout keeps a slow/unreachable Telegram API from
 * ever hanging the page that's asking. */
export async function checkGroupMembership(personChatId: string, groupChatId: string): Promise<boolean | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(groupChatId)}&user_id=${encodeURIComponent(personChatId)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    const data = await res.json();
    if (!data.ok) return null;
    const status = data.result?.status as string | undefined;
    return status === "member" || status === "administrator" || status === "creator";
  } catch {
    return null;
  }
}

/** Checks membership across several groups at once, in parallel -- used
 * for the "every group" view (Admin/Organizer/Staff, Judge). `groups`
 * needing no member link set yet resolve to null automatically, same as
 * any other unanswerable case. Returns a map keyed by category so the
 * caller can look up "am I in the Judges group" without re-deriving chat
 * ids itself. Skips entirely (empty map) when the person hasn't connected
 * the bot yet -- there's no chat id to check membership *as*. */
export async function checkGroupMemberships(
  personChatId: string | null,
  groups: Array<{ category: string; memberUrl: string | null }>,
): Promise<Record<string, boolean | null>> {
  if (!personChatId) return {};
  const entries = await Promise.all(
    groups.map(async (g) => {
      const groupChatId = telegramGroupChatId(g.memberUrl);
      if (!groupChatId) return [g.category, null] as const;
      return [g.category, await checkGroupMembership(personChatId, groupChatId)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Single-group convenience wrapper around checkGroupMembership, for the
 * one-category-per-role sections of /account (Participant, School/Sensei,
 * Audience) -- same null-means-unanswerable contract, extended to also
 * cover "there's no such group configured at all" (group is null). */
export async function checkOneGroupMembership(
  personChatId: string | null,
  group: { category: string; memberUrl: string | null } | null,
): Promise<boolean | null> {
  if (!personChatId || !group) return null;
  const groupChatId = telegramGroupChatId(group.memberUrl);
  if (!groupChatId) return null;
  return checkGroupMembership(personChatId, groupChatId);
}

/** Which group a given account's own people are in, so a compose box can
 * default to the sensible one rather than making staff pick every time.
 * Mirrors the category split the registration flow already uses. */
export function telegramCategoryForRole(role: string | null): TelegramCategory {
  switch (role) {
    case "school":
    case "sensei":
      return "school";
    case "referee":
      return "referee";
    case "audience":
      return "audience";
    case "admin":
    case "organizer":
    case "staff":
    case "customer_support":
      return "staff";
    default:
      return "participant";
  }
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
export async function getAllTelegramLinks(): Promise<Array<{ category: string; label: string; url: string; memberUrl: string | null }>> {
  const groups = await listTelegramGroups();
  return groups.map(({ category, label, url, memberUrl }) => ({ category, label, url, memberUrl }));
}

/** The bot's @username, stored in telegram_bot_settings (a DB singleton,
 * same pattern as certificate_settings) rather than read from a Vercel env
 * var directly -- so Admin/Organizer/Staff can change it from
 * /admin/telegram without a redeploy. TELEGRAM_BOT_TOKEN and
 * TELEGRAM_WEBHOOK_SECRET stay Vercel-only: real secrets that must never
 * reach a page, unlike the username (exactly as visible to anyone who
 * finds the bot on Telegram itself). Uses the service-role client since
 * this is read from the public registration flow and /account, not just
 * admin pages. */
export async function getTelegramBotUsername(): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("telegram_bot_settings")
    .select("bot_username")
    .eq("id", true)
    .maybeSingle();
  return (data?.bot_username as string | null)?.trim() || null;
}

/** Deep link that starts a chat with the assignment-notification bot and
 * links it to this user's account (see app/api/telegram-webhook/route.ts).
 * Takes the bot username as a parameter (fetch once with
 * getTelegramBotUsername() and pass it in) rather than re-reading it per
 * call -- null until the organizer sets one. */
export function getTelegramBotConnectUrl(userId: string, botUsername: string | null): string | null {
  if (!botUsername) return null;
  return `https://t.me/${botUsername}?start=${userId}`;
}

/** Whether the signed-in caller's own Telegram DM connection is live right
 * now -- pressing Start happens entirely inside the Telegram app, outside
 * whatever browser tab is showing the "Connect Telegram" button, so there's
 * no way for that tab to know it happened without asking again. Called by
 * TelegramConnectStatus when the tab regains focus, so the button turns
 * green on its own instead of needing a manual page reload. */
export async function checkMyTelegramConnected(): Promise<boolean> {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("profiles")
    .select("telegram_chat_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return !!(data?.telegram_chat_id as string | null);
}
