"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitKataVideo } from "@/app/actions/account";
import { extensionForMimeType, bareMimeType } from "@/lib/media-recording";
import { getLocalRecording, clearLocalRecording, onLocalRecordingChanged } from "@/lib/local-recording-store";

/** Checked by extension as well as MIME type, because the type is the half
 * that goes missing: a file saved out of a browser download frequently
 * arrives with an empty `type`, and on iOS `.webm` has no registered video
 * type at all. Used only to warn after the fact — never to filter the
 * picker, which is what previously made those files unselectable. */
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

function looksLikeVideo(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(webm|mp4|m4v|mov|mkv|avi|3gp|ogv)$/i.test(file.name);
}

const ATTESTATION_TEXT =
  "I confirm this is my own previously recorded kata video, submitted without any editing. Any editing is subject to disqualification.";

/**
 * The poor-connectivity path: a recording that was already made in-app but
 * couldn't be submitted at the time.
 *
 * The button is now ALWAYS shown next to "Start Recording", rather than only
 * when this browser happens to still hold a cached copy. That conditional
 * rendering is why it appeared to be missing: the automatic cache lives in
 * IndexedDB, which is per-browser and per-device, so recording on a phone
 * and then looking for the button on a laptop (or after the browser cleared
 * site data, or after a re-record wiped the previous take) legitimately
 * showed nothing at all — with no way to tell that apart from a bug.
 *
 * Now the button is a stable entry point, and the panel behind it explains
 * which of the two sources is available: this device's own saved copy when
 * there is one, and otherwise the file the participant saved with "Save to
 * device". Either way the same signed attestation is required, because this
 * is the one route in the whole flow that cannot itself prove the file
 * wasn't edited.
 */
export default function UploadSavedRecording({
  registrationId,
  onSubmitted,
}: {
  registrationId: string;
  /** Fired the moment the server accepts the upload, so the row can swap
   * straight to the submitted state. Without it the row would keep showing
   * "Start Recording" until the refreshed server data arrived — a window in
   * which a participant can start a second recording over a kata they have
   * already submitted. */
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [localBlob, setLocalBlob] = useState<{ blob: Blob; mime: string } | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      getLocalRecording(registrationId).then((r) => {
        if (!cancelled) setLocalBlob(r);
      });
    }
    refresh();
    // "Save to device" happens in KataRecorder, a sibling component — without
    // listening for its change event this row would only notice a fresh
    // recording on its own next mount (a full page navigation).
    const unsubscribe = onLocalRecordingChanged((changedId) => {
      if (changedId === registrationId) refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [registrationId]);

  async function doUpload(blob: Blob, mime: string) {
    setStatus("uploading");
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
      const path = `${user.id}/${crypto.randomUUID()}.${extensionForMimeType(mime)}`;
      const { error: upErr } = await supabase.storage
        .from("kata-videos")
        .upload(path, blob, { contentType: bareMimeType(mime || "video/webm") });
      if (upErr) {
        setError(
          `Upload failed: ${upErr.message || "unknown error"} — please try again once you have a better connection.`,
        );
        setStatus("error");
        return;
      }
      const fd = new FormData();
      fd.set("path", path);
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

  const readyBlob: Blob | null = pickedFile ?? localBlob?.blob ?? null;
  // Falls back to the file's EXTENSION when the browser reports no type,
  // which is common for a file that came from a download rather than from
  // a camera roll. Without this an iPhone-saved .mp4 with a missing type
  // was uploaded named .webm with a video/webm content-type — a file whose
  // name, declared type and actual contents all disagreed, which is a
  // playback failure later rather than an error at upload time.
  const readyMime = pickedFile
    ? pickedFile.type && pickedFile.type.startsWith("video/")
      ? pickedFile.type
      : mimeFromFileName(pickedFile.name)
    : localBlob?.mime || "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-amber-400 px-4 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-amber-300"
      >
        ⬆ Upload previously saved file
      </button>

      {open && (
        <div className="mt-2 w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          {localBlob ? (
            <p className="text-xs font-semibold text-amber-900">
              📼 A recording made on this device is still waiting to be submitted — upload that, or choose a file
              below instead.
            </p>
          ) : (
            <p className="text-xs text-amber-900">
              No unsent recording is stored in this browser. That is normal if you recorded on another device or
              browser, or already submitted it. Choose the file you kept with &quot;Save to device&quot; — it is
              usually in your Downloads or Files, named ending in .webm or .mp4.
            </p>
          )}

          {/* No `accept` filter, deliberately.
           *
           * It used to be accept="video/*", which is what made files
           * impossible to select. That attribute filters on the MIME TYPE
           * the operating system has recorded for the file, not on its
           * contents, and a recording saved out of the browser very often
           * reaches the disk with no type at all — at which point the
           * picker greys it out and there is no way to pick it. It is worse
           * on phones: iOS has no video type registered for .webm, so a
           * kata saved on Android or a laptop is ALWAYS greyed out on an
           * iPhone, and Android's video picker only lists files its media
           * scanner has indexed, which usually excludes Downloads.
           *
           * The check below runs after the file is chosen instead, where a
           * wrong guess costs a warning rather than a file that cannot be
           * selected at all. */}
          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)}
            className="mt-2 block w-full text-xs text-amber-900"
          />

          {pickedFile && (
            <p className="mt-1 text-xs text-amber-900">
              Chosen: <span className="font-semibold">{pickedFile.name}</span>{" "}
              <span className="text-amber-700">({(pickedFile.size / (1024 * 1024)).toFixed(1)} MB)</span>
            </p>
          )}

          {pickedFile && !looksLikeVideo(pickedFile) && (
            // A warning, not a block. The test is a guess about a file the
            // browser may know nothing about, and blocking on a guess is
            // exactly the bug being fixed here.
            <p className="mt-1 text-xs font-semibold text-amber-800">
              ⚠️ This doesn&apos;t look like a video file. You can still upload it, but check you picked the
              recording you saved and not something else.
            </p>
          )}

          <label className="mt-2 flex items-start gap-2 text-xs text-amber-900">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            <span>{ATTESTATION_TEXT}</span>
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!agreed || !readyBlob || status === "uploading"}
              onClick={() => readyBlob && doUpload(readyBlob, readyMime)}
              className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "uploading"
                ? "Uploading…"
                : pickedFile
                  ? "Upload chosen file"
                  : localBlob
                    ? "Upload the recording saved on this device"
                    : "Choose a file first"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>

          {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
        </div>
      )}
    </>
  );
}
