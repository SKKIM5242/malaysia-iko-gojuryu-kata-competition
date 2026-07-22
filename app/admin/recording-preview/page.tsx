import { createClient } from "@/lib/supabase/server";
import { schemaReady } from "@/lib/data";
import { AdminShell } from "@/components/admin";
import { SetupNotice } from "@/components/ui";
import KataRecorder from "@/components/KataRecorder";

export const dynamic = "force-dynamic";

/** Sample dates only — this page never touches a real competition or
 * registration, it exists purely so Admin/Organizer can test the recording
 * UI end-to-end (camera, timer, delete-and-re-record) and Support can see
 * how it looks and works without being able to use it. */
function sampleDates() {
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIso(start), end: toIso(end) };
}

export default async function AdminRecordingPreview() {
  const ready = await schemaReady();
  if (!ready) {
    return (
      <AdminShell title="Recording Window Preview" active="/admin/recording-preview">
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
  const { start, end } = sampleDates();

  return (
    <AdminShell title="Recording Window Preview" active="/admin/recording-preview">
      {!canView ? (
        <p className="text-sm text-neutral-500">You don&apos;t have access to this page.</p>
      ) : (
        <div className="space-y-4">
          <div className={`rounded-md border px-4 py-3 text-sm ${
            canTest ? "border-blue-200 bg-blue-50 text-blue-900" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}>
            {canTest ? (
              <>
                <strong>Admin / Organizer — full test access.</strong> This is the exact recording
                window a participant sees, using sample dates. You can test the camera, timer, and
                delete-and-re-record flow. Final submission will show an expected error since your
                staff account has no paid registration to attach it to.
              </>
            ) : (
              <>
                <strong>Participant Support — view access only.</strong> This preview shows exactly
                how the recording window looks and works for participants, so you can guide them
                over the phone or in chat. Camera and recording controls are disabled here.
              </>
            )}
          </div>
          <div className={canTest ? "" : "pointer-events-none opacity-70"}>
            <KataRecorder
              initialAttempts={0}
              maxAttempts={3}
              hasPendingPurchase={false}
              watermark="PREVIEW — Malaysia Open IKO Goju-ryu Kata Championship"
              recordingStart={start}
              recordingEnd={end}
            />
          </div>
        </div>
      )}
    </AdminShell>
  );
}
