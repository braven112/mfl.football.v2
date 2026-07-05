/**
 * NFL Team Brand Colors
 *
 * Official primary/secondary hex colors for all 32 NFL teams, keyed by
 * ESPN-format team codes (the same codes `normalizeTeamCode()` produces).
 * Powers player composite imagery — team-color gradients behind ESPN
 * headshots — and is reusable anywhere a page needs NFL brand colors
 * (matchup cards, heroes, auction predictor visualizations).
 *
 * @example
 * ```typescript
 * import { getNflTeamColors, getNflTeamNickname, hexToRgba } from '../utils/nfl-team-colors';
 *
 * const { primary, secondary } = getNflTeamColors('CIN'); // '#fb4f14', '#101820'
 * getNflTeamNickname('CIN'); // 'Bengals'
 * hexToRgba('#fb4f14', 0.5); // 'rgba(251, 79, 20, 0.5)'
 * ```
 */

import { normalizeTeamCode, getNFLTeamName } from './nfl-logo';

export interface NflTeamColors {
  /** Dominant brand color — gradient anchor */
  primary: string;
  /** Complementary brand color — accents, glows */
  secondary: string;
}

/**
 * Official brand colors per ESPN team code.
 * Primary is the color the team is recognized by; secondary is the
 * strongest complementary brand color (not always the "official" second
 * color when that would be near-white and useless on dark composites).
 */
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

/** League-neutral fallback (TheLeague blue) for unknown/free-agent codes */
export const NFL_COLORS_FALLBACK: NflTeamColors = {
  primary: '#1c497c',
  secondary: '#8a94a0',
};

/**
 * Get brand colors for a team code in any format (MFL or ESPN).
 * Unknown codes (including 'FA'/'NFL') return the league-neutral fallback.
 */
export function getNflTeamColors(teamCode: string): NflTeamColors {
  return NFL_TEAM_COLORS[normalizeTeamCode(teamCode)] ?? NFL_COLORS_FALLBACK;
}

/**
 * Get a team's nickname (e.g. 'CIN' → 'Bengals') for wordmark treatments.
 * Falls back to the normalized code when the team is unknown.
 */
export function getNflTeamNickname(teamCode: string): string {
  const code = normalizeTeamCode(teamCode);
  const fullName = getNFLTeamName(code);
  if (!fullName || fullName === code) return code;
  return fullName.split(' ').pop() ?? code;
}

/**
 * Convert a #rrggbb hex color to an rgba() string.
 * Invalid input falls back to a neutral dark at the requested alpha.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return `rgba(22, 32, 44, ${alpha})`;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
