"use client";

import { useEffect, useRef, useState } from "react";

const ACCEPT = "image/*";

/** A single hidden file input driven by two visible buttons, same structure
 * as CertificateUploadField -- but this one is for a passport-style photo,
 * not a document scan: images only (no PDF), and an actual live thumbnail
 * next to the buttons instead of just a filename. Kept as its own component
 * rather than an extension of CertificateUploadField so the existing
 * certificate upload UX (used by Sensei/Participant/Referee/Staff forms)
 * can't regress. */
export default function PhotoUploadField({
  id = "photo",
  name = "photo",
  required = false,
  previewUrl = null,
}: {
  id?: string;
  name?: string;
  required?: boolean;
  /** The judge's existing public photo, shown as the initial thumbnail on
   * an edit form -- possible without a signed-URL fetch since the
   * judge-photos bucket is public. */
  previewUrl?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(previewUrl);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function openPicker(useCamera: boolean) {
    const el = inputRef.current;
    if (!el) return;
    if (useCamera) el.setAttribute("capture", "user");
    else el.removeAttribute("capture");
    el.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (!file) {
      setPreview(previewUrl);
      return;
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreview(url);
  }

  return (
    <div className="flex items-start gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview ? (
        <img src={preview} alt="Photo preview" className="h-20 w-20 shrink-0 rounded-md border border-neutral-300 object-cover" />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-[10px] text-neutral-400">
          No photo
        </div>
      )}
      <div>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          required={required}
          accept={ACCEPT}
          className="sr-only"
          onChange={onChange}
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
        <p className="mt-1 text-xs text-neutral-400">Accepted formats: JPG, PNG, HEIC, WEBP. Max 5 MB.</p>
      </div>
    </div>
  );
}
