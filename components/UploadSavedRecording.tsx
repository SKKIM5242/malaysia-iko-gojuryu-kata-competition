"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitKataVideo } from "@/app/actions/account";
import { extensionForMimeType, bareMimeType, recordingBitrates, KATA_MAX_SECONDS } from "@/lib/media-recording";
import { getLocalRecording, clearLocalRecording } from "@/lib/local-recording-store";
import { uploadRecording } from "@/lib/upload-recording";
import { kataFamilyOf, type KataFamily } from "@/lib/kata-families";
import { kataBaseOf } from "@/lib/division";

const ATTESTATION_TEXT =
  "I confirm this is my own previously recorded kata video, submitted without any editing. Any editing is subject to disqualification.";

/** Each family's own performance time limit, in minutes — the basis for the
 * upload size caps below. */
const FAMILY_MINUTES: Record<KataFamily, number> = {
  Elementary: 1.3,
  Intermediate: 1.3,
  Advance: 1.3,
  Mastery: 1.5,
  Kobudo: 5,
};

/** A file made through the in-app recorder can never exceed these sizes: the
 * recorder's own bitrate times each family's time limit.
 *
 * DERIVED, never hardcoded. These used to be five literals worked out from a
 * recording bitrate of ~8.22 MB/minute, and the moment that bitrate was
 * raised they silently became too small — a Mastery take made in-app could
 * reach 13.84MB while this panel still refused anything over 12.33MB, and
 * told the competitor their own untouched recording had been made "some
 * other way". Reading the figure from recordingBitrates() is what stops the
 * two ever disagreeing again.
 *
 * A file genuinely bigger than this was made some other way, almost always a
 * phone camera app recording at a far higher bitrate (4K/60fps) than this
 * footage ever needs — re-saving at 1080p/720p, 30fps brings it back under
 * the limit without losing anything a judge needs to see. */
const RECORDER_MB_PER_MINUTE = (() => {
  const { videoBitsPerSecond, audioBitsPerSecond } = recordingBitrates(KATA_MAX_SECONDS);
  return ((videoBitsPerSecond + audioBitsPerSecond) * 60) / 8 / 1_000_000;
})();

const MAX_UPLOAD_MB = Object.fromEntries(
  (Object.keys(FAMILY_MINUTES) as KataFamily[]).map((f) => [
    f,
    Math.round(FAMILY_MINUTES[f] * RECORDER_MB_PER_MINUTE * 100) / 100,
  ]),
) as Record<KataFamily, number>;

/** Best guess at a real video content-type from the file name, for when the
 * browser reports none. Storage needs a truthful Content-Type or the video
 * will not play back in the arena later. */
function mimeFromFileName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "ogv") return "video/ogg";
  if (ext === "3gp") return "video/3gpp";
  // Everything the recorder itself produces is webm or mp4, and webm is the
  // commoner of the two, so it is the least-bad default for an unknown name.
  return "video/webm";
}

/** Checked by extension as well as MIME type, because the type is the half
 * that goes missing: a file saved out of a browser download frequently
 * arrives with an empty `type`, and on iOS `.webm` has no registered video
 * type at all. Used only to warn after the fact — never to filter the
 * picker, which once made those files unselectable. */
function looksLikeVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(webm|mp4|m4v|mov|mkv|avi|3gp|ogv)$/i.test(file.name);
}

/**
 * The poor-connectivity path: a recording that was already made in-app but
 * couldn't be submitted at the time.
 *
 * Choosing a file is now the ONLY thing this panel depends on. It used to
 * be entangled with "Save to device": the submit button doubled as the
 * status line for a browser-cached copy, and when no copy existed it
 * rendered as a DISABLED button reading "Choose a file first" — which
 * reads exactly like the button you press to choose a file, and did
 * nothing at all when pressed, on every browser. The submit button now
 * simply does not exist until a file has been chosen, so there is no dead
 * control to mis-click.
 *
 * The automatically cached copy still gets offered when one happens to
 * exist, but only as a clearly separate extra that gates nothing. It lives
 * in IndexedDB, which is per-browser and per-device, so it is absent far
 * more often than not — recording on a phone and uploading from a laptop is
 * the normal case, not the exception.
 */
