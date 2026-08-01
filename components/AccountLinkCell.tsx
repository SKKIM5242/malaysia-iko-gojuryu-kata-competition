"use client";

/**
 * The manual "Link to account" / ✅-linked / "Unlink" control, generalized
 * from the one built for Participant Records so School, Sensei, Referee,
 * and Audience can show the same thing — auto-linking by email already
 * happens for all of these at signup, but until now there was no manual
 * fallback when that match never happened (typo'd email, signed up under a
 * different address, etc.), the same gap Participant had before its own
 * Link/Unlink buttons existed.
 */
export default function AccountLinkCell({
  linkedEmail,
  entityId,
  idFieldName,
  linkAction,
  unlinkAction,
  returnTo,
  canManage,
}: {
  /** The linked account's email, or null if nothing is linked yet. */
  linkedEmail: string | null;
  /** The school/sensei/referee/audience row's own id. */
  entityId: string;
  /** Hidden field name the server action expects — "school_id", "sensei_id", etc. */
  idFieldName: string;
  linkAction: (formData: FormData) => void;
  unlinkAction: (formData: FormData) => void;
  returnTo: string;
  canManage: boolean;
}) {
  if (linkedEmail) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-green-700" title={`Linked to ${linkedEmail}`}>
          ✅ {linkedEmail}
        </span>
        {canManage && (
          <form action={unlinkAction}>
            <input type="hidden" name={idFieldName} value={entityId} />
            <input type="hidden" name="return_to" value={returnTo} />
            <button
              type="submit"
              title={`Unlink ${linkedEmail} from this record — frees that account up to be linked to a different one instead`}
              onClick={(e) => {
                if (
                  !window.confirm(
                    `Unlink ${linkedEmail} from this record?\n\nThey won't be able to sign in with it until it's re-linked.`,
                  )
                ) {
                  e.preventDefault();
                }
              }}
              className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50"
            >
              Unlink
            </button>
          </form>
        )}
      </span>
    );
  }
  if (!canManage) {
    return <span className="text-xs text-neutral-400">Not linked</span>;
  }
  return (
    <form action={linkAction}>
      <input type="hidden" name={idFieldName} value={entityId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <button
        type="submit"
        title="Link this record to whichever account is signed up with its email on file"
        className="rounded border border-blue-300 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-50"
      >
        Link to account
      </button>
    </form>
  );
}
