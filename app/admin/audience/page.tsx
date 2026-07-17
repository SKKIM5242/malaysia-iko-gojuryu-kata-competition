import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { getAllCompetitions } from "@/lib/admin-data";
import { updateCommunityStatus, createInvitationCode, createAudienceMember, bulkUploadAudience } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import SignInControlBox from "@/components/SignInControlBox";
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
  searchParams: Promise<{ ok?: string; error?: string }>;
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
      <div className="mb-8">
        <CsvUploadForm
          action={bulkUploadAudience}
          templateHref="/audience-template.csv"
          entityLabel="audience member"
        />
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Add Audience / Spectator</h2>
        <Card>
          <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">Audience invitation code</p>
            <form action={createInvitationCode} className="mt-2 flex flex-wrap items-end gap-3">
              <input type="hidden" name="role" value="audience" />
              <input type="hidden" name="return_to" value="/admin/audience" />
              <div>
                <label htmlFor="aud_max_uses" className={adminLabel}>Max uses (blank = unlimited)</label>
                <input id="aud_max_uses" name="max_uses" type="number" min="1" className={`${adminInput} w-40`} />
              </div>
              <div>
                <label htmlFor="aud_code_note" className={adminLabel}>Note (optional)</label>
                <input id="aud_code_note" name="note" className={adminInput} placeholder="e.g. VIP guests" />
              </div>
              <button type="submit" className={adminBtnSecondary}>Generate code</button>
            </form>
            <p className="mt-1 text-xs text-neutral-400">
              Waives the USD 10 sign-in fee for anyone who registers (or is added below) with the code.
              Manage or revoke codes in Admin → Accounts → Invitation codes.
            </p>
          </div>
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

      <h2 className="mb-3 text-lg font-bold">Audience / Spectators — USD 10 sign-in</h2>
      {!audiences || audiences.length === 0 ? (
        <EmptyState>No audience registrations yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="audience"
          columns={[
            { key: "reference_id", label: "Reference ID" },
            { key: "full_name", label: "Name" },
            { key: "contact", label: "Contact" },
            { key: "home_country", label: "Country" },
            { key: "invitation_code", label: "Code" },
            { key: "payment", label: "Payment" },
            { key: "telegram", label: "Telegram" },
            ...(isAdminTier ? [{ key: "sign_in_control", label: "Sign-in Control" }] : []),
          ]}
          csvColumns={[
            { key: "reference_id", label: "Reference ID" },
            { key: "full_name", label: "Name" },
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
    </AdminShell>
  );
}
