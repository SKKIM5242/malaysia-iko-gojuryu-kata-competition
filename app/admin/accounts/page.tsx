import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { setProfileApproval, publishAccessMatrixAnnouncement } from "@/app/actions/admin";
import { getAllCompetitions } from "@/lib/admin-data";
import { AdminShell, Card, adminBtn } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import InvitationCodeForm from "@/components/InvitationCodeForm";
import InvitationCodeList from "@/components/InvitationCodeList";
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
  searchParams: Promise<{ tab?: string; editcode?: string; ok?: string; error?: string }>;
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
      {tab === "codes" && <CodesTab editingId={params.editcode} />}
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
      <FilterableTable
        rowKey="resource_text"
        downloadName="access-matrix"
        columns={[
          { key: "resource", label: "Resource" },
          { key: "admin", label: "Admin" },
          { key: "organizer", label: "Organizer / Staff" },
          { key: "customerSupport", label: "Customer Support" },
          { key: "referee", label: "Referee / Judge" },
        ]}
        rows={ACCESS_MATRIX.map((row) => ({
          resource: row.note ? (
            <>
              {row.resource}
              <p className="mt-1 text-xs font-normal text-neutral-400">{row.note}</p>
            </>
          ) : (
            row.resource
          ),
          resource_text: row.resource,
          admin: row.admin,
          organizer: row.organizer,
          customerSupport: row.customerSupport,
          referee: row.referee,
        }))}
        csvColumns={[
          { key: "resource_text", label: "Resource" },
          { key: "admin", label: "Admin" },
          { key: "organizer", label: "Organizer / Staff" },
          { key: "customerSupport", label: "Customer Support" },
          { key: "referee", label: "Referee / Judge" },
        ]}
      />
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
      <h2 className="mb-1 text-lg font-bold">Referee &amp; Staff Accounts</h2>
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
        <FilterableTable
          rowKey="user_id"
          downloadName="staff-accounts"
          columns={[
            { key: "name", label: "Name" },
            { key: "role", label: "Role" },
            { key: "country", label: "Country" },
            { key: "email", label: "Email" },
            { key: "status", label: "Status" },
            { key: "actions", label: "Actions" },
          ]}
          csvColumns={[
            { key: "name", label: "Name" },
            { key: "role", label: "Role" },
            { key: "country", label: "Country" },
            { key: "email", label: "Email" },
            { key: "status_text", label: "Status" },
          ]}
          rows={profiles.map((p) => ({
            user_id: p.user_id,
            name: p.full_name ?? "",
            role: roleLabel[p.role] ?? p.role,
            country: p.country ?? "",
            email: p.email ?? "",
            status: (
              <span className={p.approved ? "font-semibold text-green-700" : "text-amber-600"}>
                {p.approved ? "Approved — unlimited sign-in" : "Pending"}
              </span>
            ),
            status_text: p.approved ? "Approved — unlimited sign-in" : "Pending",
            actions:
              p.role === "admin" ? (
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
              ),
          }))}
        />
      )}
    </div>
  );
}

async function CodesTab({ editingId }: { editingId?: string }) {
  const competitions = await getAllCompetitions();
  return (
    <div className="space-y-8">
      <InvitationCodeForm
        returnTo="/admin/accounts?tab=codes"
        idPrefix="central_code"
        codeExample="IKO-JUDGE-2026"
        competitions={competitions}
      />
      <InvitationCodeList
        returnTo="/admin/accounts?tab=codes"
        codeExample="IKO-JUDGE-2026"
        competitions={competitions}
        editingId={editingId}
      />
    </div>
  );
}

