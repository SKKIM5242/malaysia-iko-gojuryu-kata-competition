import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { saveCertificateSettings, publishWinnersNow, saveCertificateDate } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { EmptyState, SetupNotice, formatDate } from "@/components/ui";
import CertificateUploadField from "@/components/CertificateUploadField";
import DateField from "@/components/DateField";
import { winnersRevealDate, winnersRevealDateFor } from "@/lib/winners";
import type { Competition } from "@/lib/types";

export const dynamic = "force-dynamic";

// Forces the Template Preview thumbnails onto a brand-new URL on every
// deploy, so a browser that cached an old design under next/og's original
// (since-overridden) 1-year Cache-Control can never keep serving it — a
// same-URL "no-store" header only stops *future* staleness, it can't
// invalidate a copy a browser already saved before that header existed.
const CERT_CACHE_BUST = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev";

const CERT_KINDS: Array<{ key: string; kind: string; label: string; note: string; query?: string }> = [
  { key: "winner-1", kind: "winner", label: "Winner — 1st Place", note: "Gold accent + gold medal.", query: "?rank=1" },
  { key: "winner-2", kind: "winner", label: "Winner — 2nd Place", note: "Silver accent + silver medal.", query: "?rank=2" },
  { key: "winner-3", kind: "winner", label: "Winner — 3rd Place", note: "Bronze accent + bronze medal.", query: "?rank=3" },
  { key: "participant", kind: "participant", label: "Participant", note: "Every other paid, non-winning participant." },
  { key: "referee", kind: "referee", label: "Referee / Judge", note: "For judging a competition tier." },
  { key: "sensei", kind: "sensei", label: "Sensei", note: "For a sensei whose students competed." },
  { key: "school", kind: "school", label: "School / Dojo", note: "For a school whose students competed." },
  { key: "support", kind: "support", label: "Support", note: "One per revealed tier, same as Referee/Sensei/School." },
];

