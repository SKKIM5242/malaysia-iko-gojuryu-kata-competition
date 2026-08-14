"use client";

import { useState } from "react";
import { TESTIMONIAL_KIND_LABEL, TESTIMONIAL_GATE_NOTE, TESTIMONIAL_VIDEO_GUIDANCE_NOTE, type TestimonialKind } from "@/lib/testimonials";
import TestimonialRecorder from "@/components/TestimonialRecorder";
import type { RecordingAppearance } from "@/lib/recording-appearance";
import TestimonialDeleteButton from "@/components/TestimonialDeleteButton";
import LockedVideo from "@/components/LockedVideo";
import { formatDate } from "@/components/ui";

export interface WinnerTestimonialInfo {
  id: string;
  kind: TestimonialKind;
  mediaUrl: string | null;
  message: string | null;
  /** Soft-deleted by an organizer for being inappropriate — content is
   * cleared, but the row itself stays (see deleteTestimonial in
   * app/actions/admin.ts for why: it's what keeps the certificate/payout
   * gate satisfied and blocks a resubmission). */
  deleted: boolean;
}

/**
 * Testimonial block for one winner's box on the public /winners page —
 * this is the merge point of what used to be the separate /testimonials
 * page (now retired) and My Account's recorder (also retired from there).
 * States:
 *  - Active testimonial: shown inline, for every visitor, same as the old
 *    /testimonials gallery did — plus a "✕" for Admin/Organizer/Staff only
 *    to remove it, and (for the owner, within the 30-day edit window) an
 *    "Edit / Retake" toggle that swaps in the same recorder used for the
 *    first submission, just pointed at editTestimonial instead.
 *  - Removed by an organizer: the owner sees why and that they can't
 *    resubmit; a manager sees a plain "Removed" note; everyone else sees
 *    nothing (no public shaming of removed content).
 *  - None yet, and the signed-in visitor IS this winner: the two gate
 *    notes plus the 4-button recorder.
 *  - None yet, anyone else: a plain "Pending" note — no buttons, since
 *    only the owning account can ever submit one (see submitTestimonial
 *    in app/actions/account.ts).
 */
