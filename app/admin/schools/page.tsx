import Link from "next/link";
import { getSchools, schemaReady } from "@/lib/data";
import { getSchoolSenseiTierFees, getSchoolSenseiTierEntryCounts, getAllCompetitions } from "@/lib/admin-data";
import { createClient } from "@/lib/supabase/server";
import {
  saveSchool, deleteSchool, generateRecordInvitationCode, updateCommunityStatus, bulkUploadSchools,
  linkSchoolToAccount, unlinkSchoolFromAccount,
} from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatUSD } from "@/components/ui";
import { shortTierName } from "@/lib/invitation-codes";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import SignInControlBox from "@/components/SignInControlBox";
import AccountLinkCell from "@/components/AccountLinkCell";
import InvitationCodeForm from "@/components/InvitationCodeForm";
import InvitationCodeList from "@/components/InvitationCodeList";
import InvitationCodeRunField from "@/components/InvitationCodeRunField";
import DateField from "@/components/DateField";
import TierSlotsField from "@/components/TierSlotsField";
import { tierEntriesLabel } from "@/lib/tier-entries";
import { NoCommaInput } from "@/components/NoCommaAddressField";
import IbanInput from "@/components/IbanInput";
import IbanConfirmCheckbox from "@/components/IbanConfirmCheckbox";
import BankDetailsNote from "@/components/BankDetailsNote";
import BankAccountNameField from "@/components/BankAccountNameField";
import { IBAN_CSV_NOTE } from "@/lib/bank";

import { REFERRAL_LABEL, REFERRAL_PLACEHOLDER } from "@/lib/reference-data";

export const dynamic = "force-dynamic";

