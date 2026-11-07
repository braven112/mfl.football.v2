/**
 * The player index behind the header's inline search, one file per league that
 * has search (getSearchPath). Built from the committed MFL feeds
 * (src/utils/player-search-index.ts) through the league-data loader.
 *
 * Rendered on request and cached at the CDN, not prerendered: the roster sync
 * publishes those feeds without a build, so a prerendered file would keep
 * listing the rosters of the last deploy.
 *
 * It carries ids, not hrefs: the roster and Free Agents links depend on the
 * visitor's host (prefixed or not), which a cached file cannot know, so the
 * panel builds them from hrefs the header renders server-side.
 */
import type { APIRoute } from 'astro';
import { ALL_LEAGUES, type CanonicalLeagueSlug } from '../../../config/leagues';
import { getSearchPath } from '../../../utils/nav-utils';
import { buildPlayerSearchIndex, preloadPlayerSearchIndex } from '../../../utils/player-search-index';

export const prerender = false;

/** Leagues with header search — the set the prerendered files used to cover. */
const SEARCH_LEAGUES = new Set<string>(
  ALL_LEAGUES.map((l) => l.slug as CanonicalLeagueSlug).filter((slug) => getSearchPath(slug)),
);

/** Five minutes fresh at the CDN, then served stale while it refetches. */
export const PLAYER_SEARCH_CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400';

export const GET: APIRoute = async ({ params }) => {
  const league = params.league as CanonicalLeagueSlug;
  if (!SEARCH_LEAGUES.has(league)) return new Response('Not found', { status: 404 });
  await preloadPlayerSearchIndex(league);
  const { teams, players } = buildPlayerSearchIndex(league);
  return new Response(JSON.stringify({ teams, players }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': PLAYER_SEARCH_CACHE_CONTROL },
  });
};
