"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Bank account holder name — defaults to (and stays locked to) a sibling
 * "full name" field's live value, so a payout can't silently go to a
 * different person; the consent checkbox unlocks free editing for the
 * genuine case of the payout account being under someone else's name (e.g.
 * a parent/guardian). Watches the sibling field via a plain DOM listener
 * rather than shared React state, since these admin forms are Server
 * Components — mirrors the pattern RegisterForm.tsx already uses for the
 * public participant registration, now shared everywhere else too.
 *
 * When editing an existing record whose saved account-holder name already
 * differs from the full name on file, starts unlocked (not silently
 * overwritten) so the existing on-file value is respected.
 */
export default function BankAccountNameField({
  id,
  fullNameFieldId,
  defaultValue = "",
  defaultFullName = "",
  required = true,
  className,
}: {
  id: string;
  /** DOM id of the sibling "full name" (or equivalent person-in-charge) input this field follows while locked. */
  fullNameFieldId: string;
  defaultValue?: string;
  defaultFullName?: string;
  required?: boolean;
  className?: string;
}) {
  const initiallyDifferent = defaultValue.trim() !== "" && defaultValue.trim() !== defaultFullName.trim();
  const [otherName, setOtherName] = useState(initiallyDifferent);
  const [value, setValue] = useState(defaultValue);
  const followingRef = useRef(!initiallyDifferent);

  useEffect(() => {
    const source = document.getElementById(fullNameFieldId) as HTMLInputElement | null;
    if (!source) return;
    const sync = () => {
      if (followingRef.current) setValue(source.value);
    };
    source.addEventListener("input", sync);
    return () => source.removeEventListener("input", sync);
  }, [fullNameFieldId]);

  useEffect(() => {
    followingRef.current = !otherName;
    if (!otherName) {
      const source = document.getElementById(fullNameFieldId) as HTMLInputElement | null;
      if (source) setValue(source.value);
    }
  }, [otherName, fullNameFieldId]);

  return (
    <>
      <input
        id={id}
        name={id}
        required={required}
        readOnly={!otherName}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`${className ?? ""} ${!otherName ? "cursor-not-allowed bg-neutral-100 text-neutral-500" : ""}`}
        placeholder="As per bank records"
      />
      <p className="mt-1 text-xs text-neutral-400">
        Auto-filled from the full name above and locked — tick the box below if the payout
        account is under a different name.
      </p>
      <label className="mt-2 flex items-start gap-2 text-xs text-neutral-700">
        <input
          type="checkbox"
          checked={otherName}
          onChange={(e) => setOtherName(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I give consent to the organizer to pay this payout to a bank account under a
          different name (e.g. a parent/guardian&apos;s account). Only tick this if the account
          holder name needs to differ from the full name above.
        </span>
      </label>
    </>
  );
}
