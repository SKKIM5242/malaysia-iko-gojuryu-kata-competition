"use client";

import { useState } from "react";
import { formatIbanForDisplay } from "@/lib/bank";

/** A bank account / IBAN text input that auto-groups what's typed into
 * 4-character blocks for readability (e.g. "MY29 MBBE 1234 5678 9012").
 * The grouped value is what gets submitted in form data -- the server
 * strips the spaces back out (see lib/bank.ts normalizeIban) before
 * storing, so this is display-only formatting, not the storage format. */
export default function IbanInput({
  id,
  name,
  required,
  defaultValue,
  className,
  placeholder = "e.g. MY29 MBBE 1234 5678 9012",
}: {
  id: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  className?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(() => formatIbanForDisplay(defaultValue ?? ""));
  return (
    <input
      id={id}
      name={name}
      required={required}
      value={value}
      onChange={(e) => setValue(formatIbanForDisplay(e.target.value))}
      inputMode="text"
      autoCapitalize="characters"
      autoComplete="off"
      maxLength={42}
      className={className}
      placeholder={placeholder}
    />
  );
}
