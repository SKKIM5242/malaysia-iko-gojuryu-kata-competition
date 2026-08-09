import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import {
  updateCommunityStatus, saveReferee, deleteReferee, linkRefereeAccount, bulkUploadReferees,
  saveAutoAssignTerm, deleteAutoAssignTerm, bulkUploadAutoAssignTerms, generateRecordInvitationCode,
  linkRefereeToAccount, unlinkRefereeFromAccount,
} from "@/app/actions/admin";
import { AdminShell, Card, CertificateField, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDOB } from "@/components/ui";
import { shortTierName } from "@/lib/invitation-codes";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import SignInControlBox from "@/components/SignInControlBox";
import AccountLinkCell from "@/components/AccountLinkCell";
import InvitationCodeForm from "@/components/InvitationCodeForm";
import InvitationCodeList from "@/components/InvitationCodeList";
import InvitationCodeRunField from "@/components/InvitationCodeRunField";
import TierSlotsField from "@/components/TierSlotsField";
import IbanInput from "@/components/IbanInput";
import IbanConfirmCheckbox from "@/components/IbanConfirmCheckbox";
import BankDetailsNote from "@/components/BankDetailsNote";
import BankAccountNameField from "@/components/BankAccountNameField";
import { IBAN_CSV_NOTE } from "@/lib/bank";
import { REFEREE_DEPOSIT_USD } from "@/lib/payments";
import { NoCommaInput } from "@/components/NoCommaAddressField";
import DateOfBirthField from "@/components/DateOfBirthField";

import { REFERRAL_LABEL, REFERRAL_PLACEHOLDER, REFEREE_TITLE_OPTIONS } from "@/lib/reference-data";
import DateField from "@/components/DateField";

export const dynamic = "force-dynamic";

interface Referee {
  id: string; full_name: string; ic_passport: string; date_of_birth: string | null;
  gender: string | null; karate_rank: string | null; judge_title: string | null;
  judging_experience_count: number | null;
  school: string | null;
  email: string | null; phone: string | null; home_address: string | null;
  city_town: string | null; postcode: string | null; home_country: string | null;
  bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null;
  unassigned_forfeit_count: number; unassigned_not_forfeit_count: number;
  certificate_path: string | null; international_certificate_paths: string[] | null;
  invitation_code: string | null;
  referral_source: string | null;
  participating_tier_1_id: string | null;
  participating_tier_2_id: string | null;
  participating_tier_3_id: string | null;
  user_id: string | null;
  payment_status: string; status: string; created_at: string;
}

function StatusButtons({
  table, id, field, current, options,
}: {
  table: string; id: string; field: string; current: string; options: string[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <form key={o} action={updateCommunityStatus}>
          <input type="hidden" name="table" value={table} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="field" value={field} />
          <input type="hidden" name="value" value={o} />
          <input type="hidden" name="return_to" value="/admin/referees" />
          <button
            disabled={o === current}
            className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${
              o === current
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {o.replace("_", " ")}
          </button>
        </form>
      ))}
    </div>
  );
}

