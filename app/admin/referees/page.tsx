import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { updateCommunityStatus, saveReferee, deleteReferee, createInvitationCode } from "@/app/actions/admin";
import { AdminShell, Card, CertificateField, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Referee {
  id: string; full_name: string; ic_passport: string; date_of_birth: string | null;
  gender: string | null; karate_rank: string | null; judging_experience_count: number | null;
  school: string | null;
  email: string | null; phone: string | null; home_address: string | null;
  city_town: string | null; home_country: string | null;
  bank_name: string | null; bank_account_no: string | null; bank_account_name: string | null;
  certificate_path: string | null; international_certificate_paths: string[] | null;
  invitation_code: string | null;
  payment_status: string; status: string; created_at: string;
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
          <input type="hidden" name="return_to" value="/admin/referees" />
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

export default async function AdminReferees({
  searchParams,
}: {
  searchParams: Promise<{ editref?: string; ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Referees / Judges" active="/admin/referees">
        <SetupNotice />
      </AdminShell>
    );
  }

  const supabase = await createClient();
  const { data: referees } = await supabase.from("referees").select("*").order("created_at", { ascending: false });
  const refereeList = (referees as Referee[]) ?? [];
  const editing = params.editref ? refereeList.find((r) => r.id === params.editref) : undefined;

  const certPaths = [
    ...refereeList.map((r) => r.certificate_path),
    ...refereeList.flatMap((r) => r.international_certificate_paths ?? []),
  ].filter(Boolean) as string[];
  const certUrls = new Map<string, string>();
  if (certPaths.length > 0) {
    const { data: signed } = await supabase.storage.from("certificates").createSignedUrls(certPaths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) certUrls.set(s.path, s.signedUrl);
  }

  return (
    <AdminShell title="Referees / Judges" active="/admin/referees" flash={{ ok: params.ok, error: params.error }}>
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Referee / Judge invitation code</h2>
        <Card>
          <form action={createInvitationCode} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="role" value="referee" />
            <input type="hidden" name="return_to" value="/admin/referees" />
            <div>
              <label htmlFor="ref_code_note" className={adminLabel}>Note (optional)</label>
              <input id="ref_code_note" name="note" className={adminInput} placeholder="e.g. July intake" />
            </div>
            <button type="submit" className={adminBtn}>Generate unlimited-use code</button>
          </form>
          <p className="mt-2 text-xs text-neutral-400">
            Waives the USD 100 deposit for anyone who signs up as Referee / Judge with the code — unlimited uses.
            Manage or deactivate codes in Admin → Accounts → Invitation codes.
          </p>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-bold">{editing ? "Edit referee / judge" : "Add referee / judge"}</h2>
          <Card>
            <form action={saveReferee} className="space-y-4">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <div>
                <label htmlFor="full_name" className={adminLabel}>Full name *</label>
                <input id="full_name" name="full_name" required defaultValue={editing?.full_name ?? ""} className={adminInput} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ic_passport" className={adminLabel}>IC / Passport *</label>
                  <input id="ic_passport" name="ic_passport" required defaultValue={editing?.ic_passport ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="date_of_birth" className={adminLabel}>Date of birth</label>
                  <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={editing?.date_of_birth ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="gender" className={adminLabel}>Gender</label>
                  <select id="gender" name="gender" defaultValue={editing?.gender ?? ""} className={adminInput}>
                    <option value="">— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="karate_rank" className={adminLabel}>Karate rank</label>
                  <input id="karate_rank" name="karate_rank" defaultValue={editing?.karate_rank ?? ""} className={adminInput} placeholder="e.g. Godan" />
                </div>
                <div>
                  <label htmlFor="judging_experience_count" className={adminLabel}>
                    No. of times judging Kata competition
                  </label>
                  <input id="judging_experience_count" name="judging_experience_count" type="number" min="0" step="1" defaultValue={editing?.judging_experience_count ?? ""} className={adminInput} />
                </div>
                <div className="sm:col-span-2">
                  <CertificateField
                    currentUrl={editing?.certificate_path ? certUrls.get(editing.certificate_path) : undefined}
                  />
                </div>
                <div>
                  <label htmlFor="school" className={adminLabel}>School / organisation</label>
                  <input id="school" name="school" defaultValue={editing?.school ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="email" className={adminLabel}>Email</label>
                  <input id="email" name="email" type="email" defaultValue={editing?.email ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="phone" className={adminLabel}>Mobile / WhatsApp</label>
                  <input id="phone" name="phone" defaultValue={editing?.phone ?? ""} className={adminInput} placeholder="+60…" />
                </div>
                <div>
                  <label htmlFor="invitation_code" className={adminLabel}>Invitation code</label>
                  <input id="invitation_code" name="invitation_code" defaultValue={editing?.invitation_code ?? ""} className={adminInput} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="home_address" className={adminLabel}>Home address</label>
                  <input id="home_address" name="home_address" defaultValue={editing?.home_address ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="city_town" className={adminLabel}>City / Town</label>
                  <input id="city_town" name="city_town" defaultValue={editing?.city_town ?? ""} className={adminInput} />
                </div>
                <div>
                  <label htmlFor="home_country" className={adminLabel}>Home country</label>
                  <input id="home_country" name="home_country" defaultValue={editing?.home_country ?? (editing ? "" : "Malaysia")} className={adminInput} />
                </div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500">
                  Bank details — deposit return &amp; referee/judge reward
                </p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="bank_name" className={adminLabel}>Bank name</label>
                    <input id="bank_name" name="bank_name" defaultValue={editing?.bank_name ?? ""} className={adminInput} />
                  </div>
                  <div>
                    <label htmlFor="bank_account_no" className={adminLabel}>Account no.</label>
                    <input id="bank_account_no" name="bank_account_no" defaultValue={editing?.bank_account_no ?? ""} className={adminInput} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="bank_account_name" className={adminLabel}>Account holder name</label>
                    <input id="bank_account_name" name="bank_account_name" defaultValue={editing?.bank_account_name ?? ""} className={adminInput} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className={adminBtn}>{editing ? "Save changes" : "Add referee / judge"}</button>
                {editing && (
                  <Link href="/admin/referees" className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50">
                    Cancel
                  </Link>
                )}
              </div>
            </form>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold">Referees / Judges — USD 100 deposit</h2>
          {refereeList.length === 0 ? (
            <EmptyState>No referee registrations yet.</EmptyState>
          ) : (
            <div className="space-y-3">
              {refereeList.map((r) => (
                <Card key={r.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-neutral-900">{r.full_name}</p>
                      <p className="font-mono text-xs text-neutral-400">{r.ic_passport}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {r.karate_rank ?? "—"} · {r.email}{r.phone ? ` · ${r.phone}` : ""}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {[r.home_address, r.city_town, r.home_country].filter(Boolean).join(", ") || "—"}
                      </p>
                      <p className="text-xs text-neutral-500">
                        Judged {r.judging_experience_count ?? 0} time{r.judging_experience_count === 1 ? "" : "s"} before
                      </p>
                      <p className="mt-0.5 text-xs">
                        {r.bank_name}
                        {r.bank_account_no ? <span className="font-mono"> · {r.bank_account_no}</span> : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {r.certificate_path && certUrls.get(r.certificate_path) ? (
                          <a href={certUrls.get(r.certificate_path)} target="_blank" rel="noopener noreferrer"
                            className="font-semibold text-green-700 underline underline-offset-2">Rank certificate</a>
                        ) : (
                          <span className="text-red-500">No rank certificate</span>
                        )}
                        {(r.international_certificate_paths ?? []).map((path, i) => (
                          certUrls.get(path) ? (
                            <a key={path} href={certUrls.get(path)} target="_blank" rel="noopener noreferrer"
                              className="font-semibold text-blue-700 underline underline-offset-2">
                              Intl. cert {i + 1}
                            </a>
                          ) : null
                        ))}
                        {r.invitation_code && (
                          <span className="font-mono text-purple-700">code: {r.invitation_code}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Link
                        href={`/admin/referees?editref=${r.id}`}
                        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                      >
                        Edit
                      </Link>
                      <form action={deleteReferee}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-neutral-100 pt-3">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Deposit</p>
                      <StatusButtons table="referees" id={r.id} field="payment_status" current={r.payment_status}
                        options={["pending", "paid", "waived", "refunded", "forfeited"]} />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Approval</p>
                      <StatusButtons table="referees" id={r.id} field="status" current={r.status}
                        options={["pending", "approved", "rejected"]} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
