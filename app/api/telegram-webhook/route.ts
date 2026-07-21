import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface TelegramUpdate {
  message?: {
    chat: { id: number; title?: string; type?: string };
    text?: string;
  };
}

/**
 * Links a referee's Telegram chat so we can DM them assignment notices.
 * They reach this via the "Connect Telegram" deep link on /account, which
 * encodes their own (already-authenticated) user_id as the /start payload —
 * so the only thing a forged payload could do is misdirect a notification,
 * never grant access to any video or score data (that's still gated by the
 * normal Supabase session, not by telegram_chat_id).
 */
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "invalid secret" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const text = update.message?.text?.trim() ?? "";
  const chatId = update.message?.chat.id;
  // Group/supergroup messages log their chat id + title — the quickest way
  // to find a TELEGRAM_CHAT_ID_<CATEGORY> value: send any command-style
  // message (e.g. "/hello") in the group once, then read this line back
  // from Vercel's function logs for that group's title.
  const chatType = update.message?.chat.type;
  if (chatType === "group" || chatType === "supergroup") {
    console.log(`[telegram-webhook] group message — chat_id=${chatId} title="${update.message?.chat.title}"`);
  }
  const match = /^\/start\s+([0-9a-f-]{36})$/i.exec(text);
  if (match && chatId) {
    const userId = match[1];
    const supabase = createAdminClient();
    await supabase.from("profiles").update({ telegram_chat_id: String(chatId) }).eq("user_id", userId);

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "✅ Telegram connected — you'll get a message here whenever the organizer assigns you a new kata recording to judge.",
          }),
        });
      } catch {
        // Best-effort confirmation only.
      }
    }
  }

  return NextResponse.json({ ok: true });
}
