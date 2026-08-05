"use client";

import { useState } from "react";
import { parseDDMMYYYY } from "@/lib/csv-bulk";

function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Date of Birth entry as typed DD/MM/YYYY text, regardless of the visitor's
 * browser/OS locale — a native `<input type="date">` instead shows
 * MM/DD/YYYY or other locale-dependent formats the organizer doesn't want.
 * Parses via the same parseDDMMYYYY used for CSV uploads, so a date typed
 * here and one uploaded in a CSV are validated identically. Renders a
 * hidden `name`-carrying input with the parsed ISO value for ordinary form
 * submission — omit `name` when the parent already tracks the ISO value
 * itself (e.g. one row of a JSON-serialized bulk table). */
export default function DateOfBirthField({
  id,
  name,
  required = true,
  disabled = false,
  form,
  defaultValueISO,
  onISOChange,
  className,
  ariaLabel,
  title,
}: {
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  /** Associates this input with an external `<form id="...">` it isn't
   * nested inside — e.g. one row of a table where every cell shares a
   * single per-row form declared elsewhere. */
  form?: string;
  defaultValueISO?: string;
  onISOChange?: (iso: string) => void;
  className: string;
  ariaLabel?: string;
  title?: string;
}) {
  const [text, setText] = useState(() => (defaultValueISO ? isoToDisplay(defaultValueISO) : ""));

  return (
    <>
      <input
        id={id}
        aria-label={ariaLabel}
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        required={required}
        disabled={disabled}
        form={form}
        pattern="\d{2}/\d{2}/\d{4}"
        title={title ?? "DD/MM/YYYY"}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          onISOChange?.(parseDDMMYYYY(v) ?? "");
        }}
        className={className}
      />
      {name && <input type="hidden" name={name} form={form} value={parseDDMMYYYY(text) ?? ""} />}
    </>
  );
}
