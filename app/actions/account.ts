"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

/** One-click version of claimRegistration for a registration already known
 * (server-side, via email match) to belong to this account — used by the
 * "Start Recording" button on a pending-recordings list, so the participant
 * never has to retype their reference ID + IC to switch which registration
 * is currently linked for recording. */
export async function claimAndStartRecording(formData: FormData) {
  const registrationId = String(formData.get("registration_id") ?? "");
  if (registrationId) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("claim_registration_by_id", {
      p_registration_id: registrationId,
    });
    if (data !== "OK") {
      redirect(`/account?claim_error=${encodeURIComponent(String(data ?? "Could not claim that registration."))}`);
    }
  }
  revalidatePath("/account");
  redirect("/account");
}

export interface DeleteVideoState {
  ok: boolean;
  error?: string;
  attemptsUsed?: number;
}

/** Deletes the participant's own submitted recording so they can re-record
 * — capped at 3 total chances shared with the pre-submission "delete &
 * re-record" flow, and blocked once a referee has already scored it. */
export async function deleteSubmittedVideo(
  _prev: DeleteVideoState,
  formData: FormData,
): Promise<DeleteVideoState> {
  const registrationId = String(formData.get("registration_id") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("registration_id, record_attempts")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile || profile.registration_id !== registrationId) {
    return { ok: false, error: "This recording isn't linked to your account." };
  }
  if ((profile.record_attempts ?? 0) >= 3) {
    return { ok: false, error: "No delete attempts left — 3 of 3 used.", attemptsUsed: 3 };
  }

  const { data: video } = await supabase
    .from("kata_videos")
    .select("id, storage_path")
    .eq("registration_id", registrationId)
    .maybeSingle();
  if (!video) return { ok: false, error: "No recording found to delete." };

  const { data: consumed } = await supabase.rpc("consume_delete_attempt");
  if (!consumed) {
    return { ok: false, error: "No delete attempts left — 3 of 3 used.", attemptsUsed: 3 };
  }

  const { error: delErr } = await supabase.from("kata_videos").delete().eq("id", video.id);
  if (delErr) {
    return {
      ok: false,
      error: "Could not delete — a referee may have already scored this recording.",
    };
  }
  await supabase.storage.from("kata-videos").remove([video.storage_path]);

  await writeAudit(supabase, {
    table_name: "kata_videos",
    record_id: video.id,
    action: "kata_video_deleted_by_participant",
    actor_id: user.id,
  });

  revalidatePath("/account");
  revalidatePath("/kata-arena");

  const { data: updated } = await supabase
    .from("profiles")
    .select("record_attempts")
    .eq("user_id", user.id)
    .maybeSingle();
  return { ok: true, attemptsUsed: updated?.record_attempts ?? 3 };
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

/** Referee: save a 0.0–11.0 score for an assigned video — the sum of the
 * official rubric's 7 criteria (1+1+1+1+1+3+3 = 11 max). */
export async function submitScore(formData: FormData) {
  const videoId = String(formData.get("video_id") ?? "");
  const raw = String(formData.get("score") ?? "").trim();
  const score = Math.round(Number(raw) * 10) / 10;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !videoId || Number.isNaN(score) || score < 0 || score > 11) {
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
