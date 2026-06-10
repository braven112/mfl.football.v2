/**
 * Pure host/path → league-slug + rewrite-target resolver.
 *
 * Lives in src/utils so it's importable by both src/middleware.ts (which
 * pulls in astro:middleware and can't be unit-tested directly) and by
 * vitest.
 *
 * Adding a new league domain: add it to the league's `domains` array in
 * src/config/leagues-data.mjs. The afl-fantasy.com entries are wired in but
 * dormant — flipping live requires DNS + Vercel domain attachment
 * (AFL_DUPLICATION_PLAN §2.3, Phase 7).
 */

import { buildHostToSlugMap } from '../config/leagues';

/**
 * Map of apex hostnames → league slug (the path segment under src/pages/).
 * Derived from the league registry; both bare host and `www.` variants are
 * listed there.
 */
export const HOST_TO_SLUG: Readonly<Record<string, string>> = buildHostToSlugMap();

// Slug prefixes get a trailing slash so /theleagueX doesn't match /theleague
// as a substring. The exact path /theleague (no trailing slash) is caught
// by the slug-already-prefixed check inside resolveLeagueRewrite.
const ALL_LEAGUE_PREFIX_SLASHES: readonly string[] = Array.from(
  new Set(Object.values(HOST_TO_SLUG))
).map((slug) => `/${slug}/`);

/**
 * Paths that exist at the root level and should NOT be rewritten under
 * a league prefix when serving from a league apex host. Includes every
 * known league prefix so cross-league deep links continue working from
 * either host (e.g. an /afl-fantasy/* link visited from theleague.us
 * still resolves to the AFL page).
 */
export const SKIP_REWRITE_PREFIXES: readonly string[] = [
  '/api/',
  ...ALL_LEAGUE_PREFIX_SLASHES,
  '/_astro/',
  '/_image',
  '/_server-islands/',
  '/forum/',
  '/404',
  '/favicon.ico',
  '/assets/',
  '/manifest.json',
];

export interface LeagueRewrite {
  newPath: string;
  slug: string;
}

/**
 * Resolve a `(hostname, pathname)` pair to a rewrite target.
 *
 * @returns The rewritten pathname when the request should be rewritten under
 *   a league prefix, or `null` when no rewrite is needed.
 */
export function resolveLeagueRewrite(
  hostname: string,
  pathname: string
): LeagueRewrite | null {
  const slug = HOST_TO_SLUG[hostname];
  if (!slug) return null;

  const slugPrefix = `/${slug}`;
  if (pathname === slugPrefix || pathname.startsWith(`${slugPrefix}/`)) {
    return null;
  }

  if (SKIP_REWRITE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  const newPath = pathname === '/' ? slugPrefix : `${slugPrefix}${pathname}`;
  return { newPath, slug };
}
