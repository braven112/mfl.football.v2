/**
 * NFL club brand colors and team-code aliases: the ONE copy of this table.
 *
 * Pure data with no imports, so both the website (`src/utils/nfl-team-colors.ts`
 * and `src/utils/nfl-logo.ts` re-export from here) and the MFL Football phone
 * app (`apps/mobile`, which bundles this file directly) read the same values.
 * Colors are facts about a club, not its marks: no logos live here.
 *
 * Keyed by ESPN-format codes, the ones `normalizeNflTeamCode()` produces.
 * Primary is the color the club is recognized by; secondary is its strongest
 * complementary color (not always the "official" second color when that would
 * be near-white and useless on dark grounds).
 */

export interface NflTeamColors {
  /** Dominant brand color: gradient anchor. */
  primary: string;
  /** Complementary brand color: accents, glows. */
  secondary: string;
}

export const NFL_TEAM_COLORS: Record<string, NflTeamColors> = {
  ARI: { primary: '#97233f', secondary: '#ffb612' },
  ATL: { primary: '#a71930', secondary: '#101820' },
  BAL: { primary: '#241773', secondary: '#9e7c0c' },
  BUF: { primary: '#00338d', secondary: '#c60c30' },
  CAR: { primary: '#0085ca', secondary: '#101820' },
  CHI: { primary: '#0b162a', secondary: '#c83803' },
  CIN: { primary: '#fb4f14', secondary: '#101820' },
  CLE: { primary: '#311d00', secondary: '#ff3c00' },
  DAL: { primary: '#003594', secondary: '#869397' },
  DEN: { primary: '#fb4f14', secondary: '#002244' },
  DET: { primary: '#0076b6', secondary: '#b0b7bc' },
  GB: { primary: '#203731', secondary: '#ffb612' },
  HOU: { primary: '#03202f', secondary: '#a71930' },
  IND: { primary: '#002c5f', secondary: '#a2aaad' },
  JAX: { primary: '#006778', secondary: '#d7a22a' },
  KC: { primary: '#e31837', secondary: '#ffb81c' },
  LAC: { primary: '#0080c6', secondary: '#ffc20e' },
  LAR: { primary: '#003594', secondary: '#ffa300' },
  LV: { primary: '#101820', secondary: '#a5acaf' },
  MIA: { primary: '#008e97', secondary: '#fc4c02' },
  MIN: { primary: '#4f2683', secondary: '#ffc62f' },
  NE: { primary: '#002244', secondary: '#c60c30' },
  NO: { primary: '#101820', secondary: '#d3bc8d' },
  NYG: { primary: '#0b2265', secondary: '#a71930' },
  NYJ: { primary: '#125740', secondary: '#101820' },
  PHI: { primary: '#004c54', secondary: '#a5acaf' },
  PIT: { primary: '#101820', secondary: '#ffb612' },
  SEA: { primary: '#002244', secondary: '#69be28' },
  SF: { primary: '#aa0000', secondary: '#b3995d' },
  TB: { primary: '#d50a0a', secondary: '#34302b' },
  TEN: { primary: '#0c2340', secondary: '#4b92db' },
  WSH: { primary: '#5a1414', secondary: '#ffb612' },
};

/**
 * Team code mapping from MFL / legacy formats to ESPN format. Free agents map
 * to `NFL` (the shield on the website), which has no colors.
 */
export const NFL_TEAM_CODE_ALIASES: Record<string, string> = {
  WAS: 'WSH', // Washington
  JAC: 'JAX', // Jacksonville
  GBP: 'GB', // Green Bay
  KCC: 'KC', // Kansas City
  NEP: 'NE', // New England
  NOS: 'NO', // New Orleans
  SFO: 'SF', // San Francisco
  TBB: 'TB', // Tampa Bay
  LVR: 'LV', // Las Vegas
  HST: 'HOU', // Houston
  BLT: 'BAL', // Baltimore
  CLV: 'CLE', // Cleveland
  ARZ: 'ARI', // Arizona
  OAK: 'LV', // Oakland Raiders → Las Vegas
  SDC: 'LAC', // San Diego Chargers → LA Chargers
  SD: 'LAC', // San Diego Chargers (alt code)
  RAM: 'LAR', // Rams (historical MFL code)
  STL: 'LAR', // St. Louis Rams → LA Rams
  FA: 'NFL', // Free agent → NFL shield
  'FA*': 'NFL', // Conditional free agent (MFL) → NFL shield
  UFA: 'NFL', // Unrestricted free agent → NFL shield
};

/** Any team code (MFL or ESPN, any case) in ESPN format; '' stays ''. */
export function normalizeNflTeamCode(teamCode: string): string {
  if (!teamCode) return '';
  const upper = teamCode.toUpperCase();
  return NFL_TEAM_CODE_ALIASES[upper] || upper;
}

/**
 * A club's colors for a code in any format, or null for a free agent or a
 * code that names no current club. Callers choose their own fallback.
 */
export function findNflTeamColors(teamCode: string): NflTeamColors | null {
  const code = normalizeNflTeamCode(teamCode);
  return Object.prototype.hasOwnProperty.call(NFL_TEAM_COLORS, code) ? NFL_TEAM_COLORS[code] : null;
}
