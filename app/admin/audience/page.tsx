import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import {
  updateCommunityStatus, saveAudienceMember, deleteAudienceMember, bulkUploadAudience,
  linkAudienceToAccount, unlinkAudienceFromAccount,
} from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { AUDIENCE_FEE_USD } from "@/lib/payments";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import SignInControlBox from "@/components/SignInControlBox";
import AccountLinkCell from "@/components/AccountLinkCell";
import GeneratePersonalCodeBox from "@/components/GeneratePersonalCodeBox";
import InvitationCodeForm from "@/components/InvitationCodeForm";
import InvitationCodeList from "@/components/InvitationCodeList";
import InvitationCodeRunField from "@/components/InvitationCodeRunField";
import { getTelegramLink } from "@/lib/telegram";

import { REFERRAL_LABEL, REFERRAL_PLACEHOLDER } from "@/lib/reference-data";

export const dynamic = "force-dynamic";

interface Audience {
  id: string; full_name: string; email: string | null; phone: string | null;
  home_country: string | null; invitation_code: string | null; support_referral: string | null;
  referral_source: string | null;
  user_id: string | null;
  payment_status: string; created_at: string;
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
          <input type="hidden" name="return_to" value="/admin/audience" />
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

export default async function AdminAudience({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; editcode?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Audience / Spectators" active="/admin/audience">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const { data: audiences } = await supabase.from("audiences").select("*").order("created_at", { ascending: false });
  const editing = params.edit ? (audiences as Audience[] | null)?.find((a) => a.id === params.edit) : undefined;
  const telegramLink = await getTelegramLink("audience");

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
  const audienceUserIds = ((audiences as Audience[]) ?? []).map((a) => a.user_id).filter((id): id is string => !!id);
  const { data: audienceLogins } =
    audienceUserIds.length > 0
      ? await supabase
          .from("profiles")
          .select("user_id, email, sign_in_count, sign_in_limit, sign_in_competition_id, sign_in_valid_from, sign_in_valid_until")
          .in("user_id", audienceUserIds)
      : { data: [] };
  const loginByUserId = new Map((audienceLogins ?? []).map((p) => [p.user_id as string, p]));

  return (
    <AdminShell title="Audience / Spectators" active="/admin/audience" flash={{ ok: params.ok, error: params.error }}>
      {canBulkUpload && (
        <div className="mb-8">
          <CsvUploadForm
            action={bulkUploadAudience}
            templateHref="/audience-template.csv"
            entityLabel="audience member"
          />
        </div>
      )}

      <div className="mb-8">
        <h2 className="mb-3 text-lg font-bold">{editing ? "Edit Audience / Spectator" : "Add Audience / Spectator"}</h2>
        <Card>
          <form key={editing?.id ?? "new"} action={saveAudienceMember} className="space-y-4">
            {editing && <input type="hidden" name="id" value={editing.id} />}
            {editing && <input type="hidden" name="return_to" value={`/admin/audience?edit=${editing.id}`} />}
            <div>
              <label htmlFor="aud_full_name" className={adminLabel}>Full name *</label>
              <input id="aud_full_name" name="full_name" required defaultValue={editing?.full_name ?? ""} className={adminInput} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="aud_email" className={adminLabel}>Email address *</label>
                <input id="aud_email" name="email" type="email" required defaultValue={editing?.email ?? ""} className={adminInput} />
              </div>
              <div>
                <label htmlFor="aud_phone" className={adminLabel}>Mobile phone *</label>
                <input id="aud_phone" name="phone" type="tel" required defaultValue={editing?.phone ?? ""} className={adminInput} placeholder="+60…" />
              </div>
              <div>
                <label htmlFor="aud_home_country" className={adminLabel}>Country</label>
                <input id="aud_home_country" name="home_country" defaultValue={editing?.home_country ?? (editing ? "" : "Malaysia")} className={adminInput} />
              </div>
              <div>
                <InvitationCodeRunField
                  id="aud_invitation_code"
                  role="audience"
                  competitions={competitions}
                  defaultValue={editing?.invitation_code}
                  placeholder="Waives the USD 10 fee"
                />
              </div>
              <div>
                <label htmlFor="aud_support_referral" className={adminLabel}>Participant Support referral (optional)</label>
                <input id="aud_support_referral" name="support_referral" defaultValue={editing?.support_referral ?? ""} className={adminInput} placeholder="e.g. Amy / KSK" />
              </div>
              <div>
                <label htmlFor="aud_referral_source" className={adminLabel}>{REFERRAL_LABEL} <span className="font-normal text-neutral-400">(optional)</span></label>
                <input id="aud_referral_source" name="referral_source" defaultValue={editing?.referral_source ?? ""} className={adminInput} placeholder={REFERRAL_PLACEHOLDER} />
              </div>
            </div>
            {!editing && (
              <p className="text-xs text-neutral-500">
                With no invitation code (or a code that fails to redeem), saving opens Stripe
                for the USD {AUDIENCE_FEE_USD} sign-in fee. A valid code marks the record
                waived and skips payment.
              </p>
            )}
            <div className="flex gap-2">
              <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Add Audience / Spectator"}</button>
              {editing && (
                <Link href="/admin/audience" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                  Cancel
                </Link>
              )}
            </div>
          </form>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-bold">Audience / Spectators — USD 10 Sign-In</h2>
      {!audiences || audiences.length === 0 ? (
        <EmptyState>No audience registrations yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="audience"
          columns={[
            { key: "full_name", label: "Name" },
            { key: "reference_id", label: "Reference ID" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "home_country", label: "Country" },
            { key: "invitation_code", label: "Code" },
            { key: "support_referral", label: "Support Referral" },
            { key: "referral_source", label: "Referral" },
            { key: "payment", label: "Payment" },
            { key: "telegram", label: "Telegram" },
            { key: "account_link", label: "Account Link" },
            ...(isAdminTier
              ? [
                  { key: "sign_in_control", label: "Sign-in Control" },
                  { key: "personal_code", label: "Personal Code" },
                ]
              : []),
            { key: "actions", label: "Actions" },
          ]}
          csvColumns={[
            { key: "full_name", label: "Name" },
            { key: "reference_id", label: "Reference ID" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "home_country", label: "Country" },
            { key: "invitation_code", label: "Code" },
            { key: "support_referral", label: "Support Referral" },
            { key: "referral_source", label: "Referral" },
            { key: "payment_status", label: "Payment Status" },
          ]}
          rows={(audiences as Audience[]).map((a) => ({
            id: a.id,
            reference_id: a.id.slice(0, 8).toUpperCase(),
            full_name: a.full_name,
            email: a.email ?? "",
            phone: a.phone ?? "",
            home_country: a.home_country ?? "",
            invitation_code: a.invitation_code ?? "",
            support_referral: a.support_referral ?? "",
            referral_source: a.referral_source ?? "",
            payment_status: a.payment_status,
            payment: (
              <StatusButtons key="payment" table="audiences" id={a.id} field="payment_status" current={a.payment_status}
                options={["pending", "paid", "waived"]} />
            ),
            telegram: telegramLink ? (
              <a
                key="telegram"
                href={telegramLink}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-[#229ED9]/40 px-2.5 py-1 text-xs font-semibold text-[#1c7fb5] hover:bg-[#229ED9]/10"
              >
                Join Telegram
              </a>
            ) : (
              <span key="telegram" className="text-neutral-400">—</span>
            ),
            account_link: (
              <AccountLinkCell
                key="account_link"
                linkedEmail={loginByUserId.get(a.user_id ?? "")?.email ?? null}
                entityId={a.id}
                idFieldName="audience_id"
                linkAction={linkAudienceToAccount}
                unlinkAction={unlinkAudienceFromAccount}
                returnTo="/admin/audience"
                canManage={canManageLink}
              />
            ),
            ...(isAdminTier
              ? {
                  sign_in_control: (
                    <SignInControlBox
                      key="sign_in_control"
                      userId={a.user_id}
                      signInCount={loginByUserId.get(a.user_id ?? "")?.sign_in_count ?? 0}
                      signInLimit={loginByUserId.get(a.user_id ?? "")?.sign_in_limit ?? null}
                      signInCompetitionId={loginByUserId.get(a.user_id ?? "")?.sign_in_competition_id ?? null}
                      signInValidFrom={loginByUserId.get(a.user_id ?? "")?.sign_in_valid_from ?? null}
                      signInValidUntil={loginByUserId.get(a.user_id ?? "")?.sign_in_valid_until ?? null}
                      competitions={competitions}
                      returnTo="/admin/audience"
                    />
                  ),
                  personal_code: (
                    <GeneratePersonalCodeBox
                      key="personal_code"
                      role="audience"
                      recordId={a.id}
                      email={a.email}
                      invitationCode={a.invitation_code}
                      competitions={competitions}
                      returnTo="/admin/audience"
                    />
                  ),
                }
              : {}),
            actions: (
              <div key="actions" className="flex gap-1.5">
                <Link
                  href={`/admin/audience?edit=${a.id}`}
                  className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  Edit
                </Link>
                <form action={deleteAudienceMember}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </form>
              </div>
            ),
          }))}
        />
      )}
      <div className="mt-8 space-y-6">
        <InvitationCodeForm
          role="audience"
          returnTo="/admin/audience"
          title="Audience / Spectator Invitation Code"
          idPrefix="aud_code"
          codeExample="IKO-AUDIENCE-TIER-USD10-2026-00001"
          competitions={competitions}
        />
        <InvitationCodeList
          role="audience"
          returnTo="/admin/audience"
          codeExample="IKO-AUDIENCE-TIER-USD10-2026-00001"
          competitions={competitions}
          editingId={params.editcode}
        />
      </div>
    </AdminShell>
  );
}
