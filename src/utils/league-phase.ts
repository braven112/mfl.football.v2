/**
 * League Phase Detection
 *
 * Splits the dynasty calendar into two phases that drive nav-section ordering
 * and default open state:
 *
 *   - 'in-season'   Labor Day  → Feb 14 cutoff   (reg season, playoffs, comp picks)
 *   - 'off-season'  Feb 14 cutoff → Labor Day    (auction, rookie draft, summer)
 *
 * These boundaries match the existing league-year cutoffs in `league-year.ts`,
 * so a single calendar drives every season-aware behavior in the app.
 */

import type { LeaguePhase } from '../types/nav';

/** First Monday in September of the given year. */
function getLaborDay(year: number): Date {
  const septFirst = new Date(year, 8, 1);
  const dow = septFirst.getDay(); // 0 = Sun
  const offset = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  return new Date(year, 8, 1 + offset, 0, 0, 0, 0);
}

/**
 * Feb 14 @ 8:45 PM PT cutoff (matches league-year.ts).
 * Stored in UTC: Feb 15 04:45 UTC = Feb 14 20:45 PST.
 */
function getFebCutoff(year: number): Date {
  return new Date(Date.UTC(year, 1, 15, 4, 45, 0, 0));
}

/**
 * Determine which calendar phase the league is in for a given date.
 *
 * In-season window:  Labor Day (this year) ≤ date < Feb 14 cutoff (next year)
 * Off-season window: Feb 14 cutoff (this year) ≤ date < Labor Day (this year)
 */
export function getLeaguePhase(referenceDate: Date = new Date()): LeaguePhase {
  const year = referenceDate.getFullYear();
  const febCutoff = getFebCutoff(year);
  const laborDay = getLaborDay(year);

  // Before Feb 14 cutoff this year → still in-season from last Labor Day's window.
  if (referenceDate < febCutoff) return 'in-season';

  // Feb 14 cutoff … Labor Day → off-season.
  if (referenceDate < laborDay) return 'off-season';

  // After Labor Day → new season starts.
  return 'in-season';
}
