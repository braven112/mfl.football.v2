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
import PLAYOFF_BRACKET_LEAGUES from '../../data/playoff-bracket-leagues.json' with { type: 'json' };

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
  'lineup.astro': null,
  'live-scoring.astro': 'liveScoring',
  'broadcast.astro': 'liveScoring',
  'news.astro': 'schefterFeed',
  'news/[id].astro': 'schefterFeed',
  'admin/news.astro': 'schefterFeed',
  'pecking-order/index.astro': 'powerRankings',
  'pecking-order/[year]/[week].astro': 'powerRankings',
  'admin/branding.astro': 'brandingEditor',
  'rules.astro': 'rulesQa',
  'rules-chat.astro': 'rulesQa',
  'playoffs.astro': 'playoffs',
  'franchises/index.astro': 'franchisePages',
  'franchises/[id].astro': 'franchisePages',
  // League History (the $49 History tier and every package league that ticks
  // it): the same shared pages TheLeague and the AFL render.
  'history/index.astro': 'leagueHistory',
  'history/record-book.astro': 'leagueHistory',
  'history/franchises/index.astro': 'leagueHistory',
  'history/ask/index.astro': 'leagueHistory',
  'history/ask/[id].astro': 'leagueHistory',
  'rivalries/index.astro': 'leagueHistory',
  'rivalries/[pair].astro': 'leagueHistory',
  'owners/index.astro': 'leagueHistory',
  'owners/[slug].astro': 'leagueHistory',
  // Every league, always: private to site admins by default (owner-activity-access.ts).
  'activity.astro': null,
  // Every package league; linked only where the registry has a playoffOdds
  // format (DATA_GATES below), since the page has nothing to show without one.
  'playoff-odds.astro': null,
};

/**
 * A History tier league (registry `tier: 'history'`, the $49 product) gets
 * its History pages and nothing else of the site: no standings, rosters or
 * lineups. Of the every-league routes it keeps only these; its homepage
 * (`index.astro`) redirects to `/<slug>/history`, the address the product is
 * sold at (Brandon, 2026-11-14). Upgrading to a full custom site is dropping
 * its tier: the homepage takes the bare address back and History stays put.
 */
export const HISTORY_ONLY_ROUTES = new Set(['index.astro', 'login.astro', 'forbidden.astro']);

/**
 * Routes that also need DATA before they exist for a reader: a page the box
 * entitles but that has nothing to show yet. The route file is still
 * generated (so it is there the moment the data lands, with no sync); the
 * route 404s and its nav and article links stay hidden until then.
 *
 * Playoffs: until MFL has the league's real brackets
 * (src/utils/playoff-bracket-index.mjs — the owner's call, Oct 2026).
 */
const DATA_GATES = {
  'playoffs.astro': (league) => PLAYOFF_BRACKET_LEAGUES.includes(league?.slug),
  'playoff-odds.astro': (league) => Boolean(league?.playoffOdds),
};

/** Whether a route is entitled by these features (and the History-only cut). */
function entitles(route, feature, features, historyOnly) {
  if (feature === null) return !historyOnly || HISTORY_ONLY_ROUTES.has(route);
  return Boolean(features?.[feature]);
}

/**
 * The routes a features object entitles, relative to the league's page dir.
 * Pass the registry entry (or launch spec) as `league` so a History-only
 * league drops the every-league routes it does not get.
 */
export function packageRoutesFor(features, league = null) {
  const historyOnly = league?.tier === 'history';
  return Object.entries(PACKAGE_ROUTES)
    .filter(([route, feature]) => entitles(route, feature, features, historyOnly))
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

/** Whether a registry entry's pages are the package set (registry `pageKit`). */
export function isPackageLeague(league) {
  return league?.pageKit === 'package';
}

/** Whether a package league (registry entry) has the page at an unprefixed path. */
export function packageLeagueHasPath(league, p) {
  const route = packageRouteForPath(p);
  if (!route) return false;
  const entitled = entitles(route, PACKAGE_ROUTES[route], league?.features, league?.tier === 'history');
  return entitled && (DATA_GATES[route]?.(league) ?? true);
}

/** Whether a package league has the data a data-gated route needs (true for an ungated route). */
export function packageRouteHasData(league, route) {
  return DATA_GATES[route]?.(league) ?? true;
}

/**
 * Whether a surface may link `p` for this league: false only for a package
 * league's package route that its features or data do not entitle. `p` may be
 * unprefixed (`/playoffs`, as in nav-config) or league-prefixed
 * (`/archies/playoffs`, as in page-directory.json). Every surface that lists a
 * package league's pages (the nav, the header's icon row, the homepage's quick
 * links) asks this, so a page hidden until its data lands is hidden everywhere.
 */
export function packageLinkVisible(league, p) {
  if (!isPackageLeague(league)) return true;
  const prefix = `/${league.slug}`;
  const bare = p === prefix ? '/' : p.startsWith(`${prefix}/`) ? p.slice(prefix.length) : p;
  return !packageRouteForPath(bare) || packageLeagueHasPath(league, bare);
}
