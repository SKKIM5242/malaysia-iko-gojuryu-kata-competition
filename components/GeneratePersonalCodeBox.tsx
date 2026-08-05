"use client";

import { useState } from "react";
import { generateRecordInvitationCode } from "@/app/actions/admin";
import { adminInput, adminLabel, adminBtn } from "@/components/admin-styles";
import { shortTierName } from "@/lib/invitation-codes";
import DateField from "@/components/DateField";
import type { Competition } from "@/lib/types";

/** Generate/regenerate a single-use invitation code bound to one existing
 * record's own email — same generateRecordInvitationCode action already
 * used inline on the Schools/Senseis/Referees edit forms, but as a
 * standalone modal for pages with no per-record edit form of their own
 * (Audience, Participant Support). Shown next to each row in the table's
 * Actions column. */
export default function GeneratePersonalCodeBox({
  role,
  recordId,
  email,
  invitationCode,
  competitions,
  returnTo,
}: {
  role: string;
  recordId: string;
  email: string | null;
  invitationCode: string | null;
  competitions: Competition[];
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
      >
        {invitationCode ? "Regenerate personal code" : "Generate personal code"}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-700">Personal invitation code</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700" aria-label="Close">
                ✕
              </button>
            </div>
            <form action={generateRecordInvitationCode} className="space-y-3">
              <input type="hidden" name="role" value={role} />
              <input type="hidden" name="id" value={recordId} />
              <input type="hidden" name="return_to" value={returnTo} />
              <div>
                <label htmlFor={`pic_competition_id_${recordId}`} className={adminLabel}>Competition Tier *</label>
                <select id={`pic_competition_id_${recordId}`} name="pic_competition_id" required defaultValue="" className={adminInput}>
                  <option value="" disabled>Select competition tier</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>{shortTierName(c.name)}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`pic_valid_from_${recordId}`} className={adminLabel}>Valid from *</label>
                  <DateField id={`pic_valid_from_${recordId}`} name="pic_valid_from" className={adminInput} />
                </div>
                <div>
                  <label htmlFor={`pic_valid_until_${recordId}`} className={adminLabel}>Valid until *</label>
                  <DateField id={`pic_valid_until_${recordId}`} name="pic_valid_until" className={adminInput} />
                </div>
              </div>
              <div>
                <label htmlFor={`pic_sign_in_limit_${recordId}`} className={adminLabel}>Sign-in limit *</label>
                <input id={`pic_sign_in_limit_${recordId}`} name="pic_sign_in_limit" type="number" min="1" required className={adminInput} />
              </div>
              <button type="submit" className={adminBtn}>
                {invitationCode ? "Regenerate personal code" : "Generate personal code"}
              </button>
              <p className="text-xs text-neutral-400">
                {invitationCode
                  ? `Current code: "${invitationCode}" — bound to ${email ?? "this record's email"}, single use in create account.`
                  : `Single-use, bound only to ${email ?? "this record's email"} — for creating that one login, not a shared code. Sign-in access after account creation depends on the Valid from/until window and Sign-in limit above, whichever is reached first.`}
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
