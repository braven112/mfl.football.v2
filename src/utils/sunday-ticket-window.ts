/**
 * When the homepage hero is the Sunday Ticket board — pure, league-neutral.
 *
 * The game-day-preview slot spans Saturday and Sunday before 10am PT, and it
 * has two jobs: Saturday is the last call to set a lineup; Sunday morning the
 * question is which four games go on the multiview. An owner whose lineup is
 * already in has no Saturday job left, so from 5pm Saturday they get the
 * board instead of a reminder they have already acted on. Everyone else —
 * not signed in, no lineup yet, or "couldn't tell" — keeps the reminder until
 * Sunday morning. Clock is the league's (PT), never UTC.
 */

const PT_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

function ptWeekdayHour(now: Date): { weekday: string; hour: number } {
  const parts = PT_PARTS.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
  return { weekday, hour: Number.isFinite(hour) ? hour : -1 };
}

/** Is it Sunday in the league's clock? */
export function isSundayPT(now: Date): boolean {
  return ptWeekdayHour(now).weekday === 'Sun';
}

/** Saturday from `fromHour` (default 5pm) in the league's clock. */
export const SATURDAY_EVENING_HOUR_PT = 17;
export function isSaturdayEveningPT(now: Date, fromHour = SATURDAY_EVENING_HOUR_PT): boolean {
  const { weekday, hour } = ptWeekdayHour(now);
  return weekday === 'Sat' && hour >= fromHour;
}

/**
 * Show the Sunday Ticket hero? Sunday: always. Saturday from 5pm: only when
 * the owner's lineup is confirmed in (`true`) — `false` and `null` (unknown,
 * or not signed in) both keep the lineup reminder, because a hero that stops
 * nagging an owner who has NOT set a lineup is worse than one that nags an
 * owner who has.
 */
export function showSundayTicketHero(now: Date, lineupSubmitted: boolean | null | undefined): boolean {
  if (isSundayPT(now)) return true;
  return isSaturdayEveningPT(now) && lineupSubmitted === true;
}
