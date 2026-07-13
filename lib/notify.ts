/**
 * Best-effort assignment notifications. Each channel no-ops gracefully until
 * its credentials exist (same pattern as lib/telegram.ts's group links) —
 * safe to call unconditionally from the assignment code paths.
 */

interface AssignmentNotice {
  refereeEmail: string | null;
  refereeName: string | null;
  refereeTelegramChatId: string | null;
  participantName: string;
  categoryName: string | null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function sendAssignmentEmail(notice: AssignmentNotice): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !notice.refereeEmail) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: notice.refereeEmail,
        subject: "New kata recording assigned for you to judge",
        text:
          `Hi ${notice.refereeName ?? "Judge"},\n\n` +
          `You've been assigned a new recording to score: ${notice.participantName} — ${notice.categoryName ?? "Kata"}.\n\n` +
          `Sign in to Kata Arena to watch and submit your score: ${appUrl()}/account\n\n` +
          `— Malaysia Open IKO Goju-ryu Kata Championship`,
      }),
    });
  } catch {
    // Best-effort — the assignment itself already succeeded either way.
  }
}

async function sendAssignmentTelegram(notice: AssignmentNotice): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !notice.refereeTelegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: notice.refereeTelegramChatId,
        text:
          `🥋 New kata recording assigned for you to judge: ${notice.participantName} — ${notice.categoryName ?? "Kata"}.\n` +
          `Sign in to Kata Arena to watch and score it: ${appUrl()}/account`,
      }),
    });
  } catch {
    // Best-effort
  }
}

export async function notifyRefereeAssignment(notice: AssignmentNotice): Promise<void> {
  await Promise.allSettled([sendAssignmentEmail(notice), sendAssignmentTelegram(notice)]);
}
