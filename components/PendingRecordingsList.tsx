"use client";

import { useState } from "react";
import { claimAndStartRecording } from "@/app/actions/account";
import { formatDateWithDay } from "@/components/ui";
import UploadSavedRecording from "@/components/UploadSavedRecording";

/** Shown in place of the Start Recording / Upload buttons the instant an
 * upload is accepted, and the same wording the account page uses for a
 * registration whose recording is already in. */
export const SUBMITTED_NOTE = "✅ Your kata recording is submitted — waiting for judge to give score.";

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
  // Registrations whose upload this page has just accepted, with enough
  // label to name them afterwards.
  //
  // Two jobs. First, it stops the row offering Start Recording the instant
  // the upload lands, rather than after the refreshed server data arrives —
  // that gap is long enough to start recording over a kata already
  // submitted. Second, the refresh then drops the row from `items`
  // entirely (getPendingRegistrations excludes anything with a
  // kata_video), so without keeping the label here the confirmation would
  // vanish along with it and the upload would look like it did nothing.
  const [submitted, setSubmitted] = useState<Map<string, string>>(new Map());
  const groups = groupByTier(items);
  const confirmations = [...submitted.entries()];
  if (groups.length === 0 && confirmations.length === 0) return null;
  return (
    <div className="space-y-4">
      {confirmations.map(([id, label]) => (
        <div key={id} className="rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-900">{SUBMITTED_NOTE}</p>
          <p className="mt-1 text-sm text-green-800">{label}</p>
          <p className="mt-1 text-xs text-green-700">
            Nothing further to do for this kata — recording is closed for it now.
          </p>
        </div>
      ))}
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
                  {submitted.has(item.id) ? (
                    // Once a file has been accepted for this registration
                    // there is nothing left to start: offering Start
                    // Recording again would let a participant record over a
                    // kata they have already submitted for judging.
                    <span className="ml-auto self-center text-xs font-semibold text-green-700">
                      {SUBMITTED_NOTE}
                    </span>
                  ) : (
                    status === "open" && (
                      <>
                        <form action={claimAndStartRecording} className="ml-auto self-center">
                          <input type="hidden" name="registration_id" value={item.id} />
                          <button className="rounded-md bg-red-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600">
                            Start Recording
                          </button>
                        </form>
                        {/* Sits right beside Start Recording and is ALWAYS
                            offered -- it used to be a separate row that only
                            appeared when this particular browser still held a
                            cached copy, which is why it looked missing after
                            recording on a different device. Its own panel
                            explains which source it found. */}
                        <UploadSavedRecording
                          registrationId={item.id}
                          onSubmitted={() =>
                            setSubmitted((prev) =>
                              new Map(prev).set(
                                item.id,
                                [item.participantName, item.categoryName ?? "Category not set"]
                                  .filter(Boolean)
                                  .join(" — "),
                              ),
                            )
                          }
                        />
                      </>
                    )
                  )}
                </li>
              ))}
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
