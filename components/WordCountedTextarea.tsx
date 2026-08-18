"use client";

import { useState } from "react";
import { countWords } from "@/lib/text-limits";

/** A textarea with a live "N / max words" counter, turning red past the
 * cap -- the client-side half of the word-count check; the authoritative
 * check happens server-side (see saveJudgeSelfIntro), this is only for
 * immediate feedback. */
export default function WordCountedTextarea({
  id,
  name,
  defaultValue = "",
  maxWords,
  placeholder,
  rows = 5,
  onOverLimitChange,
}: {
  id?: string;
  name: string;
  defaultValue?: string;
  maxWords: number;
  placeholder?: string;
  rows?: number;
  /** Notified whenever the over-limit state changes, so a parent form can
   * disable its own submit button without re-deriving the count itself. */
  onOverLimitChange?: (overLimit: boolean) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const count = countWords(value);
  const overLimit = count > maxWords;

  return (
    <div>
      <textarea
        id={id}
        name={name}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onOverLimitChange?.(countWords(e.target.value) > maxWords);
        }}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
      />
      <p className={`mt-1 text-xs ${overLimit ? "font-semibold text-red-600" : "text-neutral-400"}`}>
        {count} / {maxWords} words
      </p>
    </div>
  );
}
