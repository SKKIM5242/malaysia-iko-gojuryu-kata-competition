import { formatDate } from "@/components/ui";

/** "Sign-ins: 3 of 250 used · Valid 25/10/2026 to 17/01/2027" — the account's
 * own sign-in allowance and window.
 *
 * Shared by the Kata Arena page and the account ("Kata Arena Log In") page so
 * the two can never drift apart, since a participant checking how many
 * sign-ins they have left will look at whichever of the two they happen to
 * be on. */
export default function SignInQuotaLine({
  signInCount,
  signInLimit,
  validFrom,
  validUntil,
  className = "",
}: {
  signInCount: number;
  signInLimit: number | null;
  validFrom: string | null;
  validUntil: string | null;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-neutral-500 ${className}`}
    >
      <span>
        {signInLimit != null
          ? `Sign-ins: ${signInCount} of ${signInLimit} used`
          : "Sign-ins: unlimited"}
      </span>
      <span>
        {validFrom || validUntil
          ? `Valid ${validFrom ? formatDate(validFrom) : "—"} to ${validUntil ? formatDate(validUntil) : "—"}`
          : "Valid: no expiry set"}
      </span>
    </div>
  );
}
