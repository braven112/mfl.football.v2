/**
 * League context utilities
 * Determines which league context we're in based on URL path
 */

export interface LeagueContext {
  leagueId: string;
  name: string;
  slug: string; // 'theleague' or 'afl-fantasy'
  dataPath: string; // 'data/theleague' or 'data/afl-fantasy'
}

/**
 * Get league context from URL
 * @param url - The current URL (e.g., from Astro.url)
 * @returns League context information
 */
export function getLeagueContext(url: URL): LeagueContext {
  const pathname = url.pathname;

  // Check if URL starts with /afl-fantasy
  if (pathname.startsWith('/afl-fantasy')) {
    return {
      leagueId: '19621',
      name: 'American Football League',
      slug: 'afl-fantasy',
      dataPath: 'data/afl-fantasy',
    };
  }

  // Check if URL starts with /theleague
  if (pathname.startsWith('/theleague')) {
    return {
      leagueId: '13522',
      name: 'The League',
      slug: 'theleague',
      dataPath: 'data/theleague',
    };
  }

  // Default to The League for backward compatibility
  return {
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