export default async function AdminCertificates({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const params = await searchParams;
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Certificates" active="/admin/certificates">
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
  const canManage = ["admin", "organizer", "staff"].includes(myProfile?.role ?? "");

  const { data: settings } = await supabase.from("certificate_settings").select("*").eq("id", true).maybeSingle();
  const signatureUrl = settings?.signature_path
    ? supabase.storage.from("branding").getPublicUrl(settings.signature_path as string).data.publicUrl
    : null;
  const stampUrl = settings?.stamp_path
    ? supabase.storage.from("branding").getPublicUrl(settings.stamp_path as string).data.publicUrl
    : null;

  const { data: competitionsData } = await supabase
    .from("competitions")
    .select("*")
    .order("registration_fee_usd", { ascending: true, nullsFirst: true });
  const competitions = (competitionsData as Competition[]) ?? [];

  return (
    <AdminShell title="Certificates" active="/admin/certificates" flash={{ ok: params.ok, error: params.error }}>
      <p className="mb-6 max-w-3xl text-sm text-neutral-500">
        The signature, stamp/seal, and signer name/title set here appear on every certificate the
        system generates — Winner, Participant, Referee/Judge, Sensei, School, and Support. Nothing
        is pre-generated or stored: every download (from here or from a signed-in account&apos;s
        &quot;Your Certificate&quot; box) renders fresh from live data.
      </p>

      {canManage ? (
        <>
          <h2 className="mb-3 text-lg font-bold">Certificate Settings</h2>
          <Card>
            <form action={saveCertificateSettings} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="signer_name" className={adminLabel}>Signer name</label>
                  <input
                    id="signer_name" name="signer_name" defaultValue={settings?.signer_name ?? ""}
                    className={adminInput} placeholder="e.g. Sensei Ahmad Bin Ismail"
                  />
                </div>
                <div>
                  <label htmlFor="signer_title" className={adminLabel}>Signer title</label>
                  <input
                    id="signer_title" name="signer_title" defaultValue={settings?.signer_title ?? ""}
                    className={adminInput} placeholder="e.g. Chief Organizer"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="signer_name_2" className={adminLabel}>Signer 2 name (optional)</label>
                  <input
                    id="signer_name_2" name="signer_name_2" defaultValue={settings?.signer_name_2 ?? ""}
                    className={adminInput} placeholder="e.g. Sensei Wong Kah Meng"
                  />
                </div>
                <div>
                  <label htmlFor="signer_title_2" className={adminLabel}>Signer 2 title</label>
                  <input
                    id="signer_title_2" name="signer_title_2" defaultValue={settings?.signer_title_2 ?? ""}
                    className={adminInput} placeholder="e.g. Head Referee"
                  />
                </div>
              </div>
              <p className="text-xs text-neutral-400">
                Leave Signer 2 blank to show only one signer. When set, it appears bottom-right on every
                certificate (Winner, Participant, Referee/Judge, Sensei, School/Dojo, Support), using the
                same signature and stamp images above.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="signature" className={adminLabel}>Signature image</label>
                  <CertificateUploadField id="signature" name="signature" />
                  <div className="mt-1 flex items-center gap-3">
                    <p className="text-xs text-neutral-400">Leave blank to keep the existing signature.</p>
                    {signatureUrl && (
                      <a href={signatureUrl} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-xs font-semibold text-green-700 underline underline-offset-2">
                        View current
                      </a>
                    )}
                  </div>
                </div>
                <div>
                  <label htmlFor="stamp" className={adminLabel}>Stamp / seal image</label>
                  <CertificateUploadField id="stamp" name="stamp" />
                  <div className="mt-1 flex items-center gap-3">
                    <p className="text-xs text-neutral-400">Leave blank to keep the existing stamp.</p>
                    {stampUrl && (
                      <a href={stampUrl} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-xs font-semibold text-green-700 underline underline-offset-2">
                        View current
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <button type="submit" className={adminBtn}>Save certificate settings</button>
            </form>
          </Card>
        </>
      ) : (
        <p className="mb-6 text-sm text-neutral-500">Only Admin / Organizer can change certificate settings.</p>
      )}

      <h2 className="mt-10 mb-3 text-lg font-bold">Publish Certificates</h2>
      {canManage ? (
        <>
          <p className="mb-4 max-w-3xl text-sm text-neutral-500">
            Certificates for a tier unlock automatically 30 days after its registration deadline (the
            same moment the public Winners page reveals scores) — or set a custom date on{" "}
            <a href="/admin/competitions" className="text-red-700 underline underline-offset-2">Competitions</a>.
            Ready sooner? Publish a tier right now instead of waiting. The certificate date below is
            what's printed on every certificate for that tier — set it separately from publishing
            (defaults to the event date if left blank).
          </p>
          {competitions.length === 0 ? (
            <EmptyState>No competitions yet.</EmptyState>
          ) : (
            <div className="space-y-3">
              {competitions.map((c) => {
                const revealDate = c.registration_deadline
                  ? winnersRevealDateFor(c.registration_deadline, c.winners_announce_date) ??
                    winnersRevealDate(c.registration_deadline)
                  : null;
                const revealed = revealDate ? new Date() >= revealDate : false;
                return (
                  <Card key={c.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-neutral-800">{c.name}</p>
                        <p className="text-xs text-neutral-500">
                          {revealDate
                            ? `${revealed ? "Published" : "Scheduled"} ${formatDate(revealDate.toISOString().slice(0, 10))}`
                            : "No registration deadline set yet."}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {revealed && (
                          <span className="rounded-full border border-green-300 bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                            Certificates live
                          </span>
                        )}
                        {revealDate && (
                          <form action={publishWinnersNow}>
                            <input type="hidden" name="competition_id" value={c.id} />
                            <input type="hidden" name="return_to" value="/admin/certificates" />
                            <button
                              disabled={revealed}
                              className={revealed ? `${adminBtn} cursor-not-allowed opacity-40` : adminBtn}
                              title={
                                revealed
                                  ? "Already published — certificates are live for this tier"
                                  : "Publishes this tier's winners and certificates right now, instead of waiting for the scheduled date"
                              }
                            >
                              Publish all Certificates
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                    <form
                      action={saveCertificateDate}
                      className="mt-3 flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3"
                    >
                      <input type="hidden" name="competition_id" value={c.id} />
                      <input type="hidden" name="return_to" value="/admin/certificates" />
                      <div>
                        <label htmlFor={`certificate_date_${c.id}`} className={adminLabel}>
                          Certificate date
                        </label>
                        <DateField
                          key={`${c.id}-${c.certificate_date ?? ""}-${c.winners_announce_date ?? ""}-${c.event_date ?? ""}`}
                          id={`certificate_date_${c.id}`}
                          name="certificate_date"
                          required={false}
                          defaultValueISO={c.certificate_date ?? c.winners_announce_date ?? c.event_date ?? ""}
                          className={adminInput}
                        />
                      </div>
                      <button
                        className={adminBtn}
                        title="Sets the date printed on this tier's certificates — independent of publishing"
                      >
                        Save date
                      </button>
                      {c.certificate_date && (
                        <span className="text-xs text-neutral-400">
                          Currently {formatDate(c.certificate_date)}
                        </span>
                      )}
                    </form>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-neutral-500">Only Admin / Organizer / Staff can publish certificates.</p>
      )}

      <h2 className="mt-10 mb-3 text-lg font-bold">Template Preview</h2>
      {canManage ? (
        <>
          <p className="mb-4 max-w-3xl text-sm text-neutral-500">
            Sample data — not a real registration. Save your signature/stamp above, then refresh this
            page to see them appear here.
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            {CERT_KINDS.map((c) => (
              <div key={c.key} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
                <p className="mb-2 text-sm font-bold text-neutral-800">{c.label}</p>
                <p className="mb-2 text-xs text-neutral-400">{c.note}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/certificates/${c.kind}/sample${c.query ?? ""}${c.query ? "&" : "?"}v=${CERT_CACHE_BUST}`}
                  alt={`${c.label} certificate sample`}
                  className="w-full rounded border border-neutral-100"
                />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-neutral-500">Only Admin / Organizer / Staff can preview certificate templates.</p>
      )}
    </AdminShell>
  );
}
