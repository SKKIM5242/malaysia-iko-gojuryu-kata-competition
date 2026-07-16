import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { setProfileApproval, createInvitationCode, toggleInvitationCode, publishAccessMatrixAnnouncement } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import DownloadCsvButton from "@/components/DownloadCsvButton";
import { ACCESS_MATRIX } from "@/lib/access-matrix";

export const dynamic = "force-dynamic";

const TABS = [
  ["approvals", "Approvals"],
  ["codes", "Invitation codes"],
  ["access", "Access Matrix"],
] as const;

interface ProfileRow {
  user_id: string;
  role: string;
  full_name: string | null;
  country: string | null;
  email: string | null;
  approved: boolean;
  created_at: string;
}

export default async function AdminAccounts({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const tab = TABS.some(([t]) => t === params.tab) ? params.tab! : "approvals";
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Accounts" active="/admin/accounts">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();

  return (
    <AdminShell title="Accounts" active="/admin/accounts" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {TABS.map(([t, label]) => (
          <Link
            key={t}
            href={`/admin/accounts?tab=${t}`}
            className={`rounded-full border px-4 py-1.5 ${
              tab === t
                ? "border-red-700 bg-red-700 font-semibold text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "approvals" && <ApprovalsTab supabase={supabase} />}
      {tab === "codes" && <CodesTab supabase={supabase} />}
      {tab === "access" && <AccessMatrixTab />}
    </AdminShell>
  );
}

function AccessMatrixTab() {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Access Matrix</h2>
          <p className="text-sm text-neutral-500">
            What each role can actually do, read straight from the route gating and server-action
            guards in the code — not a description of intent.
          </p>
        </div>
        <form action={publishAccessMatrixAnnouncement}>
          <button type="submit" className={adminBtn}>Publish as announcement</button>
        </form>
      </div>
      <p className="mb-4 text-xs text-neutral-400">
        This creates a new draft announcement for you to review and publish — republish whenever
        access rules change so the posted copy stays current.
      </p>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">Resource</th>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2">Organizer / Staff</th>
              <th className="px-3 py-2">Customer Support</th>
              <th className="px-3 py-2">Referee / Judge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {ACCESS_MATRIX.map((row) => (
              <tr key={row.resource} className="align-top hover:bg-neutral-50">
                <td className="px-3 py-2 font-medium">
                  {row.resource}
                  {row.note && <p className="mt-1 text-xs font-normal text-neutral-400">{row.note}</p>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{row.admin}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.organizer}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.customerSupport}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.referee}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

async function ApprovalsTab({ supabase }: { supabase: Awaited<ReturnType<typeof createClient>> }) {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .neq("role", "participant")
    .order("approved", { ascending: true })
    .order("created_at", { ascending: false });
  const profiles = (data as ProfileRow[]) ?? [];
  const roleLabel: Record<string, string> = {
    referee: "Referee / Judge",
    staff: "Admin / Organizer / Customer Support",
    admin: "Admin (owner)",
  };

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Referee &amp; staff accounts</h2>
        {profiles.length > 0 && (
          <DownloadCsvButton
            filename="staff-accounts"
            rows={profiles.map((p) => ({
              Name: p.full_name ?? "",
              Role: roleLabel[p.role] ?? p.role,
              Country: p.country ?? "",
              Email: p.email ?? "",
              Status: p.approved ? "Approved" : "Pending",
            }))}
          />
        )}
      </div>
      <p className="mb-3 text-sm text-neutral-500">
        Assigning referees to recordings and viewing scores now lives on the{" "}
        <Link href="/admin/judging" className="font-semibold text-red-700 underline underline-offset-2">
          Judging
        </Link>{" "}
        page.
      </p>
      {profiles.length === 0 ? (
        <EmptyState>No referee or staff accounts have signed up yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {profiles.map((p) => (
                <tr key={p.user_id} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-medium">{p.full_name ?? "—"}</td>
                  <td className="px-4 py-3">{roleLabel[p.role] ?? p.role}</td>
                  <td className="px-4 py-3">{p.country ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{p.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={p.approved ? "font-semibold text-green-700" : "text-amber-600"}>
                      {p.approved ? "Approved — unlimited sign-in" : "Pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.role === "admin" ? (
                      <span className="text-xs text-neutral-400">Owner</span>
                    ) : (
                      <form action={setProfileApproval}>
                        <input type="hidden" name="user_id" value={p.user_id} />
                        <input type="hidden" name="approve" value={(!p.approved).toString()} />
                        <button
                          className={`rounded px-2.5 py-1 text-xs font-semibold text-white ${
                            p.approved ? "bg-amber-600 hover:bg-amber-500" : "bg-green-600 hover:bg-green-500"
                          }`}
                        >
                          {p.approved ? "Revoke" : "Approve"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const CODE_ROLE_LABEL: Record<string, string> = {
  school: "School / Dojo / Club",
  sensei: "Sensei / Shihan / Hanshi",
  participant: "Participant",
  referee: "Referee / Judge",
  audience: "Audience / Spectator",
  customer_support: "Customer Services Support",
  organizer: "Organizer",
  admin: "Admin",
  staff: "Admin / Organizer / Customer Support (legacy)",
  any: "Either",
};

async function CodesTab({ supabase }: { supabase: Awaited<ReturnType<typeof createClient>> }) {
  const { data } = await supabase.from("invitation_codes").select("*").order("created_at", { ascending: false });
  const codes = data ?? [];

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <h2 className="mb-3 text-lg font-bold">New invitation code</h2>
        <Card>
          <form action={createInvitationCode} className="space-y-4">
            <div>
              <label htmlFor="code" className={adminLabel}>Code *</label>
              <input id="code" name="code" required className={adminInput} placeholder="e.g. IKO-JUDGE-2026" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="code_role" className={adminLabel}>Role *</label>
                <select id="code_role" name="role" required defaultValue="referee" className={adminInput}>
                  <option value="school">School / Dojo / Club</option>
                  <option value="sensei">Sensei / Shihan / Hanshi</option>
                  <option value="participant">Participant</option>
                  <option value="referee">Referee / Judge</option>
                  <option value="audience">Audience / Spectator</option>
                  <option value="customer_support">Customer Services Support</option>
                  <option value="organizer">Organizer</option>
                  <option value="admin">Admin</option>
                  <option value="staff">Admin / Organizer / Customer Support (legacy)</option>
                  <option value="any">Either</option>
                </select>
              </div>
              <div>
                <label htmlFor="max_uses" className={adminLabel}>Max uses (blank = unlimited)</label>
                <input id="max_uses" name="max_uses" type="number" min="1" className={adminInput} />
              </div>
            </div>
            <div>
              <label htmlFor="note" className={adminLabel}>Note</label>
              <input id="note" name="note" className={adminInput} placeholder="e.g. Panel of 5 judges, July intake" />
            </div>
            <button type="submit" className={adminBtn}>Create code</button>
            <p className="text-xs text-neutral-400">
              Referee/Judge and Audience/Spectator codes waive their fee and activate instantly at
              public sign-up — no approval step. School and Sensei codes waive the same way from
              those pages&apos; own invitation-code box. Participant, Organizer, Customer Services
              Support, and Admin codes are record-keeping only for now — noting which code a
              manually-added account was given — since those roles have no public self-signup.
            </p>
          </form>
        </Card>
      </div>
      <div>
        <h2 className="mb-3 text-lg font-bold">All codes</h2>
        {codes.length === 0 ? (
          <EmptyState>No invitation codes yet.</EmptyState>
        ) : (
          <div className="space-y-3">
            {codes.map((c) => (
              <Card key={c.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono font-bold text-neutral-900">{c.code}</p>
                    <p className="mt-0.5 text-sm text-neutral-500">
                      {CODE_ROLE_LABEL[c.role] ?? c.role} · used {c.use_count}{c.max_uses ? ` / ${c.max_uses}` : " (unlimited)"}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      Generated by {c.generated_by ?? "—"}
                    </p>
                  </div>
                  <form action={toggleInvitationCode}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value={(!c.active).toString()} />
                    <button
                      className={`rounded px-2.5 py-1 text-xs font-semibold text-white ${
                        c.active ? "bg-amber-600 hover:bg-amber-500" : "bg-green-600 hover:bg-green-500"
                      }`}
                    >
                      {c.active ? "Revoke" : "Activate"}
                    </button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

