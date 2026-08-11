"use client";

import { claimAndStartRecording } from "@/app/actions/account";
import { formatDateWithDay } from "@/components/ui";
import UploadSavedRecording from "@/components/UploadSavedRecording";

export interface PendingRegistration {
  id: string;
  categoryName: string | null;
  /** This category's position in the admin's own Kata Category list (see
   * Competitions page) — kata within a tier are listed in that same order,
   * not whatever order they happen to come back from the database. */
  categorySortOrder: number;
  competitionId: string;
  competitionName: string | null;
  eventDate: string | null;
  registrationDeadline: string | null;
  /** Drives the tier boxes' own display order (cheapest tier first) --
   * several tiers can share the same eventDate, which alone isn't enough
   * to tell them apart in a stable order. */
  registrationFeeUsd: number | null;
  /** Whose kata this is — shown so a login linked to several participants
   * (e.g. a Sensei recording for several students) can tell them apart in
   * one flat list. */
  participantName: string | null;
}

type TierStatus = "not_yet_open" | "open" | "closed";

/** Mirrors KataRecorder's own notYetOpen/windowClosed check. Runs in the
 * viewer's own browser, so "today" is their own local date — each tier's
 * status is evaluated in their own country's time frame, never the
 * server's. */
function tierStatus(eventDate: string | null, registrationDeadline: string | null): TierStatus {
  const now = new Date();
  if (eventDate && now < new Date(`${eventDate}T00:00:00`)) return "not_yet_open";
  if (registrationDeadline && now > new Date(`${registrationDeadline}T23:59:59`)) return "closed";
  return "open";
}

interface TierGroup {
  competitionId: string;
  competitionName: string | null;
  eventDate: string | null;
  registrationDeadline: string | null;
  registrationFeeUsd: number | null;
  items: PendingRegistration[];
}

/** One box per competition tier instead of one per registration — a
 * participant registered for 3 kata in the same tier used to see the same
 * "recording opens on X" paragraph repeated 3 times over; now each tier's
 * window is stated once, with its kata listed underneath in Kata Category
 * order. A tier with nothing pending in it never gets a box at all. */
function groupByTier(items: PendingRegistration[]): TierGroup[] {
  const map = new Map<string, TierGroup>();
  for (const item of items) {
    let group = map.get(item.competitionId);
    if (!group) {
      group = {
        competitionId: item.competitionId,
        competitionName: item.competitionName,
        eventDate: item.eventDate,
        registrationDeadline: item.registrationDeadline,
        registrationFeeUsd: item.registrationFeeUsd,
        items: [],
      };
      map.set(item.competitionId, group);
    }
    group.items.push(item);
  }
  const groups = [...map.values()];
  for (const g of groups) g.items.sort((a, b) => a.categorySortOrder - b.categorySortOrder);
  // Cheapest tier first (USD 10 -> USD 100 -> USD 200), matching every
  // other tier listing in the app -- sorting by eventDate alone left tiers
  // that share the same event date (the common case) in whatever order
  // they happened to come back from the database instead.
  groups.sort((a, b) => (a.registrationFeeUsd ?? Infinity) - (b.registrationFeeUsd ?? Infinity));
  return groups;
}

export default function PendingRecordingsList({ items }: { items: PendingRegistration[] }) {
  const groups = groupByTier(items);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const status = tierStatus(g.eventDate, g.registrationDeadline);
        const tierName = g.competitionName ?? "this competition tier";
        return (
          <div key={g.competitionId} className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            {status === "not_yet_open" && (
              <div className="text-center">
                <p className="text-4xl">⏳</p>
                <p className="mt-1 text-lg font-bold text-amber-900">Recording hasn&apos;t opened yet</p>
                <p className="mt-1 text-sm text-amber-800">
                  Recording opens on {formatDateWithDay(g.eventDate)} for your competition tier —{" "}
                  {tierName} — based on today&apos;s date where you are, and closes on{" "}
                  {formatDateWithDay(g.registrationDeadline)}.
                </p>
              </div>
            )}
            {status === "closed" && (
              <div className="text-center">
                <p className="text-4xl">🔒</p>
                <p className="mt-1 text-lg font-bold text-amber-900">Recording window closed</p>
                <p className="mt-1 text-sm text-amber-800">
                  The deadline ({formatDateWithDay(g.registrationDeadline)}) has passed for your
                  competition tier — {tierName}. No further recording or submission is possible for
                  this tier.
                </p>
              </div>
            )}
            {status === "open" && (
              <div>
                <p className="font-bold text-amber-900">{tierName}</p>
                <p className="mt-1 text-sm text-amber-800">
                  🎬 Recording is open now — {formatDateWithDay(g.eventDate)} to{" "}
                  {formatDateWithDay(g.registrationDeadline)}.
                </p>
              </div>
            )}
            <p className="mt-3 text-sm font-semibold text-amber-900">
              {g.items.length} registration{g.items.length === 1 ? "" : "s"} waiting for a recording:
            </p>
            <ul className="mt-2 space-y-1.5">
              {g.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
                >
                  <span className="text-neutral-700">
                    {item.participantName && (
                      <span className="font-semibold text-neutral-900">{item.participantName} — </span>
                    )}
                    {item.categoryName ?? "Category not set"}
                  </span>
                  {status === "open" && (
                    <form action={claimAndStartRecording} className="ml-auto self-center">
                      <input type="hidden" name="registration_id" value={item.id} />
                      <button className="rounded-md bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600">
                        Start Recording
                      </button>
                    </form>
                  )}
                </li>
              ))}
              {/* One extra row per item that actually has a device-local
                  recording waiting -- renders nothing of its own otherwise,
                  so a tier with nothing saved never grows an empty row. */}
              {status === "open" && g.items.map((item) => <UploadSavedRecording key={`upload-${item.id}`} registrationId={item.id} />)}
            </ul>
            {status === "not_yet_open" && (
              <p className="mt-3 text-xs text-amber-800">
                Please start recording as soon as possible when recording is allowed, then remember to
                submit the recording. In the meantime, do your training first while waiting for the
                recording open date. Wish you a smooth recording &amp; submission.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
