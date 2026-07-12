import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { updateCommunityStatus } from "@/app/actions/admin";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Referee {
  id: string; full_name: string; ic_passport: string; karate_rank: string | null;
  email: string | null; phone: string | null; home_country: string | null;
  bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null;
  certificate_path: string | null; invitation_code: string | null;
  payment_status: string; status: string; created_at: string;
}
interface Audience {
  id: string; full_name: string; email: string | null; phone: string | null;
  home_country: string | null; invitation_code: string | null;
  payment_status: string; created_at: string;
}
interface StaffApp {
  id: string; full_name: string; email: string | null; phone: string | null;
  role_requested: string; message: string | null; status: string; created_at: string;
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

export default async function AdminCommunity({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Community" active="/admin/community">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const [{ data: referees }, { data: audiences }, { data: staff }] = await Promise.all([
    supabase.from("referees").select("*").order("created_at", { ascending: false }),
    supabase.from("audiences").select("*").order("created_at", { ascending: false }),
    supabase.from("staff_applications").select("*").order("created_at", { ascending: false }),
  ]);

  const certPaths = ((referees as Referee[]) ?? []).map((r) => r.certificate_path).filter(Boolean) as string[];
  const certUrls = new Map<string, string>();
  if (certPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("certificates").createSignedUrls(certPaths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) certUrls.set(s.path, s.signedUrl);
  }

  return (
    <AdminShell title="Community" active="/admin/community" flash={{ ok: params.ok, error: params.error }}>
      <h2 className="mb-3 text-lg font-bold">Referees / Judges — USD 100 deposit</h2>
      {!referees || referees.length === 0 ? (
        <EmptyState>No referee registrations yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5">Rank</th>
                <th className="px-3 py-2.5">Contact</th>
                <th className="px-3 py-2.5">Payout bank</th>
                <th className="px-3 py-2.5">Cert / Code</th>
                <th className="px-3 py-2.5">Deposit</th>
                <th className="px-3 py-2.5">Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(referees as Referee[]).map((r) => (
                <tr key={r.id} className="align-top hover:bg-neutral-50">
                  <td className="px-3 py-2.5">
                    <span className="font-medium">{r.full_name}</span>
                    <span className="block font-mono text-xs text-neutral-400">{r.ic_passport}</span>
                  </td>
                  <td className="px-3 py-2.5">{r.karate_rank ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.email}<br />{r.phone} · {r.home_country}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.bank_name}
                    <span className="block font-mono text-neutral-500">{r.bank_account_no}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.certificate_path && certUrls.get(r.certificate_path) ? (
                      <a href={certUrls.get(r.certificate_path)} target="_blank" rel="noopener noreferrer"
                        className="font-semibold text-green-700 underline underline-offset-2">Certificate</a>
                    ) : "—"}
                    {r.invitation_code && (
                      <span className="block font-mono text-purple-700">code: {r.invitation_code}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusButtons table="referees" id={r.id} field="payment_status" current={r.payment_status}
                      options={["pending", "paid", "waived", "refunded", "forfeited"]} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusButtons table="referees" id={r.id} field="status" current={r.status}
                      options={["pending", "approved", "rejected"]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 mb-3 text-lg font-bold">Audience / Spectators — USD 10 sign-in</h2>
      {!audiences || audiences.length === 0 ? (
        <EmptyState>No audience registrations yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5">Contact</th>
                <th className="px-3 py-2.5">Country</th>
                <th className="px-3 py-2.5">Code</th>
                <th className="px-3 py-2.5">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(audiences as Audience[]).map((a) => (
                <tr key={a.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2.5 font-medium">{a.full_name}</td>
                  <td className="px-3 py-2.5 text-xs">{a.email}{a.phone ? ` · ${a.phone}` : ""}</td>
                  <td className="px-3 py-2.5">{a.home_country ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{a.invitation_code ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <StatusButtons table="audiences" id={a.id} field="payment_status" current={a.payment_status}
                      options={["pending", "paid", "waived"]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 mb-3 text-lg font-bold">Admin / Organizer / Customer Support applications</h2>
      {!staff || staff.length === 0 ? (
        <EmptyState>No applications yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5">Contact</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5">Message</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(staff as StaffApp[]).map((s) => (
                <tr key={s.id} className="align-top hover:bg-neutral-50">
                  <td className="px-3 py-2.5 font-medium">{s.full_name}</td>
                  <td className="px-3 py-2.5 text-xs">{s.email}<br />{s.phone}</td>
                  <td className="px-3 py-2.5 capitalize">{s.role_requested.replace("_", " ")}</td>
                  <td className="max-w-[240px] px-3 py-2.5 text-xs text-neutral-500">{s.message ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <StatusButtons table="staff_applications" id={s.id} field="status" current={s.status}
                      options={["pending", "approved", "rejected"]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-xs text-neutral-400">
        Approving a staff application does not grant admin access by itself — create their login in
        the Supabase dashboard (Authentication → Users) once approved.
      </p>
    </AdminShell>
  );
}
