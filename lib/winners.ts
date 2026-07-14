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

export function winnersRevealed(registrationDeadline: string | null): boolean {
  if (!registrationDeadline) return false;
  return new Date() >= winnersRevealDate(registrationDeadline);
}
