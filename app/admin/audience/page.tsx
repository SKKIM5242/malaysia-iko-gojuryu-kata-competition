import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { updateCommunityStatus, createAudienceMember, bulkUploadAudience } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import SignInControlBox from "@/components/SignInControlBox";
import InvitationCodeForm from "@/components/InvitationCodeForm";
import InvitationCodeList from "@/components/InvitationCodeList";
import { getTelegramLink } from "@/lib/telegram";

export const dynamic = "force-dynamic";

interface Audience {
  id: string; full_name: string; email: string | null; phone: string | null;
  home_country: string | null; invitation_code: string | null;
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
  searchParams: Promise<{ editcode?: string; ok?: string; error?: string }>;
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
  const telegramLink = getTelegramLink("audience");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isAdminTier = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");
  const canBulkUpload = ["admin", "organizer"].includes(myProfile?.role ?? "");

  const competitions = await getAllCompetitions();
  const audienceUserIds = ((audiences as Audience[]) ?? []).map((a) => a.user_id).filter((id): id is string => !!id);
  const { data: audienceLogins } =
    audienceUserIds.length > 0
      ? await supabase
          .from("profiles")
          .select("user_id, sign_in_count, sign_in_limit, sign_in_competition_id, sign_in_valid_from, sign_in_valid_until")
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
        <h2 className="mb-3 text-lg font-bold">Add Audience / Spectator</h2>
        <Card>
          <form action={createAudienceMember} className="space-y-4">
            <div>
              <label htmlFor="aud_full_name" className={adminLabel}>Full name *</label>
              <input id="aud_full_name" name="full_name" required className={adminInput} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="aud_email" className={adminLabel}>Email address *</label>
                <input id="aud_email" name="email" type="email" required className={adminInput} />
              </div>
              <div>
                <label htmlFor="aud_phone" className={adminLabel}>Mobile phone *</label>
                <input id="aud_phone" name="phone" type="tel" required className={adminInput} placeholder="+60…" />
              </div>
              <div>
                <label htmlFor="aud_home_country" className={adminLabel}>Country</label>
                <input id="aud_home_country" name="home_country" defaultValue="Malaysia" className={adminInput} />
              </div>
              <div>
                <label htmlFor="aud_invitation_code" className={adminLabel}>Invitation code (optional)</label>
                <input id="aud_invitation_code" name="invitation_code" className={adminInput} placeholder="Waives the USD 10 fee" />
              </div>
            </div>
            <button type="submit" className={adminBtn}>Add Audience / Spectator</button>
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
            { key: "contact", label: "Contact" },
            { key: "home_country", label: "Country" },
            { key: "invitation_code", label: "Code" },
            { key: "payment", label: "Payment" },
            { key: "telegram", label: "Telegram" },
            ...(isAdminTier ? [{ key: "sign_in_control", label: "Sign-in Control" }] : []),
          ]}
          csvColumns={[
            { key: "full_name", label: "Name" },
            { key: "reference_id", label: "Reference ID" },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "home_country", label: "Country" },
            { key: "invitation_code", label: "Code" },
            { key: "payment_status", label: "Payment Status" },
          ]}
          rows={(audiences as Audience[]).map((a) => ({
            id: a.id,
            reference_id: a.id.slice(0, 8).toUpperCase(),
            full_name: a.full_name,
            contact: [a.email, a.phone].filter(Boolean).join(" · "),
            email: a.email ?? "",
            phone: a.phone ?? "",
            home_country: a.home_country ?? "",
            invitation_code: a.invitation_code ?? "",
            payment_status: a.payment_status,
            payment: (
              <StatusButtons table="audiences" id={a.id} field="payment_status" current={a.payment_status}
                options={["pending", "paid", "waived"]} />
            ),
            telegram: telegramLink ? (
              <a
                href={telegramLink}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-[#229ED9]/40 px-2.5 py-1 text-xs font-semibold text-[#1c7fb5] hover:bg-[#229ED9]/10"
              >
                Join Telegram
              </a>
            ) : (
              <span className="text-neutral-400">—</span>
            ),
            ...(isAdminTier
              ? {
                  sign_in_control: (
                    <SignInControlBox
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
                }
              : {}),
          }))}
        />
      )}
      <div className="mt-8 space-y-6">
        <InvitationCodeForm
          role="audience"
          returnTo="/admin/audience"
          title="Audience / Spectator Invitation Code"
          idPrefix="aud_code"
          codeExample="IKO-AUD-2026"
          competitions={competitions}
        />
        <InvitationCodeList
          role="audience"
          returnTo="/admin/audience"
          codeExample="IKO-AUD-2026"
          competitions={competitions}
          editingId={params.editcode}
        />
      </div>
    </AdminShell>
  );
}
