"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveHomepageNote } from "@/app/actions/admin";

/**
 * The single "Event date → Registration deadline is…" note shown once
 * beneath the tier cards on the homepage. Same Edit/Save/Cancel/Delete
 * shape as the recording-spec rows on /admin/storage: editing is local
 * state, Save/Delete call the server action directly and await the result
 * before closing, and Delete clears the override rather than removing the
 * box itself — the homepage always shows something, just the default text
 * once there's no override.
 */
export default function HomepageNoteForm({
  note,
  defaultText,
  canEdit,
}: {
  note: string | null;
  defaultText: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function cancel() {
    setValue(note ?? "");
    setEditing(false);
    setError(null);
  }

  async function submit(mode: "save" | "delete") {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("mode", mode);
    if (mode === "save") fd.set("note", value);
    const result = await saveHomepageNote(fd);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    if (mode === "delete") setValue("");
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
        <p className="text-sm font-bold text-neutral-800">
          {note ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              custom text — overrides the default
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
              using default text
            </span>
          )}
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-white"
              >
                Edit
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void submit("save")}
                  className="rounded bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={cancel}
                  className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-white disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
            <button
              type="button"
              disabled={pending || !note}
              onClick={() => void submit("delete")}
              title="Clear the custom text — the homepage falls back to the default below"
              className="rounded border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {error && <p className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">{error}</p>}

      <div className="p-3">
        {editing ? (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={5}
            placeholder={defaultText}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
          />
        ) : (
          <p className="whitespace-pre-line text-sm text-neutral-700">{note || defaultText}</p>
        )}
        <p className="mt-2 text-[11px] text-neutral-400">
          Default text (shown whenever there&apos;s no custom text above):
          <br />
          {defaultText}
        </p>
      </div>
    </div>
  );
}
