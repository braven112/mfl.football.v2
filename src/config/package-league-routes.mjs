/**
 * The pages a package league gets, and the feature that entitles each.
 *
 * One table, read by two things that must agree:
 *   - scripts/new-league.mjs generates exactly these routes for a new league
 *     (from Archie's, the package-league template), skipping any whose feature
 *     is off;
 *   - scripts/article-utils/article-links.mjs lets Schefter link a package
 *     league's page only when the league has it.
 * Data, not a filesystem check, because article links are also resolved in
 * the deployed site, where src/pages does not exist.
 *
 * `null` = every package league gets it. A route absent here is never
 * generated: Archie's own competition (The Gauntlet) and its theme previews.
 */
export const PACKAGE_ROUTES = {
  'index.astro': null,
  'standings.astro': null,
  'rosters.astro': null,
  'transactions.astro': null,
  'free-agents.astro': null,
  'calendar.astro': null,
  'login.astro': null,
  'forbidden.astro': null,
  'brand.astro': null,
  'brand/[team].astro': null,
  'whats-new/index.astro': null,
  'whats-new/[id].astro': null,
  'import-rankings.astro': null,
  'front-office/trade-builder.astro': null,
  'live-scoring.astro': 'liveScoring',
  'broadcast.astro': 'liveScoring',
  'news.astro': 'schefterFeed',
  'news/[id].astro': 'schefterFeed',
  'admin/news.astro': 'schefterFeed',
  'pecking-order/index.astro': 'powerRankings',
  'pecking-order/[year]/[week].astro': 'powerRankings',
  'admin/branding.astro': 'brandingEditor',
};

/** The routes a features object entitles, relative to the league's page dir. */
export function packageRoutesFor(features) {
  return Object.entries(PACKAGE_ROUTES)
    .filter(([, feature]) => feature === null || Boolean(features?.[feature]))
    .map(([route]) => route);
}

/**
 * `/standings` → `standings.astro`; `/pecking-order` → `pecking-order/index.astro`.
 * Null for a path no package route serves.
 */
export function packageRouteForPath(p) {
  const rest = String(p).split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
  if (!rest) return 'index.astro';
  return (
    Object.keys(PACKAGE_ROUTES).find((r) => r.replace(/\.astro$/, '').replace(/\/?index$/, '') === rest) ?? null
  );
}

/** Whether a package league (registry entry) has the page at an unprefixed path. */
export function packageLeagueHasPath(league, p) {
  const route = packageRouteForPath(p);
  if (!route) return false;
  const feature = PACKAGE_ROUTES[route];
  return feature === null || Boolean(league?.features?.[feature]);
}