function PaymentButtons({ id, current }: { id: string; current: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {["pending", "paid", "waived"].map((o) => (
        <form key={o} action={updateCommunityStatus}>
          <input type="hidden" name="table" value="schools" />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="field" value="payment_status" />
          <input type="hidden" name="value" value={o} />
          <input type="hidden" name="return_to" value="/admin/schools" />
          <button
            disabled={o === current}
            className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${
              o === current
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {o}
          </button>
        </form>
      ))}
    </div>
  );
}

export default async function AdminSchools({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; editcode?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Schools" active="/admin/schools">
        <SetupNotice />
      </AdminShell>
    );
  }

  const [schools, { schoolFees }, competitions, { schoolEntries }] = await Promise.all([
    getSchools(),
    getSchoolSenseiTierFees(),
    getAllCompetitions(),
    getSchoolSenseiTierEntryCounts(),
  ]);
  const editing = params.edit ? schools.find((s) => s.id === params.edit) : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isAdminTier = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");
  const canBulkUpload = ["admin", "organizer"].includes(myProfile?.role ?? "");
  const canManageLink = ["admin", "organizer", "staff", "customer_support", "referee"].includes(myProfile?.role ?? "");

  const { data: schoolLogins } = await supabase
    .from("profiles")
    .select("user_id, school_id, email, sign_in_count, sign_in_limit, sign_in_competition_id, sign_in_valid_from, sign_in_valid_until")
    .eq("role", "school");
  const loginBySchoolId = new Map((schoolLogins ?? []).map((p) => [p.school_id as string, p]));

  return (
    <AdminShell title="Schools" active="/admin/schools" flash={{ ok: params.ok, error: params.error }}>
      {canBulkUpload && (
        <div className="mb-8">
          <CsvUploadForm
            action={bulkUploadSchools}
            templateHref="/schools-template.csv"
            entityLabel="school"
            note={IBAN_CSV_NOTE}
          />
        </div>
      )}
      <div className="space-y-8">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit School" : "Add School"}</h2>
          <Card>
            <form key={editing?.id ?? "new"} action={saveSchool} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              {editing && <input type="hidden" name="role" value="school" />}
              {editing && <input type="hidden" name="return_to" value={`/admin/schools?edit=${editing.id}`} />}
              <div>
                <label htmlFor="name" className={adminLabel}>Dojo / club name *</label>
                <input id="name" name="name" required defaultValue={editing?.name ?? ""} className={adminInput} />
              </div>
              <div>
                <label htmlFor="competition_id" className={adminLabel}>
                  Competition tier — one-time registration fee *
                </label>
                <select
                  id="competition_id"
                  name="competition_id"
                  required
                  defaultValue={editing?.registration_competition_id ?? ""}
                  className={adminInput}
                >
                  <option value="" disabled>Select tier</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {shortTierName(c.name)} ({formatUSD(c.registration_fee_usd)})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-neutral-400">
                  Sets the fee owed. Saving a NEW school with no invitation code goes straight to
                  Stripe for this amount; with a code the fee is waived or settled another way and
                  the record stays pending.
                </p>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-semibold text-neutral-700">Person in-charge / Chief Instructor</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="contact_title" className={adminLabel}>Title *</label>
                    <select id="contact_title" name="contact_title" required defaultValue={editing?.contact_title ?? ""} className={adminInput}>
                      <option value="" disabled>Select</option>
                      <option value="Mr.">Mr.</option>
                      <option value="Ms.">Ms.</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="contact_name" className={adminLabel}>Name *</label>
                    <input id="contact_name" name="contact_name" required defaultValue={editing?.contact_name ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="contact_karate_title" className={adminLabel}>Karate title *</label>
                    <select id="contact_karate_title" name="contact_karate_title" required defaultValue={editing?.contact_karate_title ?? ""} className={adminInput}>
                      <option value="" disabled>Select</option>
                      <option value="Hanshi">Hanshi</option>
                      <option value="Shihan">Shihan</option>
                      <option value="Sensei">Sensei</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="contact_rank" className={adminLabel}>Rank in karate-do *</label>
                    <input id="contact_rank" name="contact_rank" required defaultValue={editing?.contact_rank ?? ""} className={adminInput} placeholder="e.g. Godan" />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="home_address" className={adminLabel}>
                    School/dojo/club address *{" "}
                    <span className="font-normal text-neutral-400">(no comma &quot;,&quot; allowed in the box)</span>
                  </label>
                  <NoCommaInput id="home_address" defaultValue={editing?.home_address ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="state" className={adminLabel}>State / Province / Region</label>
                  <input id="state" name="state" defaultValue={editing?.state ?? ""} className={adminInput} placeholder="e.g. Selangor, California, Tokyo" />
                </div>
                <div>
                  <label htmlFor="city_town" className={adminLabel}>City / Town *</label>
                  <input id="city_town" name="city_town" required defaultValue={editing?.city_town ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="postcode" className={adminLabel}>Postcode *</label>
                  <input id="postcode" name="postcode" required defaultValue={editing?.postcode ?? ""} className={adminInput} placeholder="e.g. 50000" />
                </div>
                <div>
                  <label htmlFor="home_country" className={adminLabel}>Country *</label>
                  <input id="home_country" name="home_country" required defaultValue={editing?.home_country ?? (editing ? "" : "Malaysia")} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="email" className={adminLabel}>Email address *</label>
                  <input id="email" name="email" type="email" required defaultValue={editing?.email ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="phone" className={adminLabel}>Mobile phone *</label>
                  <input id="phone" name="phone" type="tel" required defaultValue={editing?.phone ?? ""} className={adminInput} placeholder="+60…" />
                </div>
                <InvitationCodeRunField
                  id="invitation_code"
                  role="school"
                  competitions={competitions}
                  defaultValue={editing?.invitation_code}
                />
                <div>
                  <label htmlFor="referral_source" className={adminLabel}>{REFERRAL_LABEL} <span className="font-normal text-neutral-400">(optional)</span></label>
                  <input id="referral_source" name="referral_source" defaultValue={editing?.referral_source ?? ""} className={adminInput} placeholder={REFERRAL_PLACEHOLDER} />
                </div>
                <TierSlotsField
                  competitions={competitions.map((c) => ({ id: c.id, name: c.name, fee: c.registration_fee_usd }))}
                  idPrefix="admin_school_"
                  names={["participating_tier_1_id", "participating_tier_2_id", "participating_tier_3_id"]}
                  heading="Kata Competition Tier(s) this school will have participants in"
                  helperNote="Tier 1 is required. Declared intent only — does not change the school's one-time registration fee, and does not decide commission."
                  values={[editing?.participating_tier_1_id, editing?.participating_tier_2_id, editing?.participating_tier_3_id]}
                  inputCls={adminInput}
                  labelCls={adminLabel}
                />
              </div>

              {editing && (
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                    Personal invitation code for this school
                  </p>
                  <div className="mt-2">
                    <label htmlFor="pic_competition_id" className={adminLabel}>Competition Tier *</label>
                    <select id="pic_competition_id" name="pic_competition_id" defaultValue="" className={adminInput}>
                      <option value="" disabled>Select competition tier</option>
                      {competitions.map((c) => (
                        <option key={c.id} value={c.id}>{shortTierName(c.name)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <div>
                      <label htmlFor="pic_valid_from" className={adminLabel}>Valid from *</label>
                      <DateField id="pic_valid_from" name="pic_valid_from" className={adminInput} />
                    </div>
                    <div>
                      <label htmlFor="pic_valid_until" className={adminLabel}>Valid until *</label>
                      <DateField id="pic_valid_until" name="pic_valid_until" className={adminInput} />
                    </div>
                    <div>
                      <label htmlFor="pic_sign_in_limit" className={adminLabel}>Sign-in limit *</label>
                      <input id="pic_sign_in_limit" name="pic_sign_in_limit" type="number" min="1" className={adminInput} />
                    </div>
                  </div>
                  <button
                    type="submit"
                    formAction={generateRecordInvitationCode}
                    formNoValidate
                    className={`mt-3 ${editing.invitation_code ? adminBtn : adminBtnSecondary}`}
                  >
                    {editing.invitation_code ? "Regenerate personal code" : "Generate personal code"}
                  </button>
                  <p className="mt-2 text-xs text-neutral-400">
                    {editing.invitation_code
                      ? `Note: Current code: "${editing.invitation_code}" — bound to ${editing.email} address, single use in create account.`
                      : `Single-use, bound only to ${editing.email || "this school's email"} — for creating that one login, not a shared code. Sign-in access after account creation depends on the Valid from/until window and Sign-in limit above, whichever is reached first.`}
                  </p>
                </div>
              )}

              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Bank details *</p>
                <BankDetailsNote />
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="bank_name" className={adminLabel}>Bank name *</label>
                    <input id="bank_name" name="bank_name" required defaultValue={editing?.bank_name ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="bank_account_no" className={adminLabel}>International Bank Account No. (IBAN/SWIFT/BIC/ACH) *</label>
                    <IbanInput id="bank_account_no" name="bank_account_no" required defaultValue={editing?.bank_account_no ?? ""} className={adminInput} />
                    <IbanConfirmCheckbox id="bank_account_no_confirmed" />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="bank_account_name" className={adminLabel}>Bank account holder name *</label>
                    <BankAccountNameField
                      id="bank_account_name"
                      fullNameFieldId="contact_name"
                      defaultValue={editing?.bank_account_name ?? ""}
                      defaultFullName={editing?.contact_name ?? ""}
                      className={adminInput}
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Add school"}</button>
                {editing && (
                  <Link href="/admin/schools" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">All Schools</h2>
          {schools.length === 0 ? (
            <EmptyState>No schools yet — add one on the left.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="id"
              downloadName="schools"
              columns={[
                { key: "name", label: "Name" },
                { key: "reference_id", label: "Reference ID" },
                { key: "state", label: "State" },
                { key: "person_in_charge", label: "Person in-charge" },
                { key: "location", label: "Location" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "bank", label: "Bank" },
                { key: "tier_entries", label: "Competition Tier (paid entries)" },
                { key: "expected_fee", label: "Required Fee" },
                { key: "payment", label: "Fee Status" },
                { key: "account_link", label: "Account Link" },
                ...(isAdminTier ? [{ key: "sign_in_control", label: "Sign-in Control" }] : []),
                { key: "actions", label: "Actions" },
              ]}
              csvColumns={[
                { key: "name", label: "Name" },
                { key: "reference_id", label: "Reference ID" },
                { key: "state", label: "State" },
                { key: "contact_title", label: "Contact Title" },
                { key: "contact_name", label: "Contact Name" },
                { key: "contact_karate_title", label: "Contact Karate Title" },
                { key: "contact_rank", label: "Contact Rank" },
                { key: "home_address", label: "Home Address" },
                { key: "city_town", label: "City / Town" },
                { key: "postcode", label: "Postcode" },
                { key: "home_country", label: "Country" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "bank_name", label: "Bank Name" },
                { key: "bank_account_no", label: "International Bank Account No. (IBAN)" },
                { key: "bank_account_name", label: "Bank Account Holder Name" },
                { key: "tier_entries", label: "Competition Tier (paid entries)" },
                { key: "expected_fee", label: "Required Fee" },
                { key: "payment_status_text", label: "Fee Status" },
              ]}
              rows={schools.map((s) => ({
                id: s.id,
                reference_id: s.id.slice(0, 8).toUpperCase(),
                name: s.name,
                state: s.state ?? "",
                person_in_charge: [s.contact_title, s.contact_name].filter(Boolean).join(" ") +
                  (s.contact_karate_title ? ` (${s.contact_karate_title}${s.contact_rank ? ` — ${s.contact_rank}` : ""})` : ""),
                location: [s.home_address, s.city_town, s.postcode, s.home_country].filter(Boolean).join(", "),
                bank: [s.bank_name, s.bank_account_no, s.bank_account_name].filter(Boolean).join(" · "),
                contact_title: s.contact_title ?? "",
                contact_name: s.contact_name ?? "",
                contact_karate_title: s.contact_karate_title ?? "",
                contact_rank: s.contact_rank ?? "",
                home_address: s.home_address ?? "",
                city_town: s.city_town ?? "",
                postcode: s.postcode ?? "",
                home_country: s.home_country ?? "",
                email: s.email ?? "",
                phone: s.phone ?? "",
                bank_name: s.bank_name ?? "",
                bank_account_no: s.bank_account_no ?? "",
                bank_account_name: s.bank_account_name ?? "",
                tier_entries: tierEntriesLabel(schoolEntries.get(s.id), competitions),
                expected_fee: schoolFees.has(s.id) ? formatUSD(schoolFees.get(s.id)) : "— no participants yet",
                payment_status_text: s.payment_status,
                payment: <PaymentButtons key="payment" id={s.id} current={s.payment_status} />,
                account_link: (
                  <AccountLinkCell
                    key="account_link"
                    linkedEmail={loginBySchoolId.get(s.id)?.email ?? null}
                    entityId={s.id}
                    idFieldName="school_id"
                    linkAction={linkSchoolToAccount}
                    unlinkAction={unlinkSchoolFromAccount}
                    returnTo="/admin/schools"
                    canManage={canManageLink}
                  />
                ),
                ...(isAdminTier
                  ? {
                      sign_in_control: (
                        <SignInControlBox
                          key="sign_in_control"
                          userId={loginBySchoolId.get(s.id)?.user_id ?? null}
                          signInCount={loginBySchoolId.get(s.id)?.sign_in_count ?? 0}
                          signInLimit={loginBySchoolId.get(s.id)?.sign_in_limit ?? null}
                          signInCompetitionId={loginBySchoolId.get(s.id)?.sign_in_competition_id ?? null}
                          signInValidFrom={loginBySchoolId.get(s.id)?.sign_in_valid_from ?? null}
                          signInValidUntil={loginBySchoolId.get(s.id)?.sign_in_valid_until ?? null}
                          competitions={competitions}
                          returnTo="/admin/schools"
                        />
                      ),
                    }
                  : {}),
                actions: (
                  <div key="actions" className="flex gap-1.5">
                    <Link
                      href={`/admin/schools?edit=${s.id}`}
                      className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                    <form action={deleteSchool}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </form>
                  </div>
                ),
              }))}
            />
          )}
        </div>
      </div>
      <div className="mt-8 space-y-6">
        <InvitationCodeForm
          role="school"
          returnTo="/admin/schools"
          title="School / Dojo Invitation Code"
          idPrefix="school_code"
          codeExample="IKO-SCHOOL-TIER-USD10-2026-00001"
          competitions={competitions}
        />
        <InvitationCodeList
          role="school"
          returnTo="/admin/schools"
          codeExample="IKO-SCHOOL-TIER-USD10-2026-00001"
          competitions={competitions}
          editingId={params.editcode}
        />
      </div>
    </AdminShell>
  );
}