export default function WinnerTestimonialInline({
  registrationId,
  isOwner,
  isManager,
  canModerate,
  canAssist,
  testimonial,
  editDeadlineISO,
  recordingAppearance = null,
  recordingLogoUrl = null,
}: {
  /** Which registration this testimonial is for — a login linked to
   * several participants (a Sensei recording for several students) needs
   * this passed explicitly, since it may not be the account's own primary
   * link (see submitTestimonial/editTestimonial in app/actions/account.ts,
   * which validate it against profile_participants). */
  registrationId: string;
  isOwner: boolean;
  isManager: boolean;
  /** Admin/Organizer/Staff AND Participant Support — who may take a
   * testimonial down for being abusive or working against the
   * competition's purpose. A superset of isManager; the same tier is
   * enforced server-side in deleteTestimonial regardless of what this
   * shows. */
  canModerate: boolean;
  /** Signed in with any role except Audience (Organizer/School/Sensei/
   * Referee/Support/Admin/Staff, in addition to the winner themself) — lets
   * that broader staff/coach set see the same submission buttons a winner
   * who hasn't given a testimonial yet would see, so they can help out.
   * Submitting still always attributes to the CLICKING account's own
   * registration (see submitTestimonial/editTestimonial) — this only
   * widens who sees the buttons, not who a submission is credited to. */
  canAssist: boolean;
  testimonial: WinnerTestimonialInfo | null;
  /** 30 calendar days after this competition's winners were revealed (see
   * testimonialEditDeadline in lib/winners.ts) — the owner can edit/retake
   * their own testimonial, unlimited times, up until this date. Null if the
   * competition has no reveal date computed yet. */
  editDeadlineISO: string | null;
  /** Recording-screen banner + footer watermark, from Recording
   * Appearance on the admin Competitions page. */
  recordingAppearance?: RecordingAppearance | null;
  recordingLogoUrl?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState(false);
  const canEdit = isOwner && editDeadlineISO != null && new Date() <= new Date(editDeadlineISO);
  const editWindowClosed = isOwner && editDeadlineISO != null && !canEdit;

  /** Who sees the testimonial laid out in full straight away: the account
   * whose own email is on the registration, plus Organizer and Participant
   * Support. Everyone else — audience, other participants — gets buttons
   * instead, and the player only appears once they press one. */
  const seesDetail = isOwner || canModerate;

  if (testimonial?.deleted) {
    if (isOwner) {
      return (
        <p className="mt-1 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-600">
          🚫 Your testimonial was removed by the organizer. You can&apos;t submit another for this competition — your
          certificate download and reward payout are not affected.
        </p>
      );
    }
    if (canModerate) {
      return <p className="mt-1 text-xs font-semibold text-neutral-400">🚫 Testimonial removed</p>;
    }
    return null;
  }

  if (testimonial) {
    if (editing) {
      return (
        <div className="mt-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-neutral-500">✏️ Editing your testimonial</p>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-700"
            >
              Cancel
            </button>
          </div>
          <TestimonialRecorder
            mode="edit"
            registrationId={registrationId}
            onSaved={() => setEditing(false)}
            recordingAppearance={recordingAppearance}
            recordingLogoUrl={recordingLogoUrl}
          />
        </div>
      );
    }

    return (
      <div className="mt-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-neutral-500">
            {TESTIMONIAL_KIND_LABEL[testimonial.kind]}
            {editWindowClosed && (
              <span className="ml-2 font-normal text-neutral-400">
                (editing closed {formatDate(editDeadlineISO)})
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs font-semibold text-red-700 hover:text-red-800"
              >
                ✏️ Edit / Retake
              </button>
            )}
            {canModerate && <TestimonialDeleteButton testimonialId={testimonial.id} returnTo="/winners" />}
          </div>
        </div>
        {canEdit && (
          <p className="mb-1.5 text-[11px] text-neutral-400">Editable as many times as you like until {formatDate(editDeadlineISO)}.</p>
        )}

        {/* Audience and other participants get a button per available
            format rather than an auto-embedded player. A winners page can
            list dozens of boxes, and loading every video and audio element
            at once is both slow and presumptuous about what the visitor
            actually wants to open. */}
        {!seesDetail && !opened && (
          <div className="flex flex-wrap gap-1.5">
            {testimonial.kind === "video" && testimonial.mediaUrl && (
              <>
                <button
                  type="button"
                  onClick={() => setOpened(true)}
                  className="rounded-md bg-red-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-600"
                >
                  ▶ Watch video testimonial
                </button>
                <button
                  type="button"
                  onClick={() => setOpened(true)}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  🎧 Listen only
                </button>
              </>
            )}
            {testimonial.kind === "voice" && testimonial.mediaUrl && (
              <button
                type="button"
                onClick={() => setOpened(true)}
                className="rounded-md bg-red-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-600"
              >
                🎧 Listen to voice testimonial
              </button>
            )}
            {testimonial.kind === "message" && testimonial.message && (
              <button
                type="button"
                onClick={() => setOpened(true)}
                className="rounded-md bg-red-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-600"
              >
                📄 Read written testimonial
              </button>
            )}
          </div>
        )}

        {!seesDetail && opened && (
          <button
            type="button"
            onClick={() => setOpened(false)}
            className="mb-1.5 text-[11px] font-semibold text-neutral-500 hover:text-neutral-700"
          >
            ▲ Hide
          </button>
        )}

        {(seesDetail || opened) && testimonial.kind === "video" && testimonial.mediaUrl && (
          <div className="space-y-1.5">
            <LockedVideo src={testimonial.mediaUrl} className="w-full max-w-xs rounded bg-black" />
            <div>
              <p className="text-[11px] font-semibold text-neutral-400">🎙️ Voice Testimonial (auto, from this video)</p>
              <audio src={testimonial.mediaUrl} controls className="w-full max-w-xs" />
            </div>
          </div>
        )}
        {(seesDetail || opened) && testimonial.kind === "voice" && testimonial.mediaUrl && (
          <audio src={testimonial.mediaUrl} controls className="w-full max-w-xs" />
        )}
        {(seesDetail || opened) && testimonial.kind === "message" && testimonial.message && (
          <blockquote className="border-l-4 border-neutral-300 pl-2 text-xs italic text-neutral-700">
            “{testimonial.message}”
          </blockquote>
        )}
      </div>
    );
  }

  // The recorder is shown ONLY to the winner's own account now. It used to
  // render for any signed-in non-Audience role, on the theory that staff
  // could "help submit" -- but a submission is always resolved against the
  // CLICKING account's own linked registrations, falling back to that
  // account's own registration when the requested one isn't theirs. So a
  // staff member who filled the form in and pressed Submit was silently
  // retargeted at their OWN (non-winning) registration and rejected with
  // "Testimonials are only for Top 3 winners." Offering a form that cannot
  // succeed is what made that read as a bug; non-owners now get a plain
  // explanation instead.
  if (!isOwner) {
    return (
      <div className="mt-1 space-y-1">
        <p className="text-xs font-semibold text-amber-700">⏳ Testimonial pending</p>
        {canAssist && (
          <p className="text-[11px] text-neutral-500">
            Only this winner&apos;s own account can record and submit their testimonial — share the sample
            scripts with them. Organizer and Participant Support can remove a testimonial once it has been
            submitted, but cannot submit one on a winner&apos;s behalf.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
      <p className="text-xs font-semibold text-amber-800">🎓 Give your testimonial</p>
      <p className="mt-1 text-[11px] text-amber-900">{TESTIMONIAL_GATE_NOTE}</p>
      <p className="mt-1 text-[11px] text-amber-900">{TESTIMONIAL_VIDEO_GUIDANCE_NOTE}</p>
      {editDeadlineISO && (
        <p className="mt-1 text-[11px] text-amber-900">
          Once submitted, you can edit or retake it as many times as you like until {formatDate(editDeadlineISO)}.
        </p>
      )}
      <div className="mt-2">
        <TestimonialRecorder
          registrationId={registrationId}
          recordingAppearance={recordingAppearance}
          recordingLogoUrl={recordingLogoUrl}
        />
      </div>
    </div>
  );
}
