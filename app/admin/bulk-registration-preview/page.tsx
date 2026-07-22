import { createClient } from "@/lib/supabase/server";
import {
  getOpenCompetitions,
  getCategories,
  getSchools,
  getSenseis,
  isCompetitionOpen,
  schemaReady,
} from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { EmptyState, SetupNotice } from "@/components/ui";
import BulkRegisterForm from "@/components/BulkRegisterForm";
import CsvBulkForm from "@/components/CsvBulkForm";
import BulkUploadGate from "@/components/BulkUploadGate";
import SampleStripeCheckoutButton from "@/components/SampleStripeCheckoutButton";
import { kataBases } from "@/lib/division";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AdminBulkRegistrationPreview() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Bulk Registration — Sensei / Coach" active="/admin/bulk-registration-preview">
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
  const role = myProfile?.role ?? null;
  const canTest = ["admin", "organizer", "staff"].includes(role ?? "");
  const canView = canTest || role === "customer_support";

  const openCompetitions = (await getOpenCompetitions()).filter(isCompetitionOpen);
  const [categories, schools, senseis] = openCompetitions.length > 0
    ? await Promise.all([getCategories(openCompetitions[0].id), getSchools(), getSenseis()])
    : [[], [], []];

  return (
    <AdminShell title="Bulk Registration — Sensei / Coach" active="/admin/bulk-registration-preview">
      {!canView ? (
        <p className="text-sm text-neutral-500">You don&apos;t have access to this page.</p>
      ) : (
        <div className="space-y-4">
          <div className={`rounded-md border px-4 py-3 text-sm ${
            canTest ? "border-blue-200 bg-blue-50 text-blue-900" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}>
            {canTest ? (
              <>
                <strong>Admin / Organizer — full test access.</strong> This is the exact same
                enquiry popup, CSV upload, and on-screen table a Sensei sees on the public Bulk
                Registration page — test the whole flow here, including a real sample Stripe
                checkout page below.
              </>
            ) : (
              <>
                <strong>Participant Support — view access only.</strong> This preview shows exactly
                how the Sensei bulk-registration flow looks and works, so you can guide callers
                through it. Nothing here is interactive for your role.
              </>
            )}
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Sample Stripe Payment Page</h2>
            <p className="mt-1 mb-3 text-sm text-neutral-600">
              Bulk registration itself is now paid online via Stripe (the &quot;Pay with
              Stripe&quot; button in Step 1 below creates a real Checkout session for the batch
              total). This separate sample button opens a real, test-mode Stripe Checkout page —
              USD 1.00, not tied to any real registration — so you can see exactly what senseis
              see without needing a live batch.
            </p>
            <SampleStripeCheckoutButton disabled={!canTest} />
          </div>

          <div className={canTest ? "" : "pointer-events-none opacity-70"}>
            {openCompetitions.length === 0 ? (
              <EmptyState>There is no competition to register for right now.</EmptyState>
            ) : (
              <>
                <BulkUploadGate
                  competitions={openCompetitions}
                  schools={schools}
                  senseis={senseis}
                />

                <section className="mb-10 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-bold">Step 2, Option A — Excel / CSV Upload</h2>
                  <div className="mt-4">
                    <CsvBulkForm competitions={openCompetitions} schools={schools} senseis={senseis} />
                  </div>
                </section>

                <section>
                  <h2 className="text-lg font-bold">Step 2, Option B — Fill The Table On Screen</h2>
                  <div className="mt-4">
                    <BulkRegisterForm
                      competitions={openCompetitions}
                      kataBases={kataBases(categories)}
                      schools={schools}
                      senseis={senseis}
                    />
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