export default async function AdminReferees({
  searchParams,
}: {
  searchParams: Promise<{ editref?: string; editcode?: string; editterm?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Referees / Judges" active="/admin/referees">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const { data: referees } = await supabase.from("referees").select("*").order("created_at", { ascending: false });
  const refereeList = (referees as Referee[]) ?? [];
  const editing = params.editref ? refereeList.find((r) => r.id === params.editref) : undefined;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isAdminTier = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");
  const canBulkUpload = ["admin", "organizer"].includes(myProfile?.role ?? "");
  const canManageLink = ["admin", "organizer", "staff", "customer_support", "referee"].includes(myProfile?.role ?? "");

  const competitions = await getAllCompetitions();
  const refereeUserIds = refereeList.map((r) => r.user_id).filter((id): id is string => !!id);
  const { data: refereeLogins } =
    refereeUserIds.length > 0
      ? await supabase
          .from("profiles")
          .select("user_id, email, sign_in_count, sign_in_limit, sign_in_competition_id, sign_in_valid_from, sign_in_valid_until")
          .in("user_id", refereeUserIds)
      : { data: [] };
  const loginByUserId = new Map((refereeLogins ?? []).map((p) => [p.user_id as string, p]));

  // Same Assigned/Scored counts shown on the Judging page's Referee
  // Workload table, populated here too so this table doesn't need a
  // separate visit to Judging just to see workload at a glance.
  const [{ data: assignmentsData }, { data: scoresData }] =
    refereeUserIds.length > 0
      ? await Promise.all([
          supabase.from("referee_assignments").select("referee_user_id").in("referee_user_id", refereeUserIds),
          supabase.from("video_scores").select("referee_user_id").in("referee_user_id", refereeUserIds),
        ])
      : [{ data: [] }, { data: [] }];
  const assignedCountByUserId = new Map<string, number>();
  for (const a of assignmentsData ?? []) {
    const uid = a.referee_user_id as string;
    assignedCountByUserId.set(uid, (assignedCountByUserId.get(uid) ?? 0) + 1);
  }
  const scoredCountByUserId = new Map<string, number>();
  for (const s of scoresData ?? []) {
    const uid = s.referee_user_id as string;
    scoredCountByUserId.set(uid, (scoredCountByUserId.get(uid) ?? 0) + 1);
  }

  const { data: termsData } = await supabase.from("auto_assign_terms").select("*").order("position");
  const autoAssignTerms = termsData ?? [];
  const editingTerm = params.editterm ? autoAssignTerms.find((t) => t.id === params.editterm) : undefined;

  const certPaths = [
    ...refereeList.map((r) => r.certificate_path),
    ...refereeList.flatMap((r) => r.international_certificate_paths ?? []),
  ].filter(Boolean) as string[];
  const certUrls = new Map<string, string>();
  if (certPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("certificates").createSignedUrls(certPaths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) certUrls.set(s.path, s.signedUrl);
  }

  return (
    <AdminShell title="Referees / Judges" active="/admin/referees" flash={{ ok: params.ok, error: params.error }}>
      {canBulkUpload && (
        <div className="mb-8">
          <CsvUploadForm
            action={bulkUploadReferees}
            templateHref="/referees-template.csv"
            entityLabel="referee"
            note={`Dates use DD/MM/YYYY format. Certificates can't be uploaded via CSV — add one later via Edit. ${IBAN_CSV_NOTE}`}
          />
        </div>
      )}

      <div className="space-y-8">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit Referee/Judge" : "Add Referee/Judge"}</h2>
          <Card>
            <form key={editing?.id ?? "new"} action={saveReferee} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              {editing && <input type="hidden" name="role" value="referee" />}
              {editing && <input type="hidden" name="return_to" value={`/admin/referees?editref=${editing.id}`} />}
              <div>
                <label htmlFor="full_name" className={adminLabel}>Full name *</label>
                <input id="full_name" name="full_name" required defaultValue={editing?.full_name ?? ""} className={adminInput} />
              </div>
              <div>
                <label htmlFor="school" className={adminLabel}>School / organization *</label>
                <input id="school" name="school" required defaultValue={editing?.school ?? ""} className={adminInput} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ic_passport" className={adminLabel}>IC / Passport *</label>
                  <input id="ic_passport" name="ic_passport" required defaultValue={editing?.ic_passport ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="date_of_birth" className={adminLabel}>Date of Birth: DD/MM/YYYY *</label>
                  <DateOfBirthField id="date_of_birth" name="date_of_birth" defaultValueISO={editing?.date_of_birth ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="gender" className={adminLabel}>Gender *</label>
                  <select id="gender" name="gender" required defaultValue={editing?.gender ?? ""} className={adminInput}>
                    <option value="" disabled>— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="karate_rank" className={adminLabel}>Karate rank *</label>
                  <input id="karate_rank" name="karate_rank" required defaultValue={editing?.karate_rank ?? ""} className={adminInput} placeholder="e.g. Godan" />
                </div>
                <div>
                  <label htmlFor="judge_title" className={adminLabel}>Role *</label>
                  <select id="judge_title" name="judge_title" required defaultValue={editing?.judge_title ?? ""} className={adminInput}>
                    <option value="" disabled>— Select —</option>
                    {REFEREE_TITLE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="judging_experience_count" className={adminLabel}>
                    No. of times judging Kata competition *
                  </label>
                  <input id="judging_experience_count" name="judging_experience_count" type="number" min="0" step="1" required defaultValue={editing?.judging_experience_count ?? ""} className={adminInput} />
                </div>
                <div className="sm:col-span-2">
                  <CertificateField
                    required
                    currentUrl={editing?.certificate_path ? certUrls.get(editing.certificate_path) : undefined}
                  />
                </div>
                <div>
                  <label htmlFor="email" className={adminLabel}>Email *</label>
                  <input id="email" name="email" type="email" required defaultValue={editing?.email ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="phone" className={adminLabel}>Mobile / WhatsApp *</label>
                  <input id="phone" name="phone" required defaultValue={editing?.phone ?? ""} className={adminInput} placeholder="+60…" />
                </div>
                <div>
                  <InvitationCodeRunField
                    id="invitation_code"
                    role="referee"
                    competitions={competitions}
                    defaultValue={editing?.invitation_code}
                    label="Invitation code"
                  />
                </div>
                <div>
                  <label htmlFor="referral_source" className={adminLabel}>{REFERRAL_LABEL} <span className="font-normal text-neutral-400">(optional)</span></label>
                  <input id="referral_source" name="referral_source" defaultValue={editing?.referral_source ?? ""} className={adminInput} placeholder={REFERRAL_PLACEHOLDER} />
                </div>
                <TierSlotsField
                  competitions={competitions.map((c) => ({ id: c.id, name: c.name, fee: c.registration_fee_usd }))}
                  idPrefix="admin_referee_"
                  names={["participating_tier_1_id", "participating_tier_2_id", "participating_tier_3_id"]}
                  heading="Kata Competition Tier(s) this referee will judge"
                  helperNote="Tier 1 is required. The USD 100 deposit already covers all 3 tiers regardless of what's picked here — this is for scheduling only."
                  values={[editing?.participating_tier_1_id, editing?.participating_tier_2_id, editing?.participating_tier_3_id]}
                  inputCls={adminInput}
                  labelCls={adminLabel}
                />
                <div className="sm:col-span-2">
                  <label htmlFor="home_address" className={adminLabel}>
                    Home address *{" "}
                    <span className="font-normal text-neutral-400">(no comma &quot;,&quot; allowed in the box)</span>
                  </label>
                  <NoCommaInput id="home_address" defaultValue={editing?.home_address ?? ""} className={adminInput} />
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
                  <label htmlFor="home_country" className={adminLabel}>Home country *</label>
                  <input id="home_country" name="home_country" required defaultValue={editing?.home_country ?? (editing ? "" : "Malaysia")} className={adminInput} />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Bank details — deposit return &amp; referee/judge reward *
                </p>
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
                      fullNameFieldId="full_name"
                      defaultValue={editing?.bank_account_name ?? ""}
                      defaultFullName={editing?.full_name ?? ""}
                      className={adminInput}
                    />
                  </div>
                </div>
              </div>
              {editing && (
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                    Personal invitation code for this referee
                  </p>
                  <div className="mt-2">
                    <label htmlFor="pic_competition_id" className={adminLabel}>
                      Competition Tier <span className="font-normal text-neutral-400">(optional)</span>
                    </label>
                    <select id="pic_competition_id" name="pic_competition_id" defaultValue="" className={adminInput}>
                      <option value="">Select competition tier</option>
                      {competitions.map((c) => (
                        <option key={c.id} value={c.id}>{shortTierName(c.name)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <div>
                      <label htmlFor="pic_valid_from" className={adminLabel}>
                        Valid from <span className="font-normal text-neutral-400">(optional)</span>
                      </label>
                      <DateField id="pic_valid_from" name="pic_valid_from" required={false} className={adminInput} />
                    </div>
                    <div>
                      <label htmlFor="pic_valid_until" className={adminLabel}>
                        Valid until <span className="font-normal text-neutral-400">(optional)</span>
                      </label>
                      <DateField id="pic_valid_until" name="pic_valid_until" required={false} className={adminInput} />
                    </div>
                    <div>
                      <label htmlFor="pic_sign_in_limit" className={adminLabel}>
                        Sign-in limit <span className="font-normal text-neutral-400">(optional)</span>
                      </label>
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
                      : `Single-use, bound only to ${editing.email || "this referee's email"} — for creating that one login, not a shared code. Any of the three fields above left blank means no restriction on that front — sign-in access after account creation depends on whichever of the Valid from/until window and Sign-in limit you did set, whichever is reached first.`}
                  </p>
                </div>
              )}
              {!editing && (
                <p className="text-xs text-neutral-500">
                  With no invitation code, saving opens Stripe for the USD {REFEREE_DEPOSIT_USD}{" "}
                  referee/judge deposit. With a code the deposit is waived or settled another
                  way and the record is saved as pending.
                </p>
              )}
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Add Referee/Judge"}</button>
                {editing && (
                  <Link href="/admin/referees" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
          {editing && (
            <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Login account</p>
              {editing.user_id ? (
                <p className="mt-1 text-xs text-green-700">
                  Linked — commission calculations use this referee&apos;s actual judging activity.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-neutral-400">
                    Not linked yet. Auto-links at sign-up if they use the same email as above — use
                    the &quot;Link to account&quot; button in the table below if an account with that
                    exact email already exists, or enter a different sign-in email here if they
                    signed up with one that doesn&apos;t match this record.
                  </p>
                  <form action={linkRefereeAccount} className="mt-2 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="id" value={editing.id} />
                    <div>
                      <label htmlFor="login_email" className={adminLabel}>Their sign-in email</label>
                      <input id="login_email" name="login_email" type="email" className={adminInput} placeholder="name@example.com" />
                    </div>
                    <button type="submit" className={adminBtnSecondary}>Link account</button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">Referees / Judges — USD 100 Deposit</h2>
          {refereeList.length === 0 ? (
            <EmptyState>No referee registrations yet.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="id"
              downloadName="referees"
              columns={[
                { key: "full_name", label: "Name", width: 130, wrap: true },
                { key: "reference_id", label: "Reference ID", width: 100, wrap: true },
                { key: "ic_passport", label: "IC / Passport", width: 110, wrap: true },
                { key: "date_of_birth", label: "DOB", width: 85, wrap: true },
                { key: "gender", label: "Gender", width: 70, wrap: true },
                { key: "karate_rank", label: "Rank", width: 90, wrap: true },
                { key: "judge_title", label: "Role", width: 110, wrap: true },
                { key: "judging_experience_count", label: "Judging Experience", width: 90, wrap: true },
                { key: "assigned", label: "Assigned", width: 90, wrap: true },
                { key: "scored", label: "Scored", width: 110, wrap: true },
                { key: "unassigned_forfeit_count", label: "Unassigned - Forfeit", width: 95, wrap: true },
                { key: "unassigned_not_forfeit_count", label: "Unassigned Not Forfeit", width: 95, wrap: true },
                { key: "school", label: "School", width: 120, wrap: true },
                { key: "location", label: "Location", width: 150, wrap: true },
                { key: "email", label: "Email", width: 140, wrap: true },
                { key: "phone", label: "Phone", width: 100, wrap: true },
                { key: "bank", label: "Bank", width: 120, wrap: true },
                { key: "certificates", label: "Certificates", width: 100, wrap: true },
                { key: "invitation_code", label: "Invitation Code", width: 100, wrap: true },
                { key: "referral_source", label: "Referral", width: 120, wrap: true },
                { key: "deposit", label: "Deposit", width: 110, wrap: true },
                { key: "approval", label: "Approval", width: 110, wrap: true },
                { key: "account_link", label: "Account Link", width: 120, wrap: true },
                ...(isAdminTier ? [{ key: "sign_in_control", label: "Sign-in Control", width: 150, wrap: true }] : []),
                { key: "actions", label: "Actions", width: 90, wrap: true },
              ]}
              csvColumns={[
                { key: "full_name", label: "Name" },
                { key: "reference_id", label: "Reference ID" },
                { key: "ic_passport", label: "IC / Passport" },
                { key: "date_of_birth", label: "DOB" },
                { key: "gender", label: "Gender" },
                { key: "karate_rank", label: "Rank" },
                { key: "judge_title", label: "Role" },
                { key: "judging_experience_count", label: "Judging Experience" },
                { key: "assigned", label: "Assigned" },
                { key: "scored_text", label: "Scored" },
                { key: "unassigned_forfeit_count", label: "Unassigned - Forfeit" },
                { key: "unassigned_not_forfeit_count", label: "Unassigned Not Forfeit" },
                { key: "school", label: "School" },
                { key: "home_address", label: "Home Address" },
                { key: "city_town", label: "City / Town" },
                { key: "postcode", label: "Postcode" },
                { key: "home_country", label: "Country" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "bank_name", label: "Bank Name" },
                { key: "bank_account_no", label: "International Bank Account No. (IBAN)" },
                { key: "bank_account_name", label: "Bank Account Holder Name" },
                { key: "invitation_code", label: "Invitation Code" },
                { key: "referral_source", label: "Referral" },
                { key: "payment_status", label: "Deposit Status" },
                { key: "status", label: "Approval Status" },
              ]}
              rows={refereeList.map((r) => ({
                id: r.id,
                reference_id: r.id.slice(0, 8).toUpperCase(),
                full_name: r.full_name,
                ic_passport: r.ic_passport,
                date_of_birth: formatDOB(r.date_of_birth),
                gender: r.gender ?? "",
                karate_rank: r.karate_rank ?? "",
                judge_title: r.judge_title ?? "",
                judging_experience_count: String(r.judging_experience_count ?? 0),
                assigned: r.user_id ? String(assignedCountByUserId.get(r.user_id) ?? 0) : "No login yet",
                scored: (() => {
                  const assignedN = r.user_id ? (assignedCountByUserId.get(r.user_id) ?? 0) : 0;
                  const scoredN = r.user_id ? (scoredCountByUserId.get(r.user_id) ?? 0) : 0;
                  return r.user_id && assignedN > scoredN ? (
                    <>
                      {scoredN} <span className="ml-1.5 text-xs text-amber-600">({assignedN - scoredN} pending)</span>
                    </>
                  ) : (
                    String(scoredN)
                  );
                })(),
                scored_text: r.user_id ? String(scoredCountByUserId.get(r.user_id) ?? 0) : "0",
                unassigned_forfeit_count: String(r.unassigned_forfeit_count ?? 0),
                unassigned_not_forfeit_count: String(r.unassigned_not_forfeit_count ?? 0),
                school: r.school ?? "",
                location: [r.home_address, r.city_town, r.postcode, r.home_country].filter(Boolean).join(", "),
                bank: [r.bank_name, r.bank_account_no].filter(Boolean).join(" · "),
                home_address: r.home_address ?? "",
                city_town: r.city_town ?? "",
                postcode: r.postcode ?? "",
                home_country: r.home_country ?? "",
                email: r.email ?? "",
                phone: r.phone ?? "",
                bank_name: r.bank_name ?? "",
                bank_account_no: r.bank_account_no ?? "",
                bank_account_name: r.bank_account_name ?? "",
                payment_status: r.payment_status,
                status: r.status,
                certificates: (
                  <div key="certificates" className="flex flex-wrap items-center gap-2 text-xs">
                    {r.certificate_path && certUrls.get(r.certificate_path) ? (
                      <a href={certUrls.get(r.certificate_path)} target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-green-700 underline underline-offset-2">Rank cert</a>
                    ) : (
                      <span className="text-red-500">None</span>
                    )}
                    {(r.international_certificate_paths ?? []).map((path, i) => (
                      certUrls.get(path) ? (
                        <a key={path} href={certUrls.get(path)} target="_blank" rel="noopener noreferrer"
                          className="font-semibold text-blue-700 underline underline-offset-2">
                          Intl. {i + 1}
                        </a>
                      ) : null
                    ))}
                  </div>
                ),
                invitation_code: r.invitation_code ?? "",
                referral_source: r.referral_source ?? "",
                deposit: (
                  <StatusButtons key="deposit" table="referees" id={r.id} field="payment_status" current={r.payment_status}
                    options={["pending", "paid", "waived", "refunded", "forfeited"]} />
                ),
                approval: (
                  <StatusButtons key="approval" table="referees" id={r.id} field="status" current={r.status}
                    options={["pending", "approved", "rejected"]} />
                ),
                account_link: (
                  <AccountLinkCell
                    key="account_link"
                    linkedEmail={loginByUserId.get(r.user_id ?? "")?.email ?? null}
                    entityId={r.id}
                    idFieldName="referee_id"
                    linkAction={linkRefereeToAccount}
                    unlinkAction={unlinkRefereeFromAccount}
                    returnTo="/admin/referees"
                    canManage={canManageLink}
                  />
                ),
                ...(isAdminTier
                  ? {
                      sign_in_control: (
                        <SignInControlBox
                          key="sign_in_control"
                          userId={r.user_id}
                          signInCount={loginByUserId.get(r.user_id ?? "")?.sign_in_count ?? 0}
                          signInLimit={loginByUserId.get(r.user_id ?? "")?.sign_in_limit ?? null}
                          signInCompetitionId={loginByUserId.get(r.user_id ?? "")?.sign_in_competition_id ?? null}
                          signInValidFrom={loginByUserId.get(r.user_id ?? "")?.sign_in_valid_from ?? null}
                          signInValidUntil={loginByUserId.get(r.user_id ?? "")?.sign_in_valid_until ?? null}
                          competitions={competitions}
                          returnTo="/admin/referees"
                        />
                      ),
                    }
                  : {}),
                actions: (
                  <div key="actions" className="flex gap-1.5">
                    <Link
                      href={`/admin/referees?editref=${r.id}`}
                      className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                    <form action={deleteReferee}>
                      <input type="hidden" name="id" value={r.id} />
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
      {isAdminTier && (
        <div className="mt-8 space-y-4">
          <h2 className="text-lg font-bold">Auto-Assign Referee Terms &amp; Conditions</h2>
          <Card>
            <form action={saveAutoAssignTerm} className="flex flex-wrap items-end gap-3">
              {editingTerm && <input type="hidden" name="id" value={editingTerm.id} />}
              <div>
                <label htmlFor="term_position" className={adminLabel}>No. *</label>
                <input
                  id="term_position"
                  name="position"
                  type="number"
                  min="1"
                  required
                  defaultValue={editingTerm?.position ?? autoAssignTerms.length + 1}
                  className={`${adminInput} w-20`}
                />
              </div>
              <div className="min-w-[280px] flex-1">
                <label htmlFor="term_content" className={adminLabel}>
                  {editingTerm ? `Edit Term No. ${editingTerm.position}` : "New Term"} *
                </label>
                <input
                  id="term_content"
                  name="content"
                  required
                  defaultValue={editingTerm?.content ?? ""}
                  className={adminInput}
                  placeholder="e.g. Referees must declare a conflict of interest before judging their own student."
                />
              </div>
              <button type="submit" className={adminBtn}>{editingTerm ? "Save changes" : "Add term"}</button>
              {editingTerm && (
                <Link
                  href="/admin/referees"
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  Cancel
                </Link>
              )}
            </form>
          </Card>
          {canBulkUpload && (
            <CsvUploadForm
              action={bulkUploadAutoAssignTerms}
              templateHref="/auto-assign-terms-template.csv"
              entityLabel="term"
            />
          )}
          {autoAssignTerms.length === 0 ? (
            <EmptyState>No terms yet — add the first one above.</EmptyState>
          ) : (
            <FilterableTable
              rowKey="id"
              downloadName="auto-assign-terms"
              stickyColumns={2}
              firstColumnWidth={56}
              columns={[
                { key: "no", label: "No." },
                { key: "content", label: "Terms & Conditions", width: 600, wrap: true },
                { key: "actions", label: "Actions" },
              ]}
              csvColumns={[
                { key: "no", label: "Position" },
                { key: "content", label: "Content" },
              ]}
              rows={autoAssignTerms.map((t) => ({
                id: t.id,
                no: String(t.position),
                content: t.content,
                actions: (
                  <div key="actions" className="flex gap-1.5">
                    <Link
                      href={`/admin/referees?editterm=${t.id}`}
                      className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                    <form action={deleteAutoAssignTerm}>
                      <input type="hidden" name="id" value={t.id} />
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
      )}
      <div className="mt-8 space-y-6">
        <InvitationCodeForm
          role="referee"
          returnTo="/admin/referees"
          title="Referee / Judge Invitation Code"
          idPrefix="ref_code"
          codeExample="IKO-REFEREE-TIER-USD100-2026-00001"
          competitions={competitions}
        />
        <InvitationCodeList
          role="referee"
          returnTo="/admin/referees"
          codeExample="IKO-REFEREE-TIER-USD100-2026-00001"
          competitions={competitions}
          editingId={params.editcode}
        />
      </div>
    </AdminShell>
  );
}
