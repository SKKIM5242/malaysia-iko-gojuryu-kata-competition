"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { submitKataVideo } from "@/app/actions/account";
import { extensionForMimeType, bareMimeType } from "@/lib/media-recording";
import { getLocalRecording, clearLocalRecording, onLocalRecordingChanged } from "@/lib/local-recording-store";

const ATTESTATION_TEXT =
  "I confirm this is my own previously recorded kata video, submitted without any editing. Any editing is subject to disqualification.";

/** Fallback path for a recording that was already made in-app (KataRecorder
 * auto-caches every take locally, and offers its own "Save to device"
 * button) but couldn't be submitted at the time -- a bad connection right
 * after a take, most commonly. Only ever shows up for a registration that
 * actually has something cached; nothing renders otherwise, matching "no
 * upload button... if don't have pending recording".
 *
 * The manual file picker beneath it is a second-line fallback for when the
 * local cache itself didn't survive (storage cleared, a different browser
 * or device from the one recorded on) but the participant does still have
 * the file they saved via KataRecorder's own Save-to-device button --
 * gated behind the same signed attestation either way, since this is the
 * one path in the whole flow that can't itself verify the file wasn't
 * edited. */
export default function UploadSavedRecording({ registrationId }: { registrationId: string }) {
  const [localBlob, setLocalBlob] = useState<{ blob: Blob; mime: string } | null | undefined>(undefined);
  const [showFilePicker, setShowFilePicker] = useState(false);
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
    // Tapping "Save to device" in KataRecorder happens in a sibling
    // component, not a parent/child of this one -- without listening for
    // its change event, this row would only ever pick up a fresh save on
    // its own next mount (a full page navigation), even though the save
    // just happened on this same page view.
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
      window.location.reload();
    } catch {
      setError("Something went wrong uploading your recording. Please try again.");
      setStatus("error");
    }
  }

  if (localBlob === undefined) return null;
  if (!localBlob) return null;

  const readyBlob = pickedFile ?? localBlob.blob;
  const readyMime = pickedFile?.type || localBlob.mime;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
      <span className="text-blue-900">
        📼 You have a recording saved on this device that hasn&apos;t been submitted yet.
      </span>
      <label className="flex items-start gap-2 text-xs text-blue-900">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5"
        />
        <span>{ATTESTATION_TEXT}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!agreed || status === "uploading"}
          onClick={() => doUpload(readyBlob, readyMime)}
          className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "uploading" ? "Uploading…" : pickedFile ? "Upload chosen file" : "Upload saved recording"}
        </button>
        {!showFilePicker && (
          <button
            type="button"
            onClick={() => setShowFilePicker(true)}
            className="text-xs font-semibold text-blue-800 underline hover:text-blue-900"
          >
            This device doesn&apos;t have it — choose a file instead
          </button>
        )}
      </div>
      {showFilePicker && (
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)}
          className="text-xs text-blue-900"
        />
      )}
      {error && <p className="text-xs font-semibold text-red-700">{error}</p>}
    </li>
  );
}
