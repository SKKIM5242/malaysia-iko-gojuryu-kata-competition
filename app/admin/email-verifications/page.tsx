import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { markEmailVerified, resendVerificationEmail } from "@/app/actions/email-verification";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice, formatDateTime } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";

export const dynamic = "force-dynamic";

interface EmailVerificationRow {
  id: string;
  email: string;
  role: string | null;
  sent_at: string;
  verified_at: string | null;
  created_at: string;
}

export default async function AdminEmailVerifications({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Email Verifications" active="/admin/email-verifications">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("email_verifications")
    .select("id, email, role, sent_at, verified_at, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = (data as EmailVerificationRow[]) ?? [];
  const pendingCount = rows.filter((r) => !r.verified_at).length;

  return (
    <AdminShell title="Email Verifications" active="/admin/email-verifications" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-4 text-sm text-neutral-500">
        Every new account gets a one-time verification email when it&apos;s created. An account
        with no row here predates this feature and is treated as verified — only a row shown as
        &quot;Pending&quot; below is actually blocked from signing in.{" "}
        <strong>{pendingCount} pending</strong> of {rows.length} total.
      </p>
      {rows.length === 0 ? (
        <EmptyState>No verification emails sent yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="email-verifications"
          columns={[
            { key: "email", label: "Email" },
            { key: "role", label: "Role" },
            { key: "sent_at", label: "Sent" },
            { key: "status", label: "Status" },
            { key: "actions", label: "Actions" },
          ]}
          csvColumns={[
            { key: "email", label: "Email" },
            { key: "role", label: "Role" },
            { key: "sent_at", label: "Sent" },
            { key: "status_text", label: "Status" },
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            email: r.email,
            role: r.role ?? "—",
            sent_at: formatDateTime(r.sent_at),
            status_text: r.verified_at ? `Verified ${r.verified_at.slice(0, 10)}` : "Pending",
            status: r.verified_at ? (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                Verified {r.verified_at.slice(0, 10)}
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                Pending
              </span>
            ),
            actions: r.verified_at ? null : (
              <div className="flex flex-wrap gap-1">
                <form action={resendVerificationEmail}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="rounded border border-neutral-300 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
                    Resend
                  </button>
                </form>
                <form action={markEmailVerified}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="rounded border border-green-300 px-2 py-0.5 text-xs font-semibold text-green-700 hover:bg-green-50">
                    Mark verified
                  </button>
                </form>
              </div>
            ),
          }))}
        />
      )}
    </AdminShell>
  );
}
