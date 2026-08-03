import Link from "next/link";
import { saveStaffAccount } from "@/app/actions/admin";
import { Card, CertificateField, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { NoCommaInput } from "@/components/NoCommaAddressField";
import DateOfBirthField from "@/components/DateOfBirthField";
import IbanInput from "@/components/IbanInput";
import IbanConfirmCheckbox from "@/components/IbanConfirmCheckbox";
import BankDetailsNote from "@/components/BankDetailsNote";
import BankAccountNameField from "@/components/BankAccountNameField";
import {
  EDUCATION_LEVELS, SPOKEN_LANGUAGES, REFERRAL_LABEL, REFERRAL_PLACEHOLDER,
  SUPPORT_REGIONS, WORLD_COUNTRIES, ORGANIZER_TITLE_OPTIONS, SUPPORT_TITLE_OPTIONS,
} from "@/lib/reference-data";
import { shortTierName } from "@/lib/invitation-codes";
import { formatUSD } from "@/components/ui";
import type { StaffAccountRecord } from "@/lib/admin-data";
import type { Competition } from "@/lib/types";

/** Editable-details form for an existing Admin / Organizer / Participant
 * Support account — the counterpart to the create form on
 * /admin/organizers and /admin/support, which only ever inserts. Shared
 * between both pages since the fields are almost identical; the
 * Participant Support extras (education, languages, supported tiers) are
 * gated on `showSupportFields` rather than forked into a second file.
 *
 * Deliberately does not include role or approval — see saveStaffAccount. */
export default function StaffAccountEditForm({
  account,
  competitions,
  returnTo,
  showSupportFields,
}: {
  account: StaffAccountRecord;
  competitions: Competition[];
  returnTo: string;
  showSupportFields: boolean;
}) {
  const idPrefix = `edit_${account.user_id}`;
  return (
    <Card>
      <form action={saveStaffAccount} className="space-y-4">
        <input type="hidden" name="user_id" value={account.user_id} />
        <input type="hidden" name="return_to" value={returnTo} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}_full_name`} className={adminLabel}>Full name *</label>
            <input id={`${idPrefix}_full_name`} name="full_name" required defaultValue={account.full_name ?? ""} className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_staff_title`} className={adminLabel}>Role *</label>
            <select id={`${idPrefix}_staff_title`} name="staff_title" required defaultValue={account.staff_title ?? ""} className={adminInput}>
              <option value="" disabled>— Select —</option>
              {(showSupportFields ? SUPPORT_TITLE_OPTIONS : ORGANIZER_TITLE_OPTIONS).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          {showSupportFields && (
            <div className="sm:col-span-2">
              <label htmlFor={`${idPrefix}_short_name`} className={adminLabel}>My short name or initial *</label>
              <input id={`${idPrefix}_short_name`} name="short_name" required defaultValue={account.short_name ?? ""} className={adminInput} placeholder="e.g. Amy / KSK" />
            </div>
          )}
          <div>
            <label htmlFor={`${idPrefix}_email`} className={adminLabel}>Email *</label>
            <input id={`${idPrefix}_email`} name="email" type="email" required defaultValue={account.email ?? ""} className={adminInput} />
            <p className="mt-1 text-xs text-neutral-400">Changing this also changes their login email.</p>
          </div>
          <div>
            <label htmlFor={`${idPrefix}_ic_passport`} className={adminLabel}>IC / Passport</label>
            <input id={`${idPrefix}_ic_passport`} name="ic_passport" defaultValue={account.ic_passport ?? ""} className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_date_of_birth`} className={adminLabel}>Date of Birth: DD/MM/YYYY</label>
            <DateOfBirthField id={`${idPrefix}_date_of_birth`} name="date_of_birth" defaultValueISO={account.date_of_birth ?? ""} className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_gender`} className={adminLabel}>Gender</label>
            <select id={`${idPrefix}_gender`} name="gender" defaultValue={account.gender ?? ""} className={adminInput}>
              <option value="">— Select —</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}_belt_rank`} className={adminLabel}>Belt rank (if applicable)</label>
            <input id={`${idPrefix}_belt_rank`} name="belt_rank" defaultValue={account.belt_rank ?? ""} className={adminInput} placeholder="e.g. 3rd Kyu" />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1 text-xs text-neutral-400">Replace rank certificate (leave blank to keep the current one)</p>
            <CertificateField />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${idPrefix}_home_address`} className={adminLabel}>
              Home address{" "}
              <span className="font-normal text-neutral-400">(no comma &quot;,&quot; allowed in the box)</span>
            </label>
            <NoCommaInput id={`${idPrefix}_home_address`} defaultValue={account.home_address ?? ""} required={false} className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_city_town`} className={adminLabel}>City / Town</label>
            <input id={`${idPrefix}_city_town`} name="city_town" defaultValue={account.city_town ?? ""} className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_postcode`} className={adminLabel}>Postcode</label>
            <input id={`${idPrefix}_postcode`} name="postcode" defaultValue={account.postcode ?? ""} className={adminInput} placeholder="e.g. 50000" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_country`} className={adminLabel}>Country</label>
            <input id={`${idPrefix}_country`} name="country" defaultValue={account.country ?? ""} className={adminInput} />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_phone`} className={adminLabel}>Mobile phone</label>
            <input id={`${idPrefix}_phone`} name="phone" type="tel" defaultValue={account.phone ?? ""} className={adminInput} placeholder="+60…" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}_referral_source`} className={adminLabel}>{REFERRAL_LABEL} <span className="font-normal text-neutral-400">(optional)</span></label>
            <input id={`${idPrefix}_referral_source`} name="referral_source" defaultValue={account.referral_source ?? ""} className={adminInput} placeholder={REFERRAL_PLACEHOLDER} />
          </div>
          {showSupportFields && (
            <>
              <div>
                <label htmlFor={`${idPrefix}_highest_education`} className={adminLabel}>Highest Education Attended *</label>
                <select id={`${idPrefix}_highest_education`} name="highest_education" required defaultValue={account.highest_education ?? ""} className={adminInput}>
                  <option value="" disabled>— Select —</option>
                  {EDUCATION_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>{lvl}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${idPrefix}_languages_count`} className={adminLabel}>
                  How many languages can they speak, read, and write? *
                </label>
                <input id={`${idPrefix}_languages_count`} name="languages_count" type="number" min={0} max={20} required defaultValue={account.languages_count ?? ""} className={adminInput} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`${idPrefix}_languages`} className={adminLabel}>
                  Which languages? <span className="font-normal text-neutral-400">(ctrl/cmd-click to select more than one)</span>
                </label>
                <select id={`${idPrefix}_languages`} name="languages" multiple size={6} defaultValue={account.languages ?? []} className={adminInput}>
                  {SPOKEN_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${idPrefix}_based_country`} className={adminLabel}>Which country are they currently based at? *</label>
                <select id={`${idPrefix}_based_country`} name="based_country" required defaultValue={account.based_country ?? ""} className={adminInput}>
                  <option value="" disabled>Select country</option>
                  {WORLD_COUNTRIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${idPrefix}_preferred_region`} className={adminLabel}>Which region would they prefer to support? *</label>
                <select id={`${idPrefix}_preferred_region`} name="preferred_region" required defaultValue={account.preferred_region ?? ""} className={adminInput}>
                  <option value="" disabled>Select region</option>
                  {SUPPORT_REGIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {showSupportFields && (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
              Kata Competition Tier(s) they&apos;ll support{" "}
              <span className="font-normal text-neutral-400 normal-case">(optional, up to 3)</span>
            </p>
            <div className="mt-2 grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["support_tier_1_id", account.support_tier_1_id],
                  ["support_tier_2_id", account.support_tier_2_id],
                  ["support_tier_3_id", account.support_tier_3_id],
                ] as const
              ).map(([name, value], i) => (
                <div key={name}>
                  <label htmlFor={`${idPrefix}_${name}`} className={adminLabel}>Tier {i + 1}</label>
                  <select id={`${idPrefix}_${name}`} name={name} defaultValue={value ?? ""} className={adminInput}>
                    <option value="">— None —</option>
                    {competitions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {shortTierName(c.name)} ({formatUSD(c.registration_fee_usd)})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Bank details</p>
          <BankDetailsNote />
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${idPrefix}_bank_name`} className={adminLabel}>Bank name</label>
              <input id={`${idPrefix}_bank_name`} name="bank_name" defaultValue={account.bank_name ?? ""} className={adminInput} />
            </div>
            <div>
              <label htmlFor={`${idPrefix}_bank_account_no`} className={adminLabel}>International Bank Account No. (IBAN/SWIFT/BIC/ACH)</label>
              <IbanInput id={`${idPrefix}_bank_account_no`} name="bank_account_no" defaultValue={account.bank_account_no ?? ""} className={adminInput} />
              <IbanConfirmCheckbox id={`${idPrefix}_bank_account_no_confirmed`} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${idPrefix}_bank_account_name`} className={adminLabel}>Bank account holder name</label>
              <BankAccountNameField
                id={`${idPrefix}_bank_account_name`}
                fullNameFieldId={`${idPrefix}_full_name`}
                defaultValue={account.bank_account_name ?? ""}
                defaultFullName={account.full_name ?? ""}
                className={adminInput}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" className={adminBtn}>Save changes</button>
          <Link href={returnTo} className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
            Cancel
          </Link>
        </div>
      </form>
    </Card>
  );
}
