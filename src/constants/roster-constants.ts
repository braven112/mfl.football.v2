/**
 * Roster and player constants for fantasy football
 * Shared across roster, salary, and MVP pages
 */

import { normalizeTeamCode } from '../utils/nfl-logo';
import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../config/leagues';

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
 * Default player headshot URL when player image is unavailable.
 *
 * Host verification (Phase 2 registry sweep): live requests to
 * www49/www44.myfantasyleague.com to compare player-photo bytes across MFL
 * hosts were blocked by this environment's egress policy (myfantasyleague.com
 * is not allow-listed for the sandbox — see the proxy status endpoint), so
 * host-agnosticism could not be empirically confirmed here. Chose the
 * conservative assumption (per-league host) rather than asserting
 * host-agnostic without proof. This constant covers the overwhelming
 * majority of call sites, which are all TheLeague-only pages/components, so
 * it stays pinned to TheLeague's registry host — behavior-preserving for
 * those. AFL call sites must use {@link getPlayerImageUrl} /
 * {@link getPlayerHeadshot} with `leagueSlug: 'afl-fantasy'` instead of this
 * constant. A future session with MFL host access should confirm
 * host-agnosticism and simplify back to one shared host if true.
 */
export const DEFAULT_HEADSHOT_URL =
  `https://${getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!.mflHost}/player_photos_2010/no_photo_available.jpg`;

/**
 * Get player headshot URL by player ID.
 *
 * @param playerId - MFL player ID
 * @param leagueSlug - Canonical league slug whose MFL host serves the photo
 *   (defaults to the default league — TheLeague — preserving prior
 *   behavior for the ~20 TheLeague-only call sites). AFL call sites should
 *   pass 'afl-fantasy' explicitly.
 * @returns URL to player headshot image
 */
export function getPlayerImageUrl(playerId?: string, leagueSlug: string = DEFAULT_LEAGUE_SLUG): string {
  const host = getLeagueBySlug(leagueSlug)?.mflHost ?? getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!.mflHost;
  return playerId
    ? `https://${host}/player_photos_big_2014/${playerId}_thumb.jpg`
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
 *
 * Uses ESPN's *direct* headshot endpoint (not the combiner CDN). The combiner
 * variant — `a.espncdn.com/combiner/i?img=...&w=96&h=70` — resizes to a
 * thumbnail at the CDN, which is bandwidth-friendly for avatar tiles BUT
 * silently returns nothing for a handful of players whose entries are stale
 * on the combiner. The direct URL is the canonical source ESPN uses for the
 * same image, has the same hit rate as MFL (every active player), and is what
 * PlayerDetailsModal already calls — so keeping the row's initial src in
 * lockstep means the row and the modal share a cache entry and either both
 * succeed or both fail. (Discovered when Breece Hall rendered as the MFL
 * silhouette on the AFL roster while his modal hero loaded fine: the modal
 * was using the direct URL and the row was using the combiner.)
 *
 * @param mflId - MFL player ID
 * @param espnId - Optional ESPN player ID for higher quality headshots
 * @param leagueSlug - Canonical league slug for the MFL-photo fallback (see
 *   {@link getPlayerImageUrl}); irrelevant when espnId is present.
 * @returns URL to player headshot image
 */
export function getPlayerHeadshot(mflId?: string, espnId?: string, leagueSlug: string = DEFAULT_LEAGUE_SLUG): string {
  if (espnId) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }
  return getPlayerImageUrl(mflId, leagueSlug);
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
