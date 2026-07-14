import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { updateCommunityStatus, createStaffAccount } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";

export const dynamic = "force-dynamic";

interface StaffApp {
  id: string; full_name: string; email: string | null; phone: string | null;
  role_requested: string; message: string | null; status: string; created_at: string;
}

export default async function AdminOrganizers({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Admin / Organizer" active="/admin/organizers">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const isSuperAdmin = myProfile?.role === "admin";

  const { data: apps } = await supabase
    .from("staff_applications")
    .select("*")
    .in("role_requested", ["admin", "organizer"])
    .order("created_at", { ascending: false });
  const applications = (apps as StaffApp[]) ?? [];

  return (
    <AdminShell title="Admin / Organizer" active="/admin/organizers" flash={{ ok: params.ok, error: params.error }}>
      {isSuperAdmin ? (
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Create an Admin / Organizer account</h2>
          <Card>
            <form action={createStaffAccount} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="role" value="organizer" />
              <div>
                <label htmlFor="org_full_name" className={adminLabel}>Full name *</label>
                <input id="org_full_name" name="full_name" required className={adminInput} />
              </div>
              <div>
                <label htmlFor="org_email" className={adminLabel}>Email *</label>
                <input id="org_email" name="email" type="email" required className={adminInput} />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className={adminBtn}>Create Organizer account</button>
                <p className="mt-2 text-xs text-neutral-400">
                  Creates a real login instantly (no application or approval step) and emails them a
                  temporary password. Only the Super Admin can create Organizer accounts.
                </p>
              </div>
            </form>
          </Card>
        </div>
      ) : (
        <p className="mb-8 text-sm text-neutral-500">
          Only the Super Admin can create new Admin / Organizer accounts directly.
        </p>
      )}

      <h2 className="mb-3 text-lg font-bold">Admin / Organizer applications</h2>
      {applications.length === 0 ? (
        <EmptyState>No applications yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5">Contact</th>
                <th className="px-3 py-2.5">Role requested</th>
                <th className="px-3 py-2.5">Message</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {applications.map((s) => (
                <tr key={s.id} className="align-top hover:bg-neutral-50">
                  <td className="px-3 py-2.5 font-medium">{s.full_name}</td>
                  <td className="px-3 py-2.5 text-xs">{s.email}<br />{s.phone}</td>
                  <td className="px-3 py-2.5 capitalize">{s.role_requested.replace("_", " ")}</td>
                  <td className="max-w-[240px] px-3 py-2.5 text-xs text-neutral-500">{s.message ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {["pending", "approved", "rejected"].map((o) => (
                        <form key={o} action={updateCommunityStatus}>
                          <input type="hidden" name="table" value="staff_applications" />
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="field" value="status" />
                          <input type="hidden" name="value" value={o} />
                          <input type="hidden" name="return_to" value="/admin/organizers" />
                          <button
                            disabled={o === s.status}
                            className={`rounded border px-2 py-0.5 text-xs font-semibold capitalize ${
                              o === s.status
                                ? "border-neutral-900 bg-neutral-900 text-white"
                                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                            }`}
                          >
                            {o}
                          </button>
                        </form>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-neutral-400">
        Approving an application here does not create a login by itself — use the &quot;Create an Admin /
        Organizer account&quot; form above (Super Admin only) to actually grant access.
      </p>
    </AdminShell>
  );
}
