"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendVerificationEmail } from "@/lib/notify";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function requireAdminTier(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("role, approved").eq("user_id", user.id).maybeSingle();
  return !!data?.approved && ["admin", "organizer", "staff"].includes(data.role);
}

/** Called right after a successful signUp() — records a pending
 * verification and emails the link. Best-effort: a failure here never
 * blocks the signup itself (the account already exists by the time this
 * runs), same "no-op until RESEND_API_KEY is set" pattern as every other
 * email in this app. */
export async function triggerEmailVerification(userId: string, email: string, role: string): Promise<void> {
  if (!userId || !email) return;
  const admin = createAdminClient();
  const token = crypto.randomUUID().replace(/-/g, "");
  const { error } = await admin.from("email_verifications").insert({ user_id: userId, email, role, token });
  if (error) return;
  await sendVerificationEmail(email, `${appUrl()}/verify-email?token=${token}`);
}

export interface VerifyResult {
  ok: boolean;
  message: string;
}

export async function verifyEmailToken(token: string): Promise<VerifyResult> {
  if (!token) return { ok: false, message: "Missing verification link." };
  const admin = createAdminClient();
  const { data: row } = await admin.from("email_verifications").select("*").eq("token", token).maybeSingle();
  if (!row) return { ok: false, message: "This verification link is invalid or has expired." };
  if (row.verified_at) return { ok: true, message: "Your email is already verified — you can sign in now." };
  const { error } = await admin
    .from("email_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) return { ok: false, message: "Could not verify your email — please try again." };
  return { ok: true, message: "Your email is now verified — you can sign in now." };
}

/** Self-service resend for a signed-in but not-yet-verified user — no admin
 * gate, since by definition they can't do anything else on their own
 * account yet. Operates only on the caller's own session. */
export async function resendMyVerificationEmail(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("email_verifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row || row.verified_at) return;
  await sendVerificationEmail(row.email, `${appUrl()}/verify-email?token=${row.token}`);
  await admin.from("email_verifications").update({ sent_at: new Date().toISOString() }).eq("id", row.id);
}

/** Admin manual override — approve without the link (e.g. their email
 * provider blocked delivery) or resend the original email. */
export async function markEmailVerified(formData: FormData): Promise<void> {
  if (!(await requireAdminTier())) return;
  const id = String(formData.get("id") ?? "");
  const admin = createAdminClient();
  await admin.from("email_verifications").update({ verified_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/email-verifications");
}

export async function resendVerificationEmail(formData: FormData): Promise<void> {
  if (!(await requireAdminTier())) return;
  const id = String(formData.get("id") ?? "");
  const admin = createAdminClient();
  const { data: row } = await admin.from("email_verifications").select("*").eq("id", id).maybeSingle();
  if (!row) return;
  await sendVerificationEmail(row.email, `${appUrl()}/verify-email?token=${row.token}`);
  await admin.from("email_verifications").update({ sent_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/email-verifications");
}
