import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The profiles row is normally created instantly by the handle_new_user()
 * trigger at signup. If it's ever missing for an authenticated user (an RLS
 * mismatch, or a row removed outside the app), self-heal with an
 * admin-client lookup (bypasses RLS) and, failing that, create a bare
 * fallback row — instead of leaving the account stuck on "Setting up your
 * account" forever. Shared by /account and /kata-arena, which both show
 * that message when a signed-in user's profile can't be found.
 */
export async function ensureProfile<T>(user: User): Promise<T | null> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
  if (existing) return existing as T;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metaRole = typeof meta.role === "string" ? meta.role : "";
  const allowedRoles = ["participant", "school", "sensei", "referee", "audience", "staff", "organizer", "admin"];
  const role = allowedRoles.includes(metaRole) ? metaRole : "participant";
  const { data: created } = await admin
    .from("profiles")
    .insert({ user_id: user.id, email: user.email ?? null, role, approved: false })
    .select("*")
    .maybeSingle();
  return (created as T | null) ?? null;
}
