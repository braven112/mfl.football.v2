/**
 * Team name utilities for consistent display across the app
 */

/**
 * Maximum length for team names to prevent UI overflow
 */
export const MAX_TEAM_NAME_LENGTH = 15;

/**
 * Choose the best team name from a list of candidates with a maximum length limit.
 *
 * Logic:
 * 1. Filter to names that are <= MAX_TEAM_NAME_LENGTH characters
 * 2. Return the longest name that fits within the limit
 * 3. If all names are too long, truncate the shortest one
 *
 * This ensures consistent team name display across all leagues (theleague, afl-fantasy)
 * and prevents UI overflow issues.
 *
 * @param candidates - Array of possible names (teamName, asset name, aliases, etc.)
 * @returns The best team name that fits within the character limit
 *
 * @example
 * ```ts
 * // With valid short names
 * chooseTeamName(['Dark Magicians of Chaos', 'Dark Magicians', 'DMC'])
 * // Returns: 'Dark Magicians' (longest under 15 chars)
 *
 * // All names too long
 * chooseTeamName(['A Very Long Team Name That Exceeds Limit'])
 * // Returns: 'A Very Long Te' (truncated to 15 chars)
 *
 * // With aliases from assets
 * chooseTeamName([
 *   team.teamName,
 *   assets?.name || '',
 *   ...(assets?.aliases || [])
 * ])
 * ```
 */
export function chooseTeamName(candidates: string[]): string {
  const unique = Array.from(new Set(candidates.filter(Boolean)));
  if (unique.length === 0) return '';

  // Filter to names that are within the character limit
  const validNames = unique.filter(name => name.length <= MAX_TEAM_NAME_LENGTH);

  if (validNames.length > 0) {
    // Return the longest name that fits within the limit
    return validNames.reduce((best, current) =>
      current.length > best.length ? current : best
    );
  }

  // If all names are too long, find the shortest and truncate it
  const shortest = unique.reduce((best, current) =>
    current.length < best.length ? current : best
  );
  return shortest.substring(0, MAX_TEAM_NAME_LENGTH).trim();
}
