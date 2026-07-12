"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

export interface AccountActionState {
  ok: boolean;
  error?: string;
}

/** Link a signed-in participant account to their PAID registration. */
export async function claimRegistration(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const reference = String(formData.get("reference") ?? "").trim().toLowerCase();
  const ic = String(formData.get("ic_passport") ?? "").trim();
  if (!/^[0-9a-f]{8}$/.test(reference)) {
    return { ok: false, error: "Enter the 8-character reference ID from your registration." };
  }
  if (!ic) return { ok: false, error: "Enter the IC / passport used at registration." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_registration", {
    p_ref: reference,
    p_ic: ic,
  });
  if (error) return { ok: false, error: "Could not verify — please try again." };
  if (data !== "OK") return { ok: false, error: String(data) };
  revalidatePath("/account");
  return { ok: true };
}

/** Burn one of the 5 re-record chances. Returns the new count. */
export async function useRecordAttempt(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("increment_record_attempts");
  return typeof data === "number" ? data : 5;
}

/** Register the uploaded recording as the participant's competition entry. */
export async function submitKataVideo(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  const path = String(formData.get("path") ?? "");
  const mime = String(formData.get("mime") ?? "video/webm");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!path.startsWith(`${user.id}/`)) {
    return { ok: false, error: "Invalid recording reference." };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("registration_id, participant_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.registration_id) {
    return { ok: false, error: "Link your paid registration before submitting a recording." };
  }
  const { error } = await supabase.from("kata_videos").insert({
    registration_id: profile.registration_id,
    participant_id: profile.participant_id,
    user_id: user.id,
    storage_path: path,
    mime,
  });
  if (error) {
    return { ok: false, error: "Could not submit — you may already have a submitted recording." };
  }
  await writeAudit(supabase, {
    table_name: "kata_videos",
    record_id: profile.registration_id,
    action: "kata_video_submitted",
    new_value: { storage_path: path },
    actor_id: user.id,
  });
  revalidatePath("/account");
  return { ok: true };
}

/** Referee: save a 0.0–10.0 score for an assigned video. */
export async function submitScore(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const raw = String(formData.get("score") ?? "").trim();
  const score = Math.round(Number(raw) * 10) / 10;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !videoId || Number.isNaN(score) || score < 0 || score > 10) {
    revalidatePath("/account");
    return;
  }
  const { error } = await supabase
    .from("video_scores")
    .upsert(
      { video_id: videoId, referee_user_id: user.id, score },
      { onConflict: "video_id,referee_user_id" },
    );
  if (!error) {
    await writeAudit(supabase, {
      table_name: "video_scores",
      record_id: videoId,
      action: "score_submitted",
      new_value: { score },
      actor_id: user.id,
    });
  }
  revalidatePath("/account");
}
