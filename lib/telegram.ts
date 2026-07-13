export type TelegramCategory = "participant" | "school" | "sensei" | "referee" | "audience" | "staff" | "general";

/**
 * Telegram community links per registration category. Set TELEGRAM_GROUP_URL
 * (the group invite link) plus optional TELEGRAM_TOPIC_* vars (the numeric
 * message-thread id of each Topic) once the group exists — see
 * docs/TELEGRAM_SETUP.md. Until configured this returns null and callers
 * fall back to the phone/email contact instead of a broken link.
 *
 * Telegram doesn't support hiding topics from members — anyone who joins the
 * group can browse every topic. Referee/Judge and Admin/Organizer/Staff
 * therefore just get the base group link ("full access to all sections");
 * other categories get a direct link to their own topic when configured.
 */
export function getTelegramLink(category: TelegramCategory): string | null {
  const base = process.env.TELEGRAM_GROUP_URL?.trim() || null;
  if (!base) return null;

  const topicId =
    {
      participant: process.env.TELEGRAM_TOPIC_PARTICIPANT,
      school: process.env.TELEGRAM_TOPIC_SCHOOL,
      sensei: process.env.TELEGRAM_TOPIC_SENSEI,
      audience: process.env.TELEGRAM_TOPIC_AUDIENCE,
      referee: undefined, // full group access
      staff: undefined, // full group access
      general: undefined,
    }[category]?.trim();

  return topicId ? `${base.replace(/\/$/, "")}/${topicId}` : base;
}
