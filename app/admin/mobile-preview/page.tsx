import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { SetupNotice } from "@/components/ui";
import MobilePreviewFrames from "@/components/MobilePreviewFrames";

export const dynamic = "force-dynamic";

export default async function AdminMobilePreview() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Mobile Preview" active="/admin/mobile-preview">
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
  const canView = ["admin", "organizer", "staff", "customer_support"].includes(role ?? "");

  return (
    <AdminShell title="Mobile Preview — Portrait & Landscape" active="/admin/mobile-preview">
      {!canView ? (
        <p className="text-sm text-neutral-500">You don&apos;t have access to this page.</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>View access only.</strong> These frames load the real, live site at exact phone
            dimensions so you can check how any page looks and behaves on mobile — Portrait and
            Landscape, side by side — without needing an actual phone. Admin, Organizer, and
            Participant Support can all view this page.
          </div>
          <MobilePreviewFrames />
        </div>
      )}
    </AdminShell>
  );
}
