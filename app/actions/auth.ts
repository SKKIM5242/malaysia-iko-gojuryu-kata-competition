"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function signIn(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "Invalid email or password." };
  }
  redirect("/admin");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export interface ForgotPasswordState {
  ok?: boolean;
  message?: string;
}

/**
 * Verifies identity via IC/Passport or mobile phone (not just email, since
 * that's what participants and referees actually register with), then lets
 * Supabase's own resetPasswordForEmail send the reset link. Always returns
 * the same generic message regardless of whether a match was found, so the
 * form can't be used to check whether a given IC/phone is registered.
 */
export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const generic: ForgotPasswordState = {
    ok: true,
    message:
      "If that IC/Passport or phone number matches a registered account, a password reset link has been emailed to the address on file.",
  };
  if (!identifier) {
    return { ok: false, message: "Enter your IC/Passport number or mobile phone number." };
  }

  const supabase = await createClient();
  const { data: email } = await supabase.rpc("find_email_for_identity", { p_identifier: identifier });
  if (typeof email === "string" && email) {
    const origin =
      (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/account/reset-password`,
    });
  }
  return generic;
}
