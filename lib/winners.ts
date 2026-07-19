/** Malaysia working day = Mon–Fri. This does not account for Malaysian
 * public holidays (they vary by state and by the Islamic calendar) — only
 * weekends are rolled past. Dates are handled entirely in UTC (never the
 * server's local timezone) so "2026-08-30" always means the same calendar
 * day regardless of where this runs. */
function nextMalaysiaWorkingDay(date: Date): Date {
  const d = new Date(date);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Winners (and final judge scores) are announced 30 days after a
 * competition's registration deadline, on the next Malaysia working day.
 * Shared by the Winners page and Kata Arena so both use the same reveal
 * moment for scores. */
export function winnersRevealDate(registrationDeadline: string): Date {
  const [y, m, d] = registrationDeadline.split("-").map(Number);
  const plus30 = new Date(Date.UTC(y, m - 1, d + 30));
  return nextMalaysiaWorkingDay(plus30);
}

/** The organizer can mark a tier "special" by setting a manual
 * winners_announce_date on the competition — that overrides the 30-day
 * rule everywhere (Winners page, Kata Arena score reveal, hub box). */
export function winnersRevealDateFor(
  registrationDeadline: string | null,
  overrideDate?: string | null,
): Date | null {
  if (overrideDate) {
    const [y, m, d] = overrideDate.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  if (!registrationDeadline) return null;
  return winnersRevealDate(registrationDeadline);
}

export function winnersRevealed(registrationDeadline: string | null, overrideDate?: string | null): boolean {
  const date = winnersRevealDateFor(registrationDeadline, overrideDate);
  if (!date) return false;
  return new Date() >= date;
}
