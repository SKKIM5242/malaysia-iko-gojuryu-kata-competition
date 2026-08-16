"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitIssueReport, type IssueActionState } from "@/app/actions/issue-reports";
import {
  ISSUE_REPORT_NOTE,
  ISSUE_TYPE_OPTIONS,
  MAX_ISSUE_SCREENSHOTS,
  SCREEN_SPEC_OPTIONS,
  VIEW_TYPE_OPTIONS,
} from "@/lib/issue-reports";

const initial: IssueActionState = {};

const labelClass = "block text-sm font-semibold text-neutral-700";
const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none";

export default function IssueReportForm() {
  const [state, formAction, pending] = useActionState(submitIssueReport, initial);
  const [screenSpec, setScreenSpec] = useState("");
  // Two separate inputs feed one list: the gallery picker and the camera.
  // A single input can't be both — `capture` forces the camera on mobile,
  // and without it you get the gallery — so each has its own hidden input
  // and both append into this shared array, which is what actually gets
  // submitted.
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Object URLs are a manual resource -- revoke the previous batch whenever
  // the list changes, and on unmount, or every re-pick leaks one per image.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setFiles([]);
      setScreenSpec("");
      setFileError(null);
    }
  }, [state.ok]);

  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const incoming = Array.from(picked);
    const room = MAX_ISSUE_SCREENSHOTS - files.length;
    if (room <= 0) {
      setFileError(`You've already attached the maximum of ${MAX_ISSUE_SCREENSHOTS} pictures.`);
      return;
    }
    setFileError(
      incoming.length > room
        ? `Only ${room} more picture${room === 1 ? "" : "s"} could be added — the maximum is ${MAX_ISSUE_SCREENSHOTS}.`
        : null,
    );
    setFiles((prev) => [...prev, ...incoming.slice(0, room)]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  }

  return (
    <section className="mt-8 rounded-lg border border-neutral-300 bg-white p-5">
      <h2 className="text-lg font-bold text-neutral-900">
        Report any inconsistency in viewing the page, site, app, recording window (portrait/landscape), or a
        technical issue that needs fixing
      </h2>
      <p className="mt-1 text-sm text-neutral-500">All fields below are required.</p>

      <form
        ref={formRef}
        action={(formData) => {
          // The <input type="file"> elements are deliberately left out of
          // the form's own submission (they only ever hold the LAST pick,
          // not the running total), so the accumulated list is attached
          // here instead.
          formData.delete("screenshots");
          files.forEach((f) => formData.append("screenshots", f));
          return formAction(formData);
        }}
        className="mt-4 space-y-4"
      >
        <div>
          <label className={labelClass} htmlFor="ir-subject">
            Subject that needs fixing
          </label>
          <input id="ir-subject" name="subject" required className={inputClass} placeholder="Short summary of the problem" />
        </div>

        <div>
          <p className={labelClass}>Type of issue</p>
          {/* Every choice visible at once, no dropdown to open first —
              tap/click anywhere on a card to pick it. */}
          <div className="mt-1 space-y-2">
            {ISSUE_TYPE_OPTIONS.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-md border border-neutral-300 p-2.5 has-[:checked]:border-red-600 has-[:checked]:bg-red-50 hover:bg-neutral-50"
              >
                <input type="radio" name="issue_type" value={o.value} required className="mt-1 shrink-0" />
                <span>
                  <span className="block text-sm font-semibold text-neutral-800">{o.label}</span>
                  <span className="block text-xs text-neutral-500">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ir-page">
              At which page?
            </label>
            <input id="ir-page" name="page" required className={inputClass} placeholder="e.g. Record Your Kata" />
          </div>
          <div>
            <label className={labelClass} htmlFor="ir-section">
              At which section?
            </label>
            <input id="ir-section" name="section" required className={inputClass} placeholder="e.g. the recording window banner" />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="ir-what-wrong">
            What is wrong on your device?
          </label>
          <textarea
            id="ir-what-wrong"
            name="what_wrong"
            required
            rows={3}
            className={inputClass}
            placeholder="Describe what you see, and what you expected to see instead"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ir-view-type">
              Type of view that has the issue
            </label>
            <select id="ir-view-type" name="view_type" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                Please choose…
              </option>
              {VIEW_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="ir-device">
              What device are you using?
            </label>
            <input id="ir-device" name="device_name" required className={inputClass} placeholder="e.g. iPhone SE, Samsung Galaxy S8+" />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="ir-screen-spec">
            What is the specification (height × width) of your device screen? Please choose the one your phone
            matches.
          </label>
          <select
            id="ir-screen-spec"
            name="screen_spec"
            required
            value={screenSpec}
            onChange={(e) => setScreenSpec(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Please choose…
            </option>
            {SCREEN_SPEC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {screenSpec === "other" && (
            <input
              name="screen_spec_other"
              required
              className={`${inputClass} mt-2`}
              placeholder="State your screen size, e.g. 1179 × 2556"
            />
          )}
        </div>

        <div>
          <p className={labelClass}>
            Please submit the screenshot(s) showing the issue — up to {MAX_ISSUE_SCREENSHOTS}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              📁 Choose file
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="rounded-md border border-neutral-300 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-700"
            >
              📷 Take picture
            </button>
            <span className="self-center text-xs text-neutral-500">
              {files.length} of {MAX_ISSUE_SCREENSHOTS} attached
            </span>
          </div>
          {/* Not named, and never submitted with the form -- see the action
              handler above, which appends the accumulated list instead. */}
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {fileError && <p className="mt-2 text-xs font-semibold text-amber-700">{fileError}</p>}
          {previews.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {previews.map((src, i) => (
                <li key={src} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Screenshot ${i + 1}`} className="h-20 w-20 rounded border border-neutral-300 object-cover" />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label={`Remove screenshot ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label className={labelClass} htmlFor="ir-expected">
            What do you expect the result would be after the fix?
          </label>
          <textarea id="ir-expected" name="expected_result" required rows={3} className={inputClass} />
        </div>

        {state.error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">
            {state.ok}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-700 px-6 py-2.5 font-semibold text-white hover:bg-red-600 disabled:opacity-60"
        >
          {pending ? "Submitting…" : "Submit report"}
        </button>
        <p className="text-xs text-neutral-500">
          Submitting notifies the Admin, the Organizer and all available Participant Support staff.
        </p>
      </form>

      <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {ISSUE_REPORT_NOTE}
      </p>
    </section>
  );
}
