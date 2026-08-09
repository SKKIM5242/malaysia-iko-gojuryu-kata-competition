"use client";

import { publishWinnersNow } from "@/app/actions/admin";

/** Confirms first — this overwrites whatever Winner Announcement Date is
 * currently set (even a real future date typed into Edit Competition) with
 * today's date, immediately. Added after that happened by accident twice in
 * a row on production: a stray click force-revealed a tier with no scored
 * recordings yet and fired the certificates-published notification early,
 * and had to be manually reverted via the audit log both times. */
export default function PublishWinnersButton({
  competitionId,
  returnTo,
  className,
}: {
  competitionId: string;
  returnTo: string;
  className: string;
}) {
  return (
    <form
      action={publishWinnersNow}
      onSubmit={(e) => {
        if (
          !confirm(
            "Publish winners now?\n\nThis immediately sets today's date as the Winner Announcement Date for this tier — overwriting whatever date is currently set (even a real future date) — and unlocks the public Winners page and every eligible certificate right away. It also sends the certificates-published email/Telegram notice to everyone eligible, once.\n\nYou can change the date back afterward via Edit Competition if this was a mistake.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="competition_id" value={competitionId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <button
        className={className}
        title="Publish this tier's winners right now — unlocks the public Winners page and every eligible certificate immediately, instead of waiting for the automatic reveal date"
      >
        Publish winners now
      </button>
    </form>
  );
}
