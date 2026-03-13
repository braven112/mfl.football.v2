/**
 * Team name utilities for consistent display across the app
 */

/**
 * Maximum length for team names to prevent UI overflow
 */
export const MAX_TEAM_NAME_LENGTH = 15;
export const MAX_SHORT_NAME_LENGTH = 10;
export const HISTORICAL_TEAM_ICON_FALLBACK = '/assets/theleague/history/historical-team-placeholder.svg';
export const HISTORICAL_TEAM_BANNER_FALLBACK = '/assets/theleague/history/historical-team-banner-placeholder.svg';

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
 * A historical identity entry for a franchise that changed names/logos.
 */
export interface FranchiseHistoryEntry {
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  aliases?: string[];
  icon?: string;
  banner?: string;
  groupMe?: string;
  yearStart: number;
  yearEnd: number;
}

/**
 * Maps a current owner's team to the historical franchise ID that represents
 * that owner for a given year. This is only needed when an owner leaves and
 * later returns under a different franchise ID.
 */
export interface OwnerHistoryEntry {
  franchiseId: string;
  yearStart: number;
  yearEnd: number;
}

/**
 * A team config entry from theleague.config.json (with optional history).
 */
export interface TeamConfig {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  aliases?: string[];
  division?: string;
  icon?: string;
  banner?: string;
  groupMe?: string;
  history?: FranchiseHistoryEntry[];
  ownerHistory?: OwnerHistoryEntry[];
}

/**
 * Resolved team identity for a specific year. Contains all display fields
 * needed to render a team's name, icon, and banner.
 */
export interface TeamIdentity {
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  aliases?: string[];
  icon?: string;
  banner?: string;
  groupMe?: string;
  isHistorical: boolean;
}

function normalizeHistoricalAssetUrl(
  url: string | undefined,
  fallback: string
): string | undefined {
  if (!url) return fallback;

  const trimmed = url.trim();
  if (!trimmed) return fallback;

  if (trimmed.startsWith('http://')) {
    return `https://${trimmed.slice('http://'.length)}`;
  }

  return trimmed;
}

/**
 * Get the correct team identity (name, icon, banner) for a specific year.
 *
 * If the team has a `history` array, checks whether the given year falls
 * within any historical entry's yearStart–yearEnd range. If so, returns
 * that historical identity. Otherwise returns the current (top-level) identity.
 *
 * @param team - Team config object (from theleague.config.json)
 * @param year - The year to resolve identity for (e.g., 2025 for historical, 2026 for current)
 * @returns TeamIdentity with the correct name/icon/banner for that year
 *
 * @example
 * ```ts
 * const team = leagueConfig.teams.find(t => t.franchiseId === '0004');
 * getTeamIdentityForYear(team, 2025); // Returns Heavy Chevy identity
 * getTeamIdentityForYear(team, 2026); // Returns Dead Cap Walking identity
 * ```
 */
export function getTeamIdentityForYear(team: TeamConfig, year: number): TeamIdentity {
  if (team.history) {
    for (const entry of team.history) {
      if (year >= entry.yearStart && year <= entry.yearEnd) {
        return {
          name: entry.name,
          nameMedium: entry.nameMedium,
          nameShort: entry.nameShort,
          abbrev: entry.abbrev,
          aliases: entry.aliases,
          icon: normalizeHistoricalAssetUrl(entry.icon, HISTORICAL_TEAM_ICON_FALLBACK),
          banner: normalizeHistoricalAssetUrl(entry.banner, HISTORICAL_TEAM_BANNER_FALLBACK),
          groupMe: entry.groupMe,
          isHistorical: true,
        };
      }
    }
  }

  return {
    name: team.name,
    nameMedium: team.nameMedium,
    nameShort: team.nameShort,
    abbrev: team.abbrev,
    aliases: team.aliases,
    icon: team.icon,
    banner: team.banner,
    groupMe: team.groupMe,
    isHistorical: false,
  };
}

/**
 * Resolve which franchise ID should represent a current owner's team for a
 * given historical season.
 *
 * Most teams simply map to their current franchise ID for all years. When a
 * current owner returned to the league under a different franchise ID, the
 * optional `ownerHistory` mapping lets historical filters/highlights follow the
 * owner's actual lineage instead of the franchise's full identity history.
 */
export function getOwnerHistoryFranchiseIdForYear(team: TeamConfig, year: number): string | null {
  if (!team.ownerHistory?.length) {
    return team.franchiseId;
  }

  for (const entry of team.ownerHistory) {
    if (year >= entry.yearStart && year <= entry.yearEnd) {
      return entry.franchiseId;
    }
  }

  return null;
}

export function resolvePreferredTeamIdForYear<T extends { teams: TeamConfig[] }>(
  config: T,
  preferredTeamId: string | undefined | null,
  year: number
): string | undefined {
  if (!preferredTeamId) return undefined;

  const team = config.teams.find((entry) => entry.franchiseId === preferredTeamId);
  if (!team) return preferredTeamId;

  return getOwnerHistoryFranchiseIdForYear(team, year) ?? undefined;
}

/**
 * Resolve all team identities in a league config for a specific year.
 *
 * Returns a shallow copy of the config with each team's name, icon, banner,
 * etc. resolved to the correct historical identity for the given year.
 * Teams without a `history` array are returned unchanged.
 *
 * This is the primary way to make any page year-aware — call this once
 * with the viewing year, then pass the result to standings/playoffs/etc.
 *
 * @param config - League config object (e.g., from theleague.config.json)
 * @param year - The year to resolve identities for
 * @returns A new config with team identities resolved for the given year
 *
 * @example
 * ```ts
 * const resolvedConfig = resolveConfigForYear(leagueConfig, selectedYear);
 * const standings = getDivisionStandings(franchises, resolvedConfig);
 * ```
 */
export function resolveConfigForYear<T extends { teams: TeamConfig[] }>(config: T, year: number): T {
  return {
    ...config,
    teams: config.teams.map(team => {
      const identity = getTeamIdentityForYear(team, year);
      return {
        ...team,
        name: identity.name,
        nameMedium: identity.nameMedium,
        nameShort: identity.nameShort,
        abbrev: identity.abbrev,
        aliases: identity.aliases,
        icon: identity.icon,
        banner: identity.banner,
        groupMe: identity.groupMe,
      };
    }),
  };
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
