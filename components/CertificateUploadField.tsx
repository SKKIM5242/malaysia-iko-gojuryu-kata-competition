"use client";

import { useRef, useState } from "react";

const ACCEPT = "image/*,application/pdf";

/** A single hidden file input driven by two visible buttons — "Choose
 * file" opens the normal picker, "Take picture" sets capture=environment
 * right before opening it so phones jump straight to the camera instead of
 * an ambiguous chooser. Used everywhere a rank certificate is uploaded. */
export default function CertificateUploadField({
  id = "certificate",
  name = "certificate",
  required = false,
}: {
  id?: string;
  name?: string;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function openPicker(useCamera: boolean) {
    const el = inputRef.current;
    if (!el) return;
    if (useCamera) el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.click();
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="file"
        required={required}
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => openPicker(false)}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
        >
          📁 Choose file
        </button>
        <button
          type="button"
          onClick={() => openPicker(true)}
          className="rounded-md border border-neutral-300 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700"
        >
          📷 Take picture
        </button>
      </div>
      {fileName ? (
        <p className="mt-1 text-xs font-medium text-green-700">Selected: {fileName}</p>
      ) : (
        <p className="mt-1 text-xs text-neutral-400">No file selected yet.</p>
      )}
      <p className="mt-1 text-xs text-neutral-400">Accepted formats: JPG, PNG, HEIC, PDF. Max 10 MB.</p>
    </div>
  );
}
