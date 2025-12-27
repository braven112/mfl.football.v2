/**
 * Team name utilities for consistent display across the app
 */

/**
 * Maximum length for team names to prevent UI overflow
 */
export const MAX_TEAM_NAME_LENGTH = 15;
export const MAX_SHORT_NAME_LENGTH = 10;

/**
 * Choose the best team name from available options with a maximum length limit.
 *
 * 4-Tier Naming System:
 * 1. Full Name (any length) - from MFL or config
 * 2. Medium Name (≤15 chars) - for brackets/cards (default context)
 * 3. Short Name (≤10 chars) - for mobile/tight spaces
 * 4. Abbreviation (2-4 chars) - MFL abbrev
 *
 * @param options - Team name options
 * @param options.fullName - Full team name (any length)
 * @param options.nameMedium - Medium name (≤15 chars, preferred for default display)
 * @param options.nameShort - Short name (≤10 chars)
 * @param options.abbrev - MFL abbreviation
 * @param options.mflTeamName - Team name from MFL API
 * @param options.aliases - Additional name aliases
 * @param context - Display context: 'default' (≤15), 'short' (≤10), 'abbrev' (use abbreviation)
 * @returns The best team name for the given context
 *
 * @example
 * ```ts
 * // Default context (≤15 chars) - for playoff brackets
 * chooseTeamName({
 *   fullName: 'Dark Magicians of Chaos',
 *   nameMedium: 'Dark Magicians',
 *   nameShort: 'DMOC',
 *   abbrev: undefined
 * }) // Returns: 'Dark Magicians'
 *
 * // Short context (≤10 chars) - for mobile
 * chooseTeamName({
 *   fullName: 'Dark Magicians of Chaos',
 *   nameMedium: 'Dark Magicians',
 *   nameShort: 'DMOC',
 * }, 'short') // Returns: 'DMOC'
 * ```
 */
export function chooseTeamName(
  options: {
    fullName?: string;
    nameMedium?: string;
    nameShort?: string;
    abbrev?: string;
    mflTeamName?: string;
    aliases?: string[];
  },
  context: 'default' | 'short' | 'abbrev' = 'default'
): string {
  // Handle legacy array format for backward compatibility
  if (Array.isArray(options)) {
    return chooseTeamNameLegacy(options);
  }

  const { fullName, nameMedium, nameShort, abbrev, mflTeamName, aliases = [] } = options;

  // Context-based selection
  if (context === 'abbrev' && abbrev) {
    return abbrev;
  }

  if (context === 'short') {
    // For short context, prefer nameShort, then abbrev, then derive from aliases
    if (nameShort && nameShort.length <= MAX_SHORT_NAME_LENGTH) {
      return nameShort;
    }
    if (abbrev) {
      return abbrev;
    }
    // Fallback: find best short option from all names
    const allNames = [nameMedium, fullName, mflTeamName, ...aliases].filter(Boolean) as string[];
    const validShort = allNames.filter(n => n.length <= MAX_SHORT_NAME_LENGTH);
    if (validShort.length > 0) {
      return validShort.reduce((best, curr) => curr.length > best.length ? curr : best);
    }
  }

  // Default context (≤15 chars) - for brackets/cards
  if (nameMedium && nameMedium.length <= MAX_TEAM_NAME_LENGTH) {
    return nameMedium;
  }

  // Fallback: find best medium option from all names
  const allNames = [fullName, mflTeamName, ...aliases].filter(Boolean) as string[];
  const validMedium = allNames.filter(n => n.length <= MAX_TEAM_NAME_LENGTH);
  if (validMedium.length > 0) {
    return validMedium.reduce((best, curr) => curr.length > best.length ? curr : best);
  }

  // Last resort: truncate the shortest available name
  if (allNames.length > 0) {
    const shortest = allNames.reduce((best, curr) =>
      curr.length < best.length ? curr : best
    );
    return shortest.substring(0, MAX_TEAM_NAME_LENGTH).trim();
  }

  return (fullName || mflTeamName || 'Team').substring(0, MAX_TEAM_NAME_LENGTH).trim();
}

/**
 * Legacy array-based chooseTeamName for backward compatibility
 * @deprecated Use object-based chooseTeamName instead
 */
function chooseTeamNameLegacy(candidates: string[]): string {
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
