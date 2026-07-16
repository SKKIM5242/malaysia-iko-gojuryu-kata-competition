"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { adminAttachVideo } from "@/app/actions/admin";

/** Admin-only backup path for attaching a recording to a registration —
 * uploads straight to the private kata-videos bucket client-side (large
 * files don't belong in a Server Action body), then records the path via
 * adminAttachVideo. Replaces any existing recording for that registration. */
export default function AdminVideoUploadForm({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const ext = (file.name.split(".").pop() || "mp4").toLowerCase().slice(0, 5);
    const path = `admin-upload/${registrationId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("kata-videos")
      .upload(path, file, { contentType: file.type || "video/mp4" });
    if (upErr) {
      setError(`Upload failed: ${upErr.message}`);
      setBusy(false);
      return;
    }
    const fd = new FormData();
    fd.set("registration_id", registrationId);
    fd.set("path", path);
    fd.set("mime", file.type || "video/mp4");
    const result = await adminAttachVideo({ ok: false }, fd);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not attach the recording.");
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return <p className="text-xs font-semibold text-green-700">Uploaded ✓</p>;
  }

  return (
    <div>
      <label
        className={`inline-block cursor-pointer rounded border px-2.5 py-1 text-xs font-semibold ${
          busy
            ? "border-neutral-200 text-neutral-400"
            : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
        }`}
      >
        {busy ? "Uploading…" : "Upload video"}
        <input
          type="file"
          accept="video/webm,video/mp4,video/quicktime"
          className="hidden"
          disabled={busy}
          onChange={handleFile}
        />
      </label>
      {error && <p className="mt-1 max-w-[160px] text-xs text-red-600">{error}</p>}
    </div>
  );
}
