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
async function deleteExisting(key: string, target: "production" | "preview") {
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

/** Re-deploys whatever deployment is currently live for the given target,
 * by asking Vercel to rebuild that exact deployment again rather than
 * starting a new one from an ambiguous local checkout -- this is the fix
 * for the exact bug that broke this project's build earlier: a manually
 * triggered "vercel deploy" not tied to the right git branch silently used
 * a stale, mismatched env var instead of the one just set. Asking Vercel to
 * redeploy a known deployment ID preserves its git branch by construction,
 * so there is nothing to get wrong here the way there was by hand.
 * Fire-and-forget: a real deploy takes 1-3+ minutes, far longer than a
 * server action should hold a request open, so this returns as soon as
 * Vercel accepts the request, not once the deploy is actually live. */
async function triggerRedeploy(target: "production" | "preview"): Promise<{ ok: boolean; message: string }> {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (!branch) return { ok: false, message: "Could not determine the current git branch to redeploy." };

  const listRes = await vercelFetch(`/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=10`);
  if (!listRes.ok) return { ok: false, message: `Could not list deployments (${listRes.status}).` };
  const { deployments } = (await listRes.json()) as {
    deployments: Array<{ uid: string; meta?: { githubCommitRef?: string } }>;
  };
  const current = deployments.find((d) => d.meta?.githubCommitRef === branch);
  if (!current) return { ok: false, message: `Could not find a recent deployment for branch "${branch}" to redeploy.` };

  // The env-var API (/v9, /v10 above) and this deployments API use different
  // vocabularies for "not production" -- env vars take "preview", but /v13
  // deployments rejects that with "target should be 'production', 'staging',
  // or a custom environment identifier" (confirmed live; this project has no
  // custom environments configured, so "staging" is Vercel's own reserved
  // name for the non-production bucket here, not something we defined).
  const redeployRes = await vercelFetch(`/v13/deployments`, {
    method: "POST",
    body: JSON.stringify({
      name: "malaysia-iko-gojuryu-kata-competition",
      deploymentId: current.uid,
      target: target === "production" ? "production" : "staging",
    }),
  });
  if (!redeployRes.ok) {
    const body = await redeployRes.text();
    return { ok: false, message: `Redeploy request failed (${redeployRes.status}): ${body.slice(0, 300)}` };
  }
  return { ok: true, message: "Redeploy triggered." };
}

/** NEXT_PUBLIC_APP_URL, not a secret -- shown and edited as plain text, not
 * write-only like the two fields above. Feeds the webhook URL shown just
 * below it, every outbound email link, and every certificate link, so a
 * bad value here breaks far more than Telegram; validated loosely (must
 * look like a real https URL, no trailing slash) before it's ever sent to
 * Vercel. */
export async function updateAppUrl(formData: FormData) {
  const returnTo = String(formData.get("return_to") ?? "") || "/admin/telegram";
  const { supabase, actorId } = await requireEditor(returnTo);
  const value = String(formData.get("value") ?? "").trim().replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
    backTo(returnTo, { error: "Enter a real https:// address, e.g. https://example.com — no trailing slash, no path." });
  }

  const target = currentTarget();
  try {
    await deleteExisting("NEXT_PUBLIC_APP_URL", target);
    const createRes = await vercelFetch(`/v10/projects/${VERCEL_PROJECT_ID}/env`, {
      method: "POST",
      body: JSON.stringify({ key: "NEXT_PUBLIC_APP_URL", value, type: "plain", target: [target] }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Could not save NEXT_PUBLIC_APP_URL (${createRes.status}): ${body.slice(0, 300)}`);
    }
  } catch (err) {
    backTo(returnTo, { error: err instanceof Error ? err.message : "Could not update Vercel." });
  }

  await writeAudit(supabase, {
    table_name: "vercel_env",
    record_id: null,
    action: "app_url_updated",
    new_value: { target, value },
    actor_id: actorId,
  });

  const redeploy = await triggerRedeploy(target);
  if (!redeploy.ok) {
    backTo(returnTo, {
      error: `Saved NEXT_PUBLIC_APP_URL, but the automatic redeploy failed: ${redeploy.message} Redeploy by hand, then use "Update webhook now" below.`,
    });
  }
  // Production's custom domain auto-tracks its newest Production deployment,
  // but staging's does not -- it's a manually-set alias (see
  // scripts/repoint-staging-alias.sh) that this redeploy never touches. Left
  // silent, that's exactly the "fixed it, but the friendly URL still serves
  // the old build" trap that cost hours earlier on this project.
  const staleAliasNote =
    target === "production"
      ? ""
      : ` This environment's domain doesn't auto-track new builds the way Production's does, though — it'll keep serving the previous build until the staging alias is re-pointed at the new one (bash scripts/repoint-staging-alias.sh).`;
  backTo(returnTo, {
    ok: `Saved and redeploying now (usually 1-3 minutes). Once it's live, click "Update webhook now" below to point Telegram at the new address.${staleAliasNote}`,
  });
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
