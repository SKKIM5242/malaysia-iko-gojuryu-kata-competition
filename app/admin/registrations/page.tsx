import Link from "next/link";
import { getAllRegistrations } from "@/lib/admin-data";
import { schemaReady } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { updatePaymentStatus, deleteRegistration, createInvitationCode } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminBtnSecondary, adminInput, adminLabel } from "@/components/admin";
import { CategoryName, EmptyState, SetupNotice, StatusBadge } from "@/components/ui";
import type { PaymentStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES: Array<PaymentStatus | "all"> = ["all", "pending", "paid", "rejected"];

export default async function AdminRegistrations({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Registrations" active="/admin/registrations">
        <SetupNotice />
      </AdminShell>
    );
  }

  const filter =
    params.status && ["pending", "paid", "rejected"].includes(params.status)
      ? (params.status as PaymentStatus)
      : undefined;
  const rows = await getAllRegistrations(filter);
  const returnTo = `/admin/registrations${filter ? `?status=${filter}` : ""}`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isCustomerSupport = myProfile?.role === "customer_support";
  const isReferee = myProfile?.role === "referee";
  const canChangePayment = !isReferee;
  const canDelete = !isCustomerSupport && !isReferee;

  return (
    <AdminShell
      title="Registrations"
      active="/admin/registrations"
      flash={{ ok: params.ok, error: params.error }}
    >
      {isCustomerSupport && (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-bold">Generate invitation code</h2>
          <Card>
            <form action={createInvitationCode} className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="cs_code_role" className={adminLabel}>For</label>
                <select id="cs_code_role" name="role" defaultValue="audience" className={adminInput}>
                  <option value="audience">Audience / Spectator</option>
                  <option value="referee">Referee / Judge</option>
                  <option value="school">School / Dojo &amp; Sensei</option>
                </select>
              </div>
              <div>
                <label htmlFor="cs_max_uses" className={adminLabel}>Max uses (blank = unlimited)</label>
                <input id="cs_max_uses" name="max_uses" type="number" min="1" className={`${adminInput} w-40`} />
              </div>
              <input type="hidden" name="return_to" value={returnTo} />
              <button type="submit" className={adminBtn}>Generate code</button>
            </form>
          </Card>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => {
          const href = s === "all" ? "/admin/registrations" : `/admin/registrations?status=${s}`;
          const isActive = (s === "all" && !filter) || s === filter;
          return (
            <Link
              key={s}
              href={href}
              className={`rounded-full border px-4 py-1.5 capitalize ${
                isActive
                  ? "border-red-700 bg-red-700 font-semibold text-white"
                  : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {s}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState>No registrations{filter ? ` with status "${filter}"` : ""} yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3">Ref</th>
                <th className="px-4 py-3">Participant</th>
                <th className="px-4 py-3">IC / Passport</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Division</th>
                <th className="px-4 py-3">School</th>
                <th className="px-4 py-3">Payment ref</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-middle hover:bg-neutral-50">
                  <td className="px-4 py-3 font-mono text-xs">{r.id.slice(0, 8).toUpperCase()}</td>
                  <td className="px-4 py-3 font-medium">{r.participant?.full_name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.participant?.ic_passport ?? "—"}</td>
                  <td className="max-w-[200px] truncate px-4 py-3" title={r.category?.name ?? undefined}>
                    <CategoryName name={r.category?.name} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs">{r.division ?? "—"}</td>
                  <td className="max-w-[180px] truncate px-4 py-3" title={r.participant?.school?.name ?? undefined}>
                    {r.participant?.school?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.payment_reference ?? "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.payment_status} /></td>
                  <td className="px-4 py-3">
                    {canChangePayment ? (
                      <div className="flex flex-wrap gap-1.5">
                        {r.payment_status !== "paid" && (
                          <form action={updatePaymentStatus}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value="paid" />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <button className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-500">
                              Mark Paid
                            </button>
                          </form>
                        )}
                        {r.payment_status !== "rejected" && (
                          <form action={updatePaymentStatus}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value="rejected" />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <button className="rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500">
                              Reject
                            </button>
                          </form>
                        )}
                        {r.payment_status !== "pending" && (
                          <form action={updatePaymentStatus}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="status" value="pending" />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <button className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                              Set Pending
                            </button>
                          </form>
                        )}
                        {canDelete && (
                          <form action={deleteRegistration}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <button className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                              Delete
                            </button>
                          </form>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-400">View only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-neutral-400">
        Mark Paid only after sighting the bank transfer confirmation. Every change is written to the audit log.
      </p>
      <div className="mt-2">
        <Link href="/participants" className={adminBtnSecondary + " inline-block"}>
          View public participants list →
        </Link>
      </div>
    </AdminShell>
  );
}
