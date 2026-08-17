"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";

const VERCEL_PROJECT_ID = "prj_1AnH39VskzQeHMDD24kIusvbjx0y";
const VERCEL_TEAM_ID = "team_NMNDuLVdLkGSqwoYkjOErQr8";

/** The only two env vars these actions are allowed to touch -- a strict
 * allowlist, not a free-form key read from the submitted form, since a
 * mistake here could silently overwrite an unrelated project secret (e.g.
 * SUPABASE_SERVICE_ROLE_KEY) with whatever a form happened to submit. */
const EDITABLE_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"] as const;
type EditableKey = (typeof EDITABLE_KEYS)[number];

function backTo(path: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${q ? `${separator}${q}` : ""}`);
}

async function requireEditor(returnTo: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) backTo(returnTo, { error: "Sign in required." });
  const { data } = await supabase
    .from("profiles")
    .select("role, approved")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data?.approved || !["admin", "organizer", "staff"].includes(data.role ?? "")) {
    backTo(returnTo, { error: "Only Admin / Organizer can update this." });
  }
  return { supabase, actorId: user.id };
}

/** Which Vercel "target" this exact running deployment belongs to, so
 * editing from the production site updates production's own copy of the
 * secret and editing from staging updates staging's -- without the admin
 * having to pick an environment by hand and risk picking the wrong one. */
function currentTarget(): "production" | "preview" {
  return process.env.VERCEL_ENV === "production" ? "production" : "preview";
}

interface VercelEnvVar {
  id: string;
  key: string;
  target: string[];
}

async function vercelFetch(path: string, init?: RequestInit) {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error("VERCEL_API_TOKEN is not configured on this deployment.");
  const url = `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${VERCEL_TEAM_ID}`;
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** Deletes every existing entry for `key` scoped to `target`. Vercel can
 * hold more than one entry per key (e.g. one scoped to a specific git
 * branch, one scoped to the environment generally, as this project's own
 * SEND_EMAIL_HOOK_SECRET has had) -- all of them need to go, or a stale one
 * could still win depending on how a future deployment resolves scope. */
async function deleteExisting(key: EditableKey, target: "production" | "preview") {
  const listRes = await vercelFetch(`/v9/projects/${VERCEL_PROJECT_ID}/env`);
  if (!listRes.ok) throw new Error(`Could not list existing env vars (${listRes.status}).`);
  const { envs } = (await listRes.json()) as { envs: VercelEnvVar[] };
  for (const match of envs.filter((e) => e.key === key && e.target.includes(target))) {
    const delRes = await vercelFetch(`/v9/projects/${VERCEL_PROJECT_ID}/env/${match.id}`, { method: "DELETE" });
    if (!delRes.ok) throw new Error(`Could not remove the existing ${key} (${delRes.status}).`);
  }
}

export async function updateTelegramSecret(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/telegram";
  const { supabase, actorId } = await requireEditor(returnTo);
  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  if (!EDITABLE_KEYS.includes(key as EditableKey)) backTo(returnTo, { error: "Unrecognized field." });
  if (!value) backTo(returnTo, { error: "Enter a value, or use Delete to clear it." });

  const target = currentTarget();
  try {
    await deleteExisting(key as EditableKey, target);
    const createRes = await vercelFetch(`/v10/projects/${VERCEL_PROJECT_ID}/env`, {
      method: "POST",
      body: JSON.stringify({ key, value, type: "sensitive", target: [target] }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Could not save ${key} (${createRes.status}): ${body.slice(0, 300)}`);
    }
  } catch (err) {
    backTo(returnTo, { error: err instanceof Error ? err.message : "Could not update Vercel." });
  }

  // Never log the secret's actual value -- audit_logs is a regular table,
  // readable by every admin, and would otherwise turn "who changed this and
  // when" into a second place the secret itself leaks to.
  await writeAudit(supabase, {
    table_name: "vercel_env",
    record_id: null,
    action: "telegram_secret_updated",
    new_value: { key, target, length: value.length },
    actor_id: actorId,
  });
  backTo(returnTo, { ok: `${key} saved for ${target}. Takes effect after the next deployment.` });
}

export async function clearTelegramSecret(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/telegram";
  const { supabase, actorId } = await requireEditor(returnTo);
  const key = String(formData.get("key") ?? "");
  if (!EDITABLE_KEYS.includes(key as EditableKey)) backTo(returnTo, { error: "Unrecognized field." });

  const target = currentTarget();
  try {
    await deleteExisting(key as EditableKey, target);
  } catch (err) {
    backTo(returnTo, { error: err instanceof Error ? err.message : "Could not update Vercel." });
  }
  await writeAudit(supabase, {
    table_name: "vercel_env",
    record_id: null,
    action: "telegram_secret_cleared",
    new_value: { key, target },
    actor_id: actorId,
  });
  backTo(returnTo, {
    ok: `${key} cleared for ${target}. Telegram will stop working until a new value is set and redeployed.`,
  });
}
