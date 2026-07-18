import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { toggleInvitationCode, deleteInvitationCode, bulkUploadInvitationCodes } from "@/app/actions/admin";
import { EmptyState } from "@/components/ui";
import FilterableTable from "@/components/FilterableTable";
import CsvUploadForm from "@/components/CsvUploadForm";
import InvitationCodeForm, { ROLE_LABELS } from "@/components/InvitationCodeForm";

/** Numbered listing of invitation codes (optionally scoped to one role) —
 * No. and Email stay pinned as the first two columns during horizontal
 * scroll, every column gets a tick-filter dropdown, and the list has CSV
 * download plus an Admin/Organizer-only CSV bulk upload. Edit opens the
 * full form above the table via the `editcode` query param; Delete and
 * Revoke/Activate act inline. */
export default async function InvitationCodeList({
  role,
  returnTo,
  codeExample,
  competitions,
  editingId,
}: {
  role?: string;
  returnTo: string;
  codeExample: string;
  competitions: Array<{ id: string; name: string }>;
  editingId?: string;
}) {
  const supabase = await createClient();
  let query = supabase.from("invitation_codes").select("*").order("created_at", { ascending: false });
  if (role) query = query.eq("role", role);
  const { data } = await query;
  const codes = data ?? [];
  const competitionNameById = new Map(competitions.map((c) => [c.id, c.name]));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: myProfile } = user
    ? await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const canBulkUpload = ["admin", "organizer"].includes(myProfile?.role ?? "");

  const editing = editingId ? codes.find((c) => c.id === editingId) : undefined;
  const editHref = (id: string) => `${returnTo}${returnTo.includes("?") ? "&" : "?"}editcode=${id}`;

  return (
    <div className="space-y-4">
      {editing && (
        <InvitationCodeForm
          role={role}
          returnTo={returnTo}
          idPrefix={`edit_${editing.id.slice(0, 8)}`}
          codeExample={codeExample}
          competitions={competitions}
          editing={{
            id: editing.id,
            code: editing.code,
            role: editing.role,
            note: editing.note,
            max_uses: editing.max_uses,
            email: editing.email,
            valid_from: editing.valid_from,
            valid_until: editing.valid_until,
            sign_in_limit: editing.sign_in_limit,
            competition_id: editing.competition_id,
          }}
          onCancelHref={returnTo}
        />
      )}
      {canBulkUpload && (
        <CsvUploadForm
          action={bulkUploadInvitationCodes}
          templateHref="/invitation-codes-template.csv"
          entityLabel="invitation code"
          note="competition_name must match an existing competition exactly; role must be one of the role keys in the template."
        />
      )}
      <h2 className="text-lg font-bold">{role ? "Codes For This Role" : "All Codes"}</h2>
      {codes.length === 0 ? (
        <EmptyState>No invitation codes yet.</EmptyState>
      ) : (
        <FilterableTable
          rowKey="id"
          downloadName="invitation-codes"
          stickyColumns={2}
          firstColumnWidth={56}
          columns={[
            { key: "no", label: "No." },
            { key: "email", label: "Email" },
            { key: "code", label: "Code" },
            ...(role ? [] : [{ key: "role", label: "Role" }]),
            { key: "competition", label: "Competition" },
            { key: "valid_from", label: "Valid From" },
            { key: "valid_until", label: "Valid Until" },
            { key: "sign_in_limit", label: "Sign-in Limit" },
            { key: "usage", label: "Used / Max" },
            { key: "note", label: "Note" },
            { key: "created_by", label: "Created By" },
            { key: "status", label: "Status" },
            { key: "actions", label: "Actions" },
          ]}
          csvColumns={[
            { key: "no", label: "No." },
            { key: "email", label: "Email" },
            { key: "code", label: "Code" },
            { key: "role", label: "Role" },
            { key: "competition", label: "Competition" },
            { key: "valid_from", label: "Valid From" },
            { key: "valid_until", label: "Valid Until" },
            { key: "sign_in_limit", label: "Sign-in Limit" },
            { key: "usage", label: "Used / Max" },
            { key: "note", label: "Note" },
            { key: "created_by", label: "Created By" },
            { key: "status", label: "Status" },
          ]}
          rows={codes.map((c, i) => ({
            id: c.id,
            no: String(i + 1),
            email: c.email ?? "",
            code: c.code,
            role: ROLE_LABELS[c.role] ?? c.role,
            competition: competitionNameById.get(c.competition_id) ?? "",
            valid_from: c.valid_from ?? "",
            valid_until: c.valid_until ?? "",
            sign_in_limit: c.sign_in_limit != null ? String(c.sign_in_limit) : "",
            usage: `${c.use_count}${c.max_uses ? ` / ${c.max_uses}` : ""}`,
            note: c.note ?? "",
            created_by: c.generated_by ?? "",
            status: c.active ? "Active" : "Revoked",
            actions: (
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={editHref(c.id)}
                  className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                >
                  Edit
                </Link>
                <form action={toggleInvitationCode}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="active" value={(!c.active).toString()} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button
                    className={`rounded px-2.5 py-1 text-xs font-semibold text-white ${
                      c.active ? "bg-amber-600 hover:bg-amber-500" : "bg-green-600 hover:bg-green-500"
                    }`}
                  >
                    {c.active ? "Revoke" : "Activate"}
                  </button>
                </form>
                <form action={deleteInvitationCode}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="return_to" value={returnTo} />
                  <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </form>
              </div>
            ),
          }))}
        />
      )}
    </div>
  );
}
