/**
 * Roster and player constants for fantasy football
 * Shared across roster, salary, and MVP pages
 */

import { normalizeTeamCode } from '../utils/nfl-logo';

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
    ? `https://www49.myfantasyleague.com/player_photos_big_2014/${playerId}_thumb.jpg`
    : DEFAULT_HEADSHOT_URL;
}

/**
 * Get ESPN college football headshot URL.
 * Useful as a fallback for rookies who may not yet have an NFL headshot.
 * @param espnId - ESPN player ID
 * @returns URL to college football headshot image
 */
export function getCollegeHeadshot(espnId: string): string {
  return `https://a.espncdn.com/i/headshots/college-football/players/full/${espnId}.png`;
}

/**
 * Resolve the best ESPN ID for a player from available data sources.
 *
 * Priority:
 *   1. MFL player feed `espn_id` (covers ~1800 players — the primary source)
 *   2. College ID mapping `espnCollegeId` (covers ~90 rookies without NFL headshots)
 *
 * @param mflId - MFL player ID
 * @param playerData - Player object from MFL players API/feed (has `espn_id` field)
 * @param collegeIdMap - Map of MFL ID → { espnCollegeId } from espn-college-ids.json
 * @returns ESPN ID string or null
 */
export function resolveEspnId(
  mflId: string,
  playerData?: { espn_id?: string } | null,
  collegeIdMap?: Record<string, { espnCollegeId?: string }> | null,
): string | null {
  return playerData?.espn_id || collegeIdMap?.[mflId]?.espnCollegeId || null;
}

/**
 * Get player headshot URL, preferring ESPN high-quality images when available.
 * Falls back to MFL photo, then to default placeholder.
 * @param mflId - MFL player ID
 * @param espnId - Optional ESPN player ID for higher quality headshots
 * @returns URL to player headshot image
 */
export function getPlayerHeadshot(mflId?: string, espnId?: string): string {
  if (espnId) {
    return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnId}.png&w=96&h=70&cb=1`;
  }
  return getPlayerImageUrl(mflId);
}

/**
 * Build an inline onerror handler string that cascades through headshot fallbacks.
 *
 * Fallback chain (when espnId + mflId provided):
 *   ESPN NFL headshot → ESPN College headshot → MFL headshot → default placeholder
 *
 * @param mflId - MFL player ID
 * @param espnId - ESPN player ID
 * @returns Inline JS string for an img onerror attribute
 */
export function buildHeadshotOnerror(mflId?: string, espnId?: string): string {
  if (espnId && mflId) {
    const college = getCollegeHeadshot(espnId);
    const mfl = getPlayerImageUrl(mflId);
    return `this.onerror=function(){this.onerror=function(){this.onerror=null;this.src='${DEFAULT_HEADSHOT_URL}'};this.src='${mfl}'};this.src='${college}'`;
  }
  if (espnId) {
    const college = getCollegeHeadshot(espnId);
    return `this.onerror=function(){this.onerror=null;this.src='${DEFAULT_HEADSHOT_URL}'};this.src='${college}'`;
  }
  return `this.onerror=null;this.src='${DEFAULT_HEADSHOT_URL}'`;
}

/**
 * Get NFL team logo URL by team code
 * @param teamCode - 2-3 letter team code (e.g., 'SF', 'KC')
 * @returns URL to NFL team logo SVG (served locally)
 */
export function getNflLogoUrl(teamCode?: string): string {
  const normalized = normalizeTeamCode(teamCode ?? '');
  if (!normalized || normalized === 'NFL') return '/assets/nfl-logos/NFL.svg';
  return `/assets/nfl-logos/${normalized}.svg`;
}

/**
 * NFL team bye weeks (updated each season)
 * null = not yet determined
 */
export const nflByeWeeks: Record<string, number | null> = {
  ARI: 8,
  ATL: 5,
  BAL: 7,
  BUF: 7,
  CAR: 14,
  CHI: 5,
  CIN: 10,
  CLE: 9,
  DAL: 10,
  DEN: 12,
  DET: 8,
  GB: 5,
  HOU: 6,
  IND: 11,
  JAC: 8,
  KC: 10,
  LAC: 12,
  LAR: 8,
  LV: 8,
  MIA: 12,
  MIN: 6,
  NE: 14,
  NO: 11,
  NYG: 14,
  NYJ: 9,
  PHI: 9,
  PIT: 5,
  SEA: 8,
  SF: 14,
  TB: 9,
  TEN: 10,
  WAS: 12,
};