export default function UploadSavedRecording({
  registrationId,
  categoryName,
  onSubmitted,
}: {
  registrationId: string;
  /** Which kata this registration is for — used only to look up that kata's
   * family (Elementary/Intermediate/Advance/Mastery/Kobudo) and therefore
   * which MAX_UPLOAD_MB figure applies. A family that can't be resolved
   * (should not happen for any of the 24 real kata) just skips the
   * client-side size check rather than guessing a limit. */
  categoryName?: string | null;
  /** Fired the moment the server accepts the upload, so the row can swap
   * straight to the submitted state. Without it the row would keep showing
   * "Start Recording" until the refreshed server data arrived — a window in
   * which a participant can start a second recording over a kata they have
   * already submitted. */
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const family = categoryName ? kataFamilyOf(kataBaseOf(categoryName)) : null;
  const maxMB = family ? MAX_UPLOAD_MB[family] : null;
  const maxBytes = maxMB != null ? maxMB * 1024 * 1024 : null;
  const [open, setOpen] = useState(false);
  const [cachedCopy, setCachedCopy] = useState<{ blob: Blob; mime: string } | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Last thing the browser actually told us when the picker closed. Shown
   * on screen because "nothing happened" is unreportable — this turns it
   * into a specific sentence a participant can read back to us. */
  const [pickerReport, setPickerReport] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // iOS Safari frequently discards the page while the Photos/Files picker
  // is open and reloads it on return — a low-memory eviction, not a crash.
  // Every bit of React state goes with it, so the panel silently closed
  // itself and the participant came back to a screen that looked like the
  // button had done nothing at all. Remembering only that the panel was
  // open (never the file, which cannot be serialised) makes the return trip
  // land where they left off. sessionStorage, so it does not outlive the tab.
  const openKey = `upload-panel-open:${registrationId}`;
  useEffect(() => {
    try {
      if (sessionStorage.getItem(openKey) === "1") setOpen(true);
    } catch {
      // Private mode can refuse sessionStorage; the panel just won't reopen.
    }
  }, [openKey]);
  useEffect(() => {
    try {
      if (open) sessionStorage.setItem(openKey, "1");
      else sessionStorage.removeItem(openKey);
    } catch {
      // Ignored for the same reason.
    }
  }, [open, openKey]);

  // Read once, on open, purely to decide whether to offer the extra
  // "cached copy" button. Nothing on this panel waits for it, so a browser
  // with no IndexedDB at all changes nothing about the main flow.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getLocalRecording(registrationId).then((r) => {
      if (!cancelled) setCachedCopy(r);
    });
    return () => {
      cancelled = true;
    };
  }, [open, registrationId]);

  async function doUpload(blob: Blob, mime: string) {
    setStatus("uploading");
    setUploadProgress(0);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Your session expired — please sign in again.");
        setStatus("error");
        return;
      }
      // Same uploader the in-app recorder uses: a pre-signed URL over XHR,
      // with retries and a size check on what actually landed. This panel is
      // the fallback people are told to use when a direct submit fails, so
      // leaving it on the plain fetch upload meant the fallback failed the
      // same way on the same phones -- which is exactly what happened.
      const ext = extensionForMimeType(mime);
      const outcome = await uploadRecording(
        supabase,
        "kata-videos",
        () => `${user.id}/${crypto.randomUUID()}.${ext}`,
        blob,
        bareMimeType(mime || "video/webm"),
        { onProgress: setUploadProgress },
      );
      if (!outcome.ok || !outcome.path) {
        setError(`${outcome.error ?? "Upload failed."}${outcome.detail ? ` (${outcome.detail})` : ""}`);
        setStatus("error");
        return;
      }
      const fd = new FormData();
      fd.set("path", outcome.path);
      fd.set("mime", mime);
      fd.set("registration_id", registrationId);
      const result = await submitKataVideo({ ok: false }, fd);
      if (!result.ok) {
        setError(result.error ?? "Could not submit your recording.");
        setStatus("error");
        return;
      }
      void clearLocalRecording(registrationId);
      // router.refresh(), not window.location.reload(): a full reload throws
      // away the just-set submitted state and re-renders from scratch, so
      // any staleness in the served page shows "Start Recording" again for a
      // beat. A refresh re-fetches the server tree underneath the state we
      // have already flipped, so the row can never go backwards.
      setOpen(false);
      onSubmitted?.();
      router.refresh();
    } catch {
      setError("Something went wrong uploading your recording. Please try again.");
      setStatus("error");
    }
  }

  const pickedMime = pickedFile
    ? pickedFile.type && pickedFile.type.startsWith("video/")
      ? pickedFile.type
      : mimeFromFileName(pickedFile.name)
    : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-amber-400 px-4 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-amber-300"
      >
        ⬆ Upload previously saved file
      </button>

      {/* The panel is `relative` so the visually-hidden, absolutely
          positioned file input is anchored here rather than escaping to
          the page. */}
      {open && (
        <div className="relative mt-2 w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          <p className="text-xs text-amber-900">
            Choose the kata video you saved with &quot;Save to device&quot;. It is usually in your Downloads or
            Files, with a name ending in .webm or .mp4.
            {maxMB != null && (
              <>
                {" "}
                Keep it under <span className="font-semibold">{maxMB} MB</span> — if it&apos;s bigger, re-save it at
                1080p or 720p, HD30/30fps first (4K or HD60/60fps is never necessary for this).
              </>
            )}
          </p>

          {/* Visually hidden, driven by the button below, and hidden by
           * clipping rather than display:none — Safari has historically
           * refused to open the picker for an input it considers not
           * rendered. A programmatic .click() from inside a real click
           * handler still counts as the user gesture Safari requires. */}
          <input
            ref={fileInputRef}
            type="file"
            className="absolute h-px w-px overflow-hidden opacity-0"
            style={{ clip: "rect(0 0 0 0)" }}
            onClick={(e) => {
              // Clearing the value first means picking the SAME file twice
              // still fires change. Without this, a participant who picks a
              // file, cancels, then picks it again sees nothing happen.
              (e.target as HTMLInputElement).value = "";
            }}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (file && file.size === 0) {
                setPickedFile(null);
                setPickerReport("That file is 0 MB — it's empty, not your recording. Pick the actual saved video file.");
                return;
              }
              if (file && maxBytes != null && file.size > maxBytes) {
                setPickedFile(null);
                setPickerReport(
                  `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB, over the ${maxMB} MB limit for this ` +
                    `kata. Re-save it at 1080p or 720p, 30fps, then choose it again.`,
                );
                return;
              }
              setPickedFile(file);
              setPickerReport(
                file
                  ? null
                  : "Your browser closed the file picker without giving us a file. Try again — and if you are picking from Photos on an iPhone, give it a moment, because a long video is converted before it is handed over.",
              );
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-2 w-full rounded-md border border-amber-500 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
          >
            📁 {pickedFile ? "Choose a different file" : "Choose file"}
          </button>

          {pickedFile ? (
            <p className="mt-1 text-xs text-amber-900">
              Chosen: <span className="font-semibold">{pickedFile.name}</span>{" "}
              <span className="text-amber-700">({(pickedFile.size / (1024 * 1024)).toFixed(1)} MB)</span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-amber-700">No file chosen yet.</p>
          )}

          {pickerReport && !pickedFile && (
            <p className="mt-1 text-xs font-semibold text-red-700">{pickerReport}</p>
          )}

          {pickedFile && !looksLikeVideo(pickedFile) && (
            // A warning, not a block. The test is a guess about a file the
            // browser may know nothing about, and blocking on a guess is
            // how the picker got broken in the first place.
            <p className="mt-1 text-xs font-semibold text-amber-800">
              ⚠️ This doesn&apos;t look like a video file. You can still upload it, but check you picked the
              recording you saved and not something else.
            </p>
          )}

          {/* Everything below appears only once a file is in hand, so there
              is never a disabled button sitting there inviting a click. */}
          {pickedFile && (
            <>
              {/* The checkbox is the one thing standing between a chosen
                  file and submitting it, so it has to be genuinely easy to
                  hit with a thumb — the browser's own unstyled default
                  renders at roughly 13px, which is smaller than Apple's and
                  Google's own minimum recommended touch target. Sized
                  explicitly here rather than left to the default, with the
                  label itself still wrapping both so tapping the sentence
                  works exactly like tapping the box. */}
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-amber-600"
                />
                <span>{ATTESTATION_TEXT}</span>
              </label>

              <button
                type="button"
                disabled={!agreed || status === "uploading"}
                onClick={() => doUpload(pickedFile, pickedMime)}
                className="mt-2 w-full rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "uploading"
                  ? uploadProgress > 0 && uploadProgress < 1
                    ? `Uploading… ${Math.round(uploadProgress * 100)}%`
                    : "Uploading…"
                  : "⬆ Upload & submit this recording"}
              </button>
              {!agreed && (
                <p className="mt-1 text-xs text-amber-700">Tick the confirmation above to enable submitting.</p>
              )}
            </>
          )}

          {/* Optional extra, never a gate: some browsers still hold an
              automatic copy of a take that failed to submit. Only shown
              when one genuinely exists on THIS browser. */}
          {cachedCopy && !pickedFile && (
            <button
              type="button"
              disabled={status === "uploading"}
              onClick={() => {
                if (window.confirm("Upload the copy this browser saved automatically for this kata?")) {
                  void doUpload(cachedCopy.blob, cachedCopy.mime);
                }
              }}
              className="mt-3 w-full rounded-md border border-amber-500 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              📼 Or upload the copy this browser saved automatically
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 rounded-md border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            Cancel
          </button>

          {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
        </div>
      )}
    </>
  );
}
