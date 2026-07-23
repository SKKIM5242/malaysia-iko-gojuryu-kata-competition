import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { saveCertificateSettings } from "@/app/actions/admin";
import { AdminShell, Card, adminBtn, adminInput, adminLabel } from "@/components/admin";
import { SetupNotice } from "@/components/ui";
import CertificateUploadField from "@/components/CertificateUploadField";

export const dynamic = "force-dynamic";

const CERT_KINDS: Array<{ kind: string; label: string; note: string }> = [
  { kind: "winner", label: "Winner", note: "Top 3 finishers — rank badge + gold accent." },
  { kind: "participant", label: "Participant", note: "Every other paid, non-winning participant." },
  { kind: "referee", label: "Referee / Judge", note: "For judging a competition tier." },
  { kind: "sensei", label: "Sensei", note: "For a sensei whose students competed." },
  { kind: "school", label: "School / Dojo", note: "For a school whose students competed." },
  { kind: "support", label: "Support", note: "Flat certificate of appreciation, not tier-specific." },
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

      <h2 className="mt-10 mb-3 text-lg font-bold">Template Preview</h2>
      {canManage ? (
        <>
          <p className="mb-4 max-w-3xl text-sm text-neutral-500">
            Sample data — not a real registration. Save your signature/stamp above, then refresh this
            page to see them appear here.
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            {CERT_KINDS.map((c) => (
              <div key={c.kind} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
                <p className="mb-2 text-sm font-bold text-neutral-800">{c.label}</p>
                <p className="mb-2 text-xs text-neutral-400">{c.note}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/certificates/${c.kind}/sample`}
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
