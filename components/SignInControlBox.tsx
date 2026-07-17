import { updateSignInControl } from "@/app/actions/admin";
import { adminInput, adminLabel, adminBtnSecondary } from "@/components/admin";
import type { Competition } from "@/lib/types";

/** Admin/Organizer-only control over a registrant's sign-in quota — how
 * many sign-ins, which competition tier it's for, and the date range it's
 * valid over. Shown on the Schools/Senseis/Referees/Audience/Support admin
 * pages next to each linked login. Render nothing (or the "no login yet"
 * fallback) if the directory record has no linked login — there's no
 * profiles row to control yet. */
export default function SignInControlBox({
  userId,
  signInCount,
  signInLimit,
  signInCompetitionId,
  signInValidFrom,
  signInValidUntil,
  competitions,
  returnTo,
}: {
  userId: string | null;
  signInCount: number;
  signInLimit: number | null;
  signInCompetitionId: string | null;
  signInValidFrom: string | null;
  signInValidUntil: string | null;
  competitions: Competition[];
  returnTo: string;
}) {
  if (!userId) {
    return (
      <p className="text-xs text-neutral-400">
        Sign-in control: no linked login yet — they haven&apos;t signed in with a personal code.
      </p>
    );
  }
  return (
    <details className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs">
      <summary className="cursor-pointer font-bold uppercase tracking-wide text-neutral-500">
        Sign-in control (Admin/Organizer only) — {signInCount} sign-in{signInCount === 1 ? "" : "s"} so far
      </summary>
      <form action={updateSignInControl} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <div>
          <label htmlFor={`sil-${userId}`} className={adminLabel}>Sign-in limit (blank = unlimited)</label>
          <input
            id={`sil-${userId}`}
            name="sign_in_limit"
            type="number"
            min={0}
            defaultValue={signInLimit ?? ""}
            className={adminInput}
          />
        </div>
        <div>
          <label htmlFor={`sic-${userId}`} className={adminLabel}>Competition tier</label>
          <select id={`sic-${userId}`} name="sign_in_competition_id" defaultValue={signInCompetitionId ?? ""} className={adminInput}>
            <option value="">— None —</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`sif-${userId}`} className={adminLabel}>Valid from</label>
          <input id={`sif-${userId}`} name="sign_in_valid_from" type="date" defaultValue={signInValidFrom ?? ""} className={adminInput} />
        </div>
        <div>
          <label htmlFor={`siu-${userId}`} className={adminLabel}>Valid until</label>
          <input id={`siu-${userId}`} name="sign_in_valid_until" type="date" defaultValue={signInValidUntil ?? ""} className={adminInput} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input type="checkbox" name="reset_count" className="h-3.5 w-3.5" />
          Reset sign-in count to 0
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className={adminBtnSecondary}>Save sign-in control</button>
        </div>
      </form>
    </details>
  );
}
