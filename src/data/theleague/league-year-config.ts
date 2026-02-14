import type { LeagueYearOverrides } from '../../types/league-events';

/**
 * Annual configuration values that cannot be computed.
 * Update this when NFL Draft dates are announced each year.
 */
export const LEAGUE_YEAR_OVERRIDES: Record<number, LeagueYearOverrides> = {
  2026: {
    nflDraftDate: '2026-04-23',
  },
  2025: {
    nflDraftDate: '2025-04-24',
  },
};
