import { createClient } from "@/lib/supabase/server";
import { toggleInvitationCode, deleteInvitationCode } from "@/app/actions/admin";
import { Card } from "@/components/admin";
import { EmptyState } from "@/components/ui";
import InvitationCodeForm, { ROLE_LABELS } from "@/components/InvitationCodeForm";

/** Lists invitation codes (optionally scoped to one role), each with an
 * inline expandable Edit form (native <details>, no client JS needed),
 * Revoke/Activate, and Delete — plus who created it, which every listing
 * was previously missing. */
export default async function InvitationCodeList({
  role,
  returnTo,
  codeExample,
  competitions,
}: {
  role?: string;
  returnTo: string;
  codeExample: string;
  competitions: Array<{ id: string; name: string }>;
}) {
  const supabase = await createClient();
  let query = supabase.from("invitation_codes").select("*").order("created_at", { ascending: false });
  if (role) query = query.eq("role", role);
  const { data } = await query;
  const codes = data ?? [];
  const competitionNameById = new Map(competitions.map((c) => [c.id, c.name]));

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold">{role ? "Codes For This Role" : "All Codes"}</h2>
      {codes.length === 0 ? (
        <EmptyState>No invitation codes yet.</EmptyState>
      ) : (
        <div className="space-y-3">
          {codes.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono font-bold text-neutral-900">{c.code}</p>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {!role ? `${ROLE_LABELS[c.role] ?? c.role} · ` : ""}
                    {competitionNameById.get(c.competition_id) ?? "no competition on file"} · used{" "}
                    {c.use_count}
                    {c.max_uses ? ` / ${c.max_uses}` : ""}
                    {c.note ? ` · ${c.note}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    Created by {c.generated_by ?? "—"}
                    {c.email ? ` · bound to ${c.email}` : ""}
                    {c.valid_from || c.valid_until ? ` · valid ${c.valid_from ?? "…"} to ${c.valid_until ?? "…"}` : ""}
                    {c.sign_in_limit ? ` · sign-in limit ${c.sign_in_limit}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
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
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-neutral-500 hover:text-neutral-700">
                  Edit
                </summary>
                <div className="mt-3 border-t border-neutral-100 pt-3">
                  <InvitationCodeForm
                    role={role}
                    returnTo={returnTo}
                    idPrefix={`edit_${c.id}`}
                    codeExample={codeExample}
                    competitions={competitions}
                    editing={{
                      id: c.id,
                      code: c.code,
                      role: c.role,
                      note: c.note,
                      max_uses: c.max_uses,
                      email: c.email,
                      valid_from: c.valid_from,
                      valid_until: c.valid_until,
                      sign_in_limit: c.sign_in_limit,
                      competition_id: c.competition_id,
                    }}
                  />
                </div>
              </details>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
