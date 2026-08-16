"use client";

import { unpublishCertificates } from "@/app/actions/admin";

/** Reverses "Publish all Certificates" for re-testing -- clears
 * winners_announce_date and certificates_notified_at so the tier goes back
 * to unrevealed and a later re-publish sends the notification again. Only
 * ever rendered on staging (see app/admin/certificates/page.tsx's
 * isStagingEnv() check) and the server action itself refuses off-staging
 * too, but this still confirms first since it's still a real, if
 * testing-only, reversal of a live-looking state. */
export default function UnpublishCertificatesButton({
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
      action={unpublishCertificates}
      onSubmit={(e) => {
        if (
          !confirm(
            "Unpublish this tier for testing?\n\nClears the Winner Announcement Date and the certificates-notified flag, so this tier goes back to un-revealed — the public Winners page and every certificate for it lock again, and a later re-publish will re-send the certificates-ready notice.\n\nStaging/testing only.",
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
        title="Testing only — reverses Publish all Certificates so you can re-test the publish/notify flow"
      >
        Unpublish all Certificates
      </button>
    </form>
  );
}
