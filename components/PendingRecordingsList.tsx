"use client";

import { claimAndStartRecording } from "@/app/actions/account";
import { formatDate } from "@/components/ui";

export interface PendingRegistration {
  id: string;
  categoryName: string | null;
  competitionName: string | null;
  eventDate: string | null;
  registrationDeadline: string | null;
}

function daysLeftFor(registrationDeadline: string | null): number | null {
  if (!registrationDeadline) return null;
  // Runs in the viewer's own browser, so "today" is their own local date —
  // each tier's countdown is evaluated in their own country's time frame,
  // never the server's.
  const deadline = new Date(`${registrationDeadline}T23:59:59`);
  return Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Every other paid registration (a participant may register for more than
 * one competition tier) still waiting for a recording — each shown with
 * its OWN tier's event date, deadline, and days left to record, never
 * combined into one blended figure across tiers. "Start Recording" swaps
 * which registration is currently active in the recorder above without
 * retyping reference ID + IC. */
export default function PendingRecordingsList({ items }: { items: PendingRegistration[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="font-bold text-amber-900">
        {items.length} more registration{items.length === 1 ? "" : "s"} waiting for a recording
      </p>
      <div className="mt-3 space-y-2">
        {items.map((r) => {
          const daysLeft = daysLeftFor(r.registrationDeadline);
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-2"
            >
              <div>
                <p className="text-sm font-semibold text-neutral-800">{r.categoryName ?? "Category not set"}</p>
                <p className="text-xs text-neutral-500">{r.competitionName ?? ""}</p>
                {(r.eventDate || r.registrationDeadline) && (
                  <p className="mt-0.5 text-[10px] text-neutral-400">
                    {r.eventDate ? formatDate(r.eventDate) : "—"} to{" "}
                    {r.registrationDeadline ? formatDate(r.registrationDeadline) : "—"}
                    {daysLeft != null &&
                      (daysLeft >= 0
                        ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
                        : " · recording window closed")}
                  </p>
                )}
              </div>
              <form action={claimAndStartRecording}>
                <input type="hidden" name="registration_id" value={r.id} />
                <button className="rounded-md bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600">
                  Start Recording
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
