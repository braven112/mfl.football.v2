/**
 * NFL Team Logo Utilities
 * 
 * Reusable functions for displaying NFL team logos across the application.
 * These utilities handle team code normalization and provide consistent
 * logo URLs from ESPN's CDN.
 * 
 * @example
 * ```typescript
 * import { getNFLTeamLogo, normalizeTeamCode } from '@/utils/nfl-logo';
 * 
 * // Get a logo URL
 * const logoUrl = getNFLTeamLogo('WAS'); // Returns normalized WSH logo
 * 
 * // Use in HTML
 * <img src={getNFLTeamLogo(player.team)} alt={player.team} />
 * 
 * // Dark variant for dark backgrounds
 * <img src={getNFLTeamLogo(player.team, 'dark')} alt={player.team} />
 * ```
 */

/**
 * NFL Team full names (ESPN format codes)
 */
export const NFL_TEAM_NAMES: Record<string, string> = {
  'ARI': 'Arizona Cardinals',
  'ATL': 'Atlanta Falcons',
  'BAL': 'Baltimore Ravens',
  'BUF': 'Buffalo Bills',
  'CAR': 'Carolina Panthers',
  'CHI': 'Chicago Bears',
  'CIN': 'Cincinnati Bengals',
  'CLE': 'Cleveland Browns',
  'DAL': 'Dallas Cowboys',
  'DEN': 'Denver Broncos',
  'DET': 'Detroit Lions',
  'GB': 'Green Bay Packers',
  'HOU': 'Houston Texans',
  'IND': 'Indianapolis Colts',
  'JAX': 'Jacksonville Jaguars',
  'KC': 'Kansas City Chiefs',
  'LAC': 'Los Angeles Chargers',
  'LAR': 'Los Angeles Rams',
  'LV': 'Las Vegas Raiders',
  'MIA': 'Miami Dolphins',
  'MIN': 'Minnesota Vikings',
  'NE': 'New England Patriots',
  'NO': 'New Orleans Saints',
  'NYG': 'New York Giants',
  'NYJ': 'New York Jets',
  'PHI': 'Philadelphia Eagles',
  'PIT': 'Pittsburgh Steelers',
  'SEA': 'Seattle Seahawks',
  'SF': 'San Francisco 49ers',
  'TB': 'Tampa Bay Buccaneers',
  'TEN': 'Tennessee Titans',
  'WSH': 'Washington Commanders'
};

/**
 * Team code mapping from MFL format to ESPN/Standard format
 */
const TEAM_CODE_MAP: Record<string, string> = {
  'WAS': 'WSH', // Washington
  'JAC': 'JAX', // Jacksonville
  'GBP': 'GB',  // Green Bay
  'KCC': 'KC',  // Kansas City
  'NEP': 'NE',  // New England
  'NOS': 'NO',  // New Orleans
  'SFO': 'SF',  // San Francisco
  'TBB': 'TB',  // Tampa Bay
  'LVR': 'LV',  // Las Vegas
  'HST': 'HOU', // Houston
  'BLT': 'BAL', // Baltimore
  'CLV': 'CLE', // Cleveland
  'ARZ': 'ARI'  // Arizona
};

/**
 * Normalize team codes from MFL format to ESPN/Standard format
 * 
 * This handles the various team code inconsistencies between different
 * data sources (MFL uses WAS, ESPN uses WSH, etc.)
 * 
 * @param teamCode - Team abbreviation in any format (e.g., 'WAS', 'JAC', 'GBP')
 * @returns Normalized team code in ESPN format (e.g., 'WSH', 'JAX', 'GB')
 * 
 * @example
 * ```typescript
 * normalizeTeamCode('WAS') // => 'WSH'
 * normalizeTeamCode('JAC') // => 'JAX'
 * normalizeTeamCode('DAL') // => 'DAL' (unchanged)
 * normalizeTeamCode('') // => ''
 * ```
 */
export function normalizeTeamCode(teamCode: string): string {
  if (!teamCode) return '';
  const upper = teamCode.toUpperCase();
  return TEAM_CODE_MAP[upper] || upper;
}

/**
 * Get NFL team logo URL from ESPN CDN
 * 
 * Returns a high-quality (500px) team logo from ESPN's CDN. Automatically
 * normalizes team codes and handles dark mode variants.
 * 
 * @param teamCode - Team abbreviation (e.g., 'WAS', 'DAL', 'GB')
 * @param variant - Optional 'dark' variant for dark backgrounds
 * @returns ESPN CDN URL for team logo (500px resolution)
 * 
 * @example
 * ```typescript
 * // Standard logo
 * getNFLTeamLogo('WAS') 
 * // => 'https://a.espncdn.com/i/teamlogos/nfl/500/WSH.png'
 * 
 * // Dark variant
 * getNFLTeamLogo('DAL', 'dark')
 * // => 'https://a.espncdn.com/i/teamlogos/nfl/500-dark/DAL.png'
 * 
 * // Use in Astro component
 * <img src={getNFLTeamLogo(player.team)} alt={player.team} />
 * 
 * // Use in client-side code
 * const logoUrl = getNFLTeamLogo(teamCode);
 * imgElement.src = logoUrl;
 * ```
 */
export function getNFLTeamLogo(teamCode: string, variant?: 'dark'): string {
  const code = normalizeTeamCode(teamCode);
  if (!code) return '';
  
  const path = variant === 'dark' ? '500-dark' : '500';
  return `https://a.espncdn.com/i/teamlogos/nfl/${path}/${code}.png`;
}

/**
 * Get all valid NFL team codes (ESPN format)
 * 
 * Useful for validation, dropdowns, or iterating over all teams.
 * 
 * @returns Array of all valid NFL team codes in ESPN format
 * 
 * @example
 * ```typescript
 * const teams = getAllNFLTeamCodes();
 * // => ['ARI', 'ATL', 'BAL', 'BUF', ...]
 * 
 * // Use in a dropdown
 * teams.map(code => ({
 *   value: code,
 *   label: code,
 *   logo: getNFLTeamLogo(code)
 * }))
 * ```
 */
export function getAllNFLTeamCodes(): string[] {
  return [
    'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
    'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
    'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
    'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH'
  ];
}

/**
 * Check if a team code is valid
 * 
 * @param teamCode - Team abbreviation to validate
 * @returns True if the team code is valid
 * 
 * @example
 * ```typescript
 * isValidTeamCode('DAL') // => true
 * isValidTeamCode('WAS') // => true (normalized to WSH)
 * isValidTeamCode('XXX') // => false
 * ```
 */
export function isValidTeamCode(teamCode: string): boolean {
  const normalized = normalizeTeamCode(teamCode);
  return getAllNFLTeamCodes().includes(normalized);
}

/**
 * Get NFL team full name from team code
 *
 * @param teamCode - Team abbreviation (e.g., 'WAS', 'DAL', 'GB')
 * @returns Full team name (e.g., 'Dallas Cowboys')
 *
 * @example
 * ```typescript
 * getNFLTeamName('DAL') // => 'Dallas Cowboys'
 * getNFLTeamName('WAS') // => 'Washington Commanders' (normalized)
 * getNFLTeamName('GB')  // => 'Green Bay Packers'
 * ```
 */
export function getNFLTeamName(teamCode: string): string {
  const code = normalizeTeamCode(teamCode);
  return NFL_TEAM_NAMES[code] || code;
}
