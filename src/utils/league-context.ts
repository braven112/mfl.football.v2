/**
 * League context utilities
 * Determines which league context we're in based on URL path
 */

export interface LeagueContext {
  host: string;
  leagueId: string;
  name: string;
  slug: string; // 'theleague' or 'afl-fantasy'
  dataPath: string; // 'data/theleague' or 'data/afl-fantasy'
}

const defaultMflHost =
  (import.meta.env.PUBLIC_MFL_HOST as string | undefined) || 'www49.myfantasyleague.com/';

const normalizeHost = (value: string) =>
  value.replace(/^https?:\/\//, '').replace(/\/+$/, '');

/**
 * Get league context from URL
 * @param url - The current URL (e.g., from Astro.url)
 * @returns League context information
 */
export function getLeagueContext(url: URL): LeagueContext {
  const pathname = url.pathname;
  const host = normalizeHost(defaultMflHost);

  // Check if URL starts with /afl-fantasy
  if (pathname.startsWith('/afl-fantasy')) {
    return {
      host,
      leagueId: '19621',
      name: 'American Football League',
      slug: 'afl-fantasy',
      dataPath: 'data/afl-fantasy',
    };
  }

  // Check if URL starts with /theleague
  if (pathname.startsWith('/theleague')) {
    return {
      host,
      leagueId: '13522',
      name: 'The League',
      slug: 'theleague',
      dataPath: 'data/theleague',
    };
  }

  // Default to The League for backward compatibility
  return {
    host,
    leagueId: '13522',
    name: 'The League',
    slug: 'theleague',
    dataPath: 'data/theleague',
  };
}

/**
 * Get the base URL for the current league
 * @param league - League context
 * @returns Base URL (e.g., '/theleague' or '/afl-fantasy')
 */
export function getLeagueBaseUrl(league: LeagueContext): string {
  return `/${league.slug}`;
}

/**
 * Cross-league team ownership mapping
 * Maps franchise IDs between TheLeague and AFL for owners who have teams in both leagues
 *
 * Format: { theLeagueFranchiseId: aflFranchiseId }
 */
const CROSS_LEAGUE_TEAM_MAP: Record<string, string> = {
  // Pigskins (TheLeague) ↔ Smokane FC (AFL)
  '0001': '0001',
  // Da Dangsters (both leagues)
  '0002': '0006',
  // Mariachi Ninjas (both leagues)
  '0005': '0015',
  // Music City Mafia (TheLeague) ↔ Boondock Saints (AFL)
  '0006': '0020',
  // Computer Jocks (both leagues)
  '0010': '0005',
  // Midwestside Connection (both leagues)
  '0011': '0011',
  // Vitside Mafia (both leagues)
  '0012': '0009',
};

/**
 * Build reverse mapping (AFL → TheLeague)
 */
const AFL_TO_THELEAGUE_MAP: Record<string, string> = Object.entries(
  CROSS_LEAGUE_TEAM_MAP
).reduce(
  (acc, [theLeagueId, aflId]) => {
    acc[aflId] = theLeagueId;
    return acc;
  },
  {} as Record<string, string>
);

/**
 * Check if a team has ownership in both leagues
 * @param franchiseId - The franchise ID to check
 * @param currentLeague - Which league the franchise ID is from ('theleague' or 'afl')
 * @returns true if the team owner has teams in both leagues
 */
export function hasTeamInBothLeagues(
  franchiseId: string | undefined | null,
  currentLeague: 'theleague' | 'afl'
): boolean {
  if (!franchiseId) return false;

  if (currentLeague === 'theleague') {
    return franchiseId in CROSS_LEAGUE_TEAM_MAP;
  } else {
    return franchiseId in AFL_TO_THELEAGUE_MAP;
  }
}

/**
 * Get the corresponding franchise ID in the other league
 * @param franchiseId - The franchise ID to look up
 * @param currentLeague - Which league the franchise ID is from
 * @returns The franchise ID in the other league, or null if not found
 */
export function getOtherLeagueFranchiseId(
  franchiseId: string | undefined | null,
  currentLeague: 'theleague' | 'afl'
): string | null {
  if (!franchiseId) return null;

  if (currentLeague === 'theleague') {
    return CROSS_LEAGUE_TEAM_MAP[franchiseId] || null;
  } else {
    return AFL_TO_THELEAGUE_MAP[franchiseId] || null;
  }
}
