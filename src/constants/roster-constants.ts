/**
 * Roster and player constants for fantasy football
 * Shared across roster, salary, and MVP pages
 */

/**
 * Standard position order for sorting players
 */
export const positionOrder = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'] as const;

/**
 * Position color palette for charts and visualizations
 */
export const POSITION_COLORS: Record<string, string> = {
  QB: '#6366f1', // indigo
  RB: '#f97316', // orange
  WR: '#22c55e', // green
  TE: '#14b8a6', // teal
  PK: '#0ea5e9', // light blue
  K: '#0ea5e9',  // light blue (alias for PK)
  DEF: '#475569', // slate
};

/**
 * Division order for team grouping
 */
export const divisionOrder = ['Northwest', 'Southwest', 'Central', 'East'] as const;

/**
 * Default player headshot URL when player image is unavailable
 */
export const DEFAULT_HEADSHOT_URL =
  'https://www49.myfantasyleague.com/player_photos_2010/no_photo_available.jpg';

/**
 * Get player headshot URL by player ID
 * @param playerId - MFL player ID
 * @returns URL to player headshot image
 */
export function getPlayerImageUrl(playerId?: string): string {
  return playerId
    ? `https://www49.myfantasyleague.com/player_photos_2014/${playerId}_thumb.jpg`
    : DEFAULT_HEADSHOT_URL;
}

/**
 * Get NFL team logo URL by team code
 * @param teamCode - 2-3 letter team code (e.g., 'SF', 'KC')
 * @returns URL to NFL team logo SVG (served locally)
 */
export function getNflLogoUrl(teamCode?: string): string {
  if (!teamCode || teamCode === 'FA') return '/assets/nfl-logos/NFL.svg';
  return `/assets/nfl-logos/${teamCode}.svg`;
}

/**
 * NFL team bye weeks (updated each season)
 * null = not yet determined
 */
export const nflByeWeeks: Record<string, number | null> = {
  ARI: null,
  ATL: null,
  BAL: null,
  BUF: null,
  CAR: null,
  CHI: null,
  CIN: null,
  CLE: null,
  DAL: null,
  DEN: null,
  DET: null,
  GB: null,
  HOU: null,
  IND: null,
  JAC: null,
  KC: null,
  LV: null,
  LAC: null,
  LAR: null,
  MIA: null,
  MIN: null,
  NE: null,
  NO: null,
  NYG: null,
  NYJ: null,
  PHI: null,
  PIT: null,
  SEA: null,
  SF: null,
  TB: null,
  TEN: null,
  WAS: null,
};
