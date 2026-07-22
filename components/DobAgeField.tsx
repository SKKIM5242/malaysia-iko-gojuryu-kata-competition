"use client";

import { useState } from "react";
import { ageAt } from "@/lib/division";
import { adminInput, adminLabel } from "@/components/admin-styles";

/** Date of birth + a read-only, live-computed Age (based on D.O.B) field
 * shown right beside it — used on admin add/edit forms that collect a
 * participant's date of birth. */
export default function DobAgeField({ defaultValue }: { defaultValue?: string }) {
  const [dob, setDob] = useState(defaultValue ?? "");
  const age = dob && !Number.isNaN(Date.parse(dob)) ? ageAt(dob, null) : null;

  return (
    <>
      <div>
        <label htmlFor="date_of_birth" className={adminLabel}>Date of birth *</label>
        <input
          id="date_of_birth"
          name="date_of_birth"
          type="date"
          required
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          className={adminInput}
        />
      </div>
      <div>
        <label htmlFor="age" className={adminLabel}>Age (based on D.O.B) *</label>
        <input
          id="age"
          readOnly
          value={age ?? ""}
          placeholder="Fill in date of birth first"
          className={`${adminInput} cursor-not-allowed bg-neutral-100 text-neutral-500`}
        />
      </div>
    </>
  );
}
