"use server";

import { createClient } from "@/lib/supabase/server";

/** Whether the signed-in caller's own Telegram DM connection is live right
 * now -- pressing Start happens entirely inside the Telegram app, outside
 * whatever browser tab is showing the "Connect Telegram" button, so there's
 * no way for that tab to know it happened without asking again. Called by
 * TelegramConnectStatus when the tab regains focus, so the button turns
 * green on its own instead of needing a manual page reload.
 *
 * Deliberately its own file, not folded into lib/telegram.ts alongside that
 * file's many other server-only exports: a Client Component importing even
 * one function from a file pulls the whole module into the browser bundle
 * unless the file is *entirely* "use server", and lib/telegram.ts transitively
 * imports next/headers (via lib/supabase/server), which cannot ship to the
 * browser at all -- confirmed the hard way, this exact mistake broke the
 * build once already. */
export async function checkMyTelegramConnected(): Promise<boolean> {
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
