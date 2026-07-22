"use client";

import type { ChangeEvent } from "react";

/** Commas in an address break CSV exports/uploads (they're the field
 * delimiter), so every Home address field strips any comma the moment it's
 * typed or pasted in — this is the shared onChange for both variants below. */
function stripCommas(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
  if (e.target.value.includes(",")) e.target.value = e.target.value.replace(/,/g, "");
}

interface NoCommaFieldProps {
  id: string;
  defaultValue?: string;
  required?: boolean;
  className: string;
  placeholder?: string;
}

export function NoCommaInput({ id, defaultValue, required = true, className, placeholder }: NoCommaFieldProps) {
  return (
    <input
      id={id}
      name="home_address"
      required={required}
      defaultValue={defaultValue ?? ""}
      placeholder={placeholder}
      onChange={stripCommas}
      className={className}
    />
  );
}

export function NoCommaTextarea({
  id,
  defaultValue,
  required = true,
  className,
  placeholder,
  rows = 2,
}: NoCommaFieldProps & { rows?: number }) {
  return (
    <textarea
      id={id}
      name="home_address"
      required={required}
      rows={rows}
      defaultValue={defaultValue ?? ""}
      placeholder={placeholder}
      onChange={stripCommas}
      className={className}
    />
  );
}
