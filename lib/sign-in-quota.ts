export interface SignInQuotaProfile {
  role: string;
  sign_in_limit: number | null;
  sign_in_count: number;
  sign_in_valid_from: string | null;
  sign_in_valid_until: string | null;
}

/**
 * Admin/Organizer set an optional sign-in quota (count and/or a valid date
 * range) per registrant — checked on every load of a protected page, not
 * just at sign-in time, since a session obtained before the quota ran out
 * would otherwise let someone straight past a check made only once at
 * sign-in. Admin/Organizer/Staff are never subject to a quota.
 */
export function isWithinSignInQuota(profile: SignInQuotaProfile): { ok: boolean; reason?: string } {
  if (["admin", "organizer", "staff"].includes(profile.role)) return { ok: true };
  const today = new Date().toISOString().slice(0, 10);
  if (profile.sign_in_valid_from && today < profile.sign_in_valid_from) {
    return { ok: false, reason: "Your subscription is not active yet." };
  }
  if (profile.sign_in_valid_until && today > profile.sign_in_valid_until) {
    return { ok: false, reason: "Your subscription has expired." };
  }
  if (profile.sign_in_limit != null && profile.sign_in_count >= profile.sign_in_limit) {
    return { ok: false, reason: "You have used all your available sign-ins." };
  }
  return { ok: true };
}
