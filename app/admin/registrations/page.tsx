import Link from "next/link";
import { getAllRegistrations, getAllCompetitions } from "@/lib/admin-data";
import { schemaReady } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { updatePaymentStatus, deleteRegistration } from "@/app/actions/admin";
import { AdminShell, adminBtnSecondary } from "@/components/admin";
import { CategoryName, EmptyState, SetupNotice, StatusBadge } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import InvitationCodeForm from "@/components/InvitationCodeForm";
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
  const [rows, competitions] = await Promise.all([getAllRegistrations(filter), getAllCompetitions()]);
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
          <InvitationCodeForm
            title="Generate Invitation Code"
            roleOptions={["audience", "referee", "school"]}
            returnTo={returnTo}
            idPrefix="cs_code"
            codeExample="IKO-AUD-2026"
            competitions={competitions}
          />
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
        <FilterableTable
          rowKey="id"
          downloadName="registrations"
          columns={[
            { key: "participant", label: "Participant" },
            { key: "ref", label: "Ref" },
            { key: "ic_passport", label: "IC / Passport" },
            { key: "category", label: "Category" },
            { key: "division", label: "Division" },
            { key: "school", label: "School" },
            { key: "payment_ref", label: "Payment ref" },
            { key: "status", label: "Status" },
            { key: "actions", label: "Actions" },
          ]}
          csvColumns={[
            { key: "participant", label: "Participant" },
            { key: "ref", label: "Reference ID" },
            { key: "ic_passport", label: "IC / Passport" },
            { key: "category_text", label: "Category" },
            { key: "division", label: "Division" },
            { key: "school", label: "School" },
            { key: "payment_ref", label: "Payment Reference" },
            { key: "status_text", label: "Status" },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            participant: r.participant?.full_name ?? "",
            ref: r.id.slice(0, 8).toUpperCase(),
            ic_passport: r.participant?.ic_passport ?? "",
            category: <CategoryName name={r.category?.name} />,
            category_text: r.category?.name ?? "",
            division: r.division ?? "",
            school: r.participant?.school?.name ?? "",
            payment_ref: r.payment_reference ?? "",
            status: <StatusBadge status={r.payment_status} />,
            status_text: r.payment_status,
            actions: canChangePayment ? (
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
            ),
          }))}
        />
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
