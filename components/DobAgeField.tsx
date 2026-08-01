"use client";

import { useState } from "react";
import { ageAt } from "@/lib/division";
import { adminInput, adminLabel } from "@/components/admin-styles";
import DateOfBirthField from "@/components/DateOfBirthField";

/** Date of birth + a read-only, live-computed Age (based on D.O.B) field
 * shown right beside it. Styling defaults to the admin panel's own
 * (adminInput/adminLabel) so every existing admin call site is unaffected;
 * pass inputCls/labelCls to reuse this on a public-site form instead. */
export default function DobAgeField({
  defaultValue,
  idPrefix = "",
  inputCls = adminInput,
  labelCls = adminLabel,
  errorSlot,
}: {
  defaultValue?: string;
  /** Prefixes both field ids, for a page with more than one date-of-birth
   * field (e.g. admin Support's "cs_" prefix, to avoid colliding with
   * other forms' plain "date_of_birth" id on the same page). */
  idPrefix?: string;
  inputCls?: string;
  labelCls?: string;
  /** Rendered right under the date input — for a public form's own field-
   * error component (e.g. <Err m={e.date_of_birth} />), so it lands in the
   * right grid cell instead of trailing after both fields. */
  errorSlot?: React.ReactNode;
}) {
  const [dob, setDob] = useState(defaultValue ?? "");
  const age = dob && !Number.isNaN(Date.parse(dob)) ? ageAt(dob, null) : null;
  const dobId = `${idPrefix}date_of_birth`;
  const ageId = `${idPrefix}age`;

  return (
    <>
      <div>
        <label htmlFor={dobId} className={labelCls}>Date of Birth: DD/MM/YYYY *</label>
        <DateOfBirthField
          id={dobId}
          name="date_of_birth"
          defaultValueISO={defaultValue}
          onISOChange={setDob}
          className={inputCls}
        />
        {errorSlot}
      </div>
      <div>
        <label htmlFor={ageId} className={labelCls}>Age (based on D.O.B) *</label>
        <input
          id={ageId}
          readOnly
          value={age ?? ""}
          placeholder="Fill in date of birth first"
          className={`${inputCls} cursor-not-allowed bg-neutral-100 text-neutral-500`}
        />
      </div>
    </>
  );
}
