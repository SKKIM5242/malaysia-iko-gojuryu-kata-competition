import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { updateCommunityStatus, createInvitationCode } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";

export const dynamic = "force-dynamic";

interface Audience {
  id: string; full_name: string; email: string | null; phone: string | null;
  home_country: string | null; invitation_code: string | null;
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

  return (
    <AdminShell title="Audience / Spectators" active="/admin/audience" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Audience invitation code</h2>
        <Card>
          <form action={createInvitationCode} className="flex flex-wrap items-end gap-3">
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
            <button type="submit" className={adminBtn}>Generate code</button>
          </form>
          <p className="mt-2 text-xs text-neutral-400">
            Waives the USD 10 sign-in fee for anyone who registers as Audience / Spectator with the code.
            Manage or deactivate codes in Admin → Accounts → Invitation codes.
          </p>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-bold">Audience / Spectators — USD 10 sign-in</h2>
      {!audiences || audiences.length === 0 ? (
        <EmptyState>No audience registrations yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          columns={[
            { key: "full_name", label: "Name" },
            { key: "contact", label: "Contact" },
            { key: "home_country", label: "Country" },
            { key: "invitation_code", label: "Code" },
            { key: "payment", label: "Payment" },
          ]}
          rows={(audiences as Audience[]).map((a) => ({
            id: a.id,
            full_name: a.full_name,
            contact: [a.email, a.phone].filter(Boolean).join(" · "),
            home_country: a.home_country ?? "",
            invitation_code: a.invitation_code ?? "",
            payment: (
              <StatusButtons table="audiences" id={a.id} field="payment_status" current={a.payment_status}
                options={["pending", "paid", "waived"]} />
            ),
          }))}
        />
      )}
    </AdminShell>
  );
}
