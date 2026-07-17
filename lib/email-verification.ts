import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every new account (post this feature) gets an email_verifications row the
 * moment it's created. A user with NO row at all predates this feature (or
 * the best-effort send silently failed) — treated as verified so existing
 * accounts are never retroactively locked out. Only an account that HAS a
 * row, still unverified, is blocked.
 */
export async function isEmailVerified(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("email_verifications")
    .select("verified_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return true;
  return data.verified_at != null;
}
