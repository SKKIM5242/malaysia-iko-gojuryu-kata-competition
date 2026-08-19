import type { SupabaseClient } from "@supabase/supabase-js";

export interface UploadOutcome {
  ok: boolean;
  /** The object path that actually landed -- each attempt uses a fresh one,
   * so this is the only reliable way to know where the recording ended up. */
  path?: string;
  /** Participant-facing message, already specific enough to act on. */
  error?: string;
  /** Everything worth knowing if this needs chasing later -- the HTTP status
   * the transport actually saw, which attempt succeeded, and so on. Safari's
   * fetch reports every network-level failure as the single opaque string
   * "Load failed", which is what left an iPhone submission failure with
   * nothing to diagnose from. */
  detail?: string;
}

interface UploadOptions {
  onProgress?: (fraction: number) => void;
  attempts?: number;
  signal?: AbortSignal;
}

/** A single PUT of the blob to a pre-signed Supabase Storage URL, over
 * XMLHttpRequest rather than fetch.
 *
 * XHR is used deliberately. supabase-js uploads through fetch, and on iOS
 * Safari a fetch carrying a large Blob body fails as a bare
 * `TypeError: Load failed` with no status, no headers and no way to tell a
 * dropped connection from a rejected request -- which is exactly the error an
 * iPhone X hit submitting a 10.3MB take. XHR surfaces the real HTTP status,
 * fires progress events (so a phone on a slow uplink can show something
 * moving instead of appearing frozen), and is the better-tested path for
 * large request bodies on that browser. */
function putWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("content-type", contentType);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () =>
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body: (xhr.responseText || "").slice(0, 300) });
    xhr.onerror = () => resolve({ ok: false, status: 0, body: "network error" });
    xhr.ontimeout = () => resolve({ ok: false, status: 0, body: "timed out" });
    xhr.onabort = () => resolve({ ok: false, status: 0, body: "aborted" });
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(blob);
  });
}

/** Confirms the object that actually landed is the size we sent.
 *
 * A 200 only says the request completed, not that a body arrived with it: a
 * Blob that iOS has quietly evicted under memory pressure uploads
 * "successfully" as ZERO bytes, and this project's storage already holds two
 * such 0-byte recordings from earlier attempts. Those looked submitted to the
 * participant and would have reached a judge as an unplayable file. */
async function storedSize(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<number | null> {
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash > 0 ? path.slice(0, lastSlash) : "";
  const name = lastSlash > 0 ? path.slice(lastSlash + 1) : path;
  const { data, error } = await supabase.storage.from(bucket).list(dir, { search: name, limit: 100 });
  if (error || !data) return null;
  const hit = data.find((o) => o.name === name);
  if (!hit) return null;
  const size = (hit.metadata as { size?: number } | null)?.size;
  return typeof size === "number" ? size : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Uploads a recording to Supabase Storage as reliably as a browser allows:
 * a pre-signed URL PUT over XHR, the stored size verified afterwards, and
 * the whole thing retried on anything that isn't a definitive rejection.
 *
 * Retrying matters more here than almost anywhere else in the app -- the
 * participant has one performance, a limited number of re-record chances,
 * and no way to get the take back once they leave the page.
 */
export async function uploadRecording(
  supabase: SupabaseClient,
  bucket: string,
  /** Called once per attempt. Every try gets a FRESH object path, because
   * Supabase refuses to re-sign an upload URL for a path that already holds
   * an object -- verified against the live API, which answers 400 on the
   * second sign even with upsert requested. Deleting the old one first isn't
   * an option either: a participant's own policies on this bucket grant
   * insert and select but not delete. A new path per attempt sidesteps both,
   * and the caller uses whichever path actually succeeded. */
  makePath: () => string,
  blob: Blob,
  contentType: string,
  { onProgress, attempts = 3, signal }: UploadOptions = {},
): Promise<UploadOutcome> {
  const notes: string[] = [];
  const orphans: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) return { ok: false, error: "Upload cancelled." };
    const path = makePath();
    if (attempt > 1) onProgress?.(0);

    const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (signErr || !signed?.signedUrl) {
      notes.push(`attempt ${attempt}: could not sign (${signErr?.message ?? "no url"})`);
      // Falling back to the library's own fetch-based upload rather than
      // giving up: signing is the only part of this that the plain upload
      // path doesn't need, so if it's unavailable the old route may still
      // work.
      const { error: plainErr } = await supabase.storage.from(bucket).upload(path, blob, { contentType });
      if (!plainErr) {
        const size = await storedSize(supabase, bucket, path);
        if (size === null || size === blob.size) {
          return { ok: true, path, detail: notes.join("; ") };
        }
        notes.push(`fallback stored ${size} of ${blob.size} bytes`);
        orphans.push(path);
      } else {
        notes.push(`fallback failed (${plainErr.message})`);
      }
      if (attempt < attempts) await sleep(attempt * 1500);
      continue;
    }

    const res = await putWithProgress(signed.signedUrl, blob, contentType, onProgress, signal);
    if (res.ok) {
      const size = await storedSize(supabase, bucket, path);
      if (size === null || size === blob.size) {
        void cleanUp(supabase, bucket, orphans);
        return {
          ok: true,
          path,
          detail: notes.length ? `${notes.join("; ")}; succeeded on attempt ${attempt}` : undefined,
        };
      }
      notes.push(`attempt ${attempt}: stored ${size} of ${blob.size} bytes`);
      orphans.push(path);
    } else {
      notes.push(`attempt ${attempt}: HTTP ${res.status || "network"} ${res.body}`);
      orphans.push(path);
      // 4xx other than 408/429 means the server made a decision (too large,
      // wrong type, no permission) -- repeating the same request would only
      // waste the participant's time and get the same answer.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        void cleanUp(supabase, bucket, orphans);
        return { ok: false, error: uploadErrorMessage(res.status, blob), detail: notes.join("; ") };
      }
    }
    if (attempt < attempts) await sleep(attempt * 1500);
  }
  void cleanUp(supabase, bucket, orphans);
  return {
    ok: false,
    error:
      "Your recording could not be uploaded after several tries. It is still saved on this device — stay on this page, check your connection, and press Submit again.",
    detail: notes.join("; "),
  };
}

/** Best-effort tidy-up of objects left by attempts that didn't pan out.
 * Expected to no-op for a participant (their policies don't grant delete);
 * the failed paths are never recorded anywhere, so nothing references them. */
async function cleanUp(supabase: SupabaseClient, bucket: string, paths: string[]) {
  if (paths.length === 0) return;
  await supabase.storage
    .from(bucket)
    .remove(paths)
    .catch(() => {});
}

function uploadErrorMessage(status: number, blob: Blob): string {
  const mb = (blob.size / 1024 / 1024).toFixed(1);
  if (status === 413) return `This recording is too large to upload (${mb}MB). Please record a shorter take.`;
  if (status === 401 || status === 403) return "Your session expired while uploading — please sign in again and resubmit.";
  if (status === 415) return `This device recorded in a format the server rejected (${blob.type || "unknown"}). Please contact support with this message.`;
  return `Upload was rejected by the server (HTTP ${status}). Please try again or contact support with this message.`;
}
