export interface SignInQuotaProfile {
  role: string;
  sign_in_limit: number | null;
  sign_in_count: number;
  sign_in_valid_from: string | null;
  sign_in_valid_until: string | null;
}

function ddmmyyyy(isoDate: string): string {
  const [y, m, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

/**
 * Admin/Organizer set an optional sign-in quota (count and/or a valid date
 * range) per registrant — checked on every load of a protected page, not
 * just at sign-in time, since a session obtained before the quota ran out
 * would otherwise let someone straight past a check made only once at
 * sign-in. Admin/Organizer/Staff are never subject to a quota.
 *
 * `hasPendingRefereeWork` (a Referee/Judge with at least one unscored
 * assignment) exempts them from the valid-until date check specifically —
 * they're never signed out while a score is still owed, only the
 * 30-minute inactivity timeout still applies. It does not exempt the
 * sign-in count or the valid-from date.
 *
 * `canRenew` tells the caller whether to offer the paid "Request New
 * Subscription" button (a real Stripe charge) — only true once there's
 * actually something to renew (expired, or sign-ins used up). Being
 * blocked because the window simply hasn't STARTED yet is not something
 * paying again would fix, so that case is `canRenew: false` — a plain
 * "check back on this date" message, not a payment prompt.
 */
export function isWithinSignInQuota(
  profile: SignInQuotaProfile,
  hasPendingRefereeWork = false,
): { ok: boolean; reason?: string; canRenew?: boolean } {
  if (["admin", "organizer", "staff"].includes(profile.role)) return { ok: true };
  const today = new Date().toISOString().slice(0, 10);
  if (profile.sign_in_valid_from && today < profile.sign_in_valid_from) {
    return {
      ok: false,
      canRenew: false,
      reason: `Your sign-in window hasn't opened yet — it starts ${ddmmyyyy(profile.sign_in_valid_from)}. No action needed, just check back then.`,
    };
  }
  const pastValidUntil = profile.sign_in_valid_until != null && today > profile.sign_in_valid_until;
  if (pastValidUntil && !(profile.role === "referee" && hasPendingRefereeWork)) {
    return { ok: false, canRenew: true, reason: "Your subscription has expired." };
  }
  if (profile.sign_in_limit != null && profile.sign_in_count >= profile.sign_in_limit) {
    return { ok: false, canRenew: true, reason: "You have used all your available sign-ins." };
  }
  return { ok: true };
}
