/**
 * League Phase Detection
 *
 * Splits the dynasty calendar into two phases that drive nav-section ordering
 * and default open state:
 *
 *   - 'in-season'   NL draft  → Feb 14 cutoff   (reg season, playoffs, comp picks)
 *   - 'off-season'  Feb 14 cutoff → NL draft     (auction, rookie draft, summer)
 *
 * These boundaries match the league-year cutoffs in `league-year.ts`, so a
 * single calendar drives every season-aware behavior in the app — which is why
 * the season edge is IMPORTED rather than re-derived here. This file used to
 * carry its own Labor Day copy, so when the season rollover moved, the nav
 * still reordered eight days late.
 */

import type { LeaguePhase } from '../types/nav';
import { getSeasonStartForYear } from './league-year';

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
 * In-season window:  NL draft (this year) ≤ date < Feb 14 cutoff (next year)
 * Off-season window: Feb 14 cutoff (this year) ≤ date < NL draft (this year)
 */
export function getLeaguePhase(referenceDate: Date = new Date()): LeaguePhase {
  const year = referenceDate.getFullYear();
  const febCutoff = getFebCutoff(year);
  const seasonStart = getSeasonStartForYear(year);

  // Before Feb 14 cutoff this year → still in-season from last season's window.
  if (referenceDate < febCutoff) return 'in-season';

  // Feb 14 cutoff … NL draft → off-season.
  if (referenceDate < seasonStart) return 'off-season';

  // After the NL draft → new season starts.
  return 'in-season';
}
