"use client";

import { useState } from "react";
import { ageAt } from "@/lib/division";
import { adminInput, adminLabel } from "@/components/admin-styles";
import DateOfBirthField from "@/components/DateOfBirthField";
import KataEventPicker from "@/components/KataEventPicker";
import type { Category, Competition } from "@/lib/types";

/** Date of birth + live Age, Gender, and Belt rank on the admin Add/Edit
 * Participant form — grouped into one client component because the Kata
 * events picker below them can only filter eligible kata once all three are
 * known, and the admin page itself is a server component.
 *
 * Replaces what were three separate server-rendered fields plus DobAgeField;
 * the field names and ids are unchanged so saveParticipant reads them
 * exactly as before. */
export default function AdminParticipantKataFields({
  competitions,
  categoriesByCompetition,
  categoryTakenByCompetition,
  defaultDateOfBirth,
  defaultGender,
  defaultBeltRank,
  showKataPicker,
}: {
  competitions: Competition[];
  categoriesByCompetition: Record<string, Category[]>;
  categoryTakenByCompetition: Record<string, Record<string, number>>;
  defaultDateOfBirth?: string;
  defaultGender?: string;
  defaultBeltRank?: string;
  /** Hidden when editing: changing an existing participant's details must not
   * silently create a second set of registrations. Entries are added from the
   * Add form, or by the participant themselves. */
  showKataPicker: boolean;
}) {
  const [dob, setDob] = useState(defaultDateOfBirth ?? "");
  const [gender, setGender] = useState(defaultGender ?? "");
  const [beltRank, setBeltRank] = useState(defaultBeltRank ?? "");
  const age = dob && !Number.isNaN(Date.parse(dob)) ? ageAt(dob, null) : null;

  return (
    <>
      <div>
        <label htmlFor="date_of_birth" className={adminLabel}>Date of Birth: DD/MM/YYYY *</label>
        <DateOfBirthField
          id="date_of_birth"
          name="date_of_birth"
          defaultValueISO={defaultDateOfBirth}
          onISOChange={setDob}
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
      <div>
        <label htmlFor="gender" className={adminLabel}>Gender *</label>
        <select
          id="gender"
          name="gender"
          required
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className={adminInput}
        >
          <option value="" disabled>— Select —</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      </div>
      <div>
        <label htmlFor="belt_rank" className={adminLabel}>Latest Belt rank *</label>
        <input
          id="belt_rank"
          name="belt_rank"
          required
          value={beltRank}
          onChange={(e) => setBeltRank(e.target.value)}
          className={adminInput}
          placeholder="e.g. 3rd Kyu"
        />
      </div>
      {showKataPicker && (
        <div className="sm:col-span-2">
          <KataEventPicker
            competitions={competitions}
            categoriesByCompetition={categoriesByCompetition}
            categoryTakenByCompetition={categoryTakenByCompetition}
            dateOfBirth={dob}
            beltRank={beltRank}
            gender={gender}
            inputCls={adminInput}
          />
        </div>
      )}
    </>
  );
}
