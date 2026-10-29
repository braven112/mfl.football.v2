/**
 * The player index behind the header's inline search, one static file per
 * league that has search (getSearchPath). Prerendered from the committed MFL
 * feeds (src/utils/player-search-index.ts), so it is rebuilt with every sync
 * commit like the rest of the build-baked pages and served from the CDN.
 *
 * It carries ids, not hrefs: the roster and Free Agents links depend on the
 * visitor's host (prefixed or not), which a static file cannot know, so the
 * panel builds them from hrefs the header renders server-side.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { ALL_LEAGUES, type CanonicalLeagueSlug } from '../../../config/leagues';
import { getSearchPath } from '../../../utils/nav-utils';
import { buildPlayerSearchIndex, preloadPlayerSearchIndex } from '../../../utils/player-search-index';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = () =>
  ALL_LEAGUES.map((l) => l.slug as CanonicalLeagueSlug)
    .filter((slug) => getSearchPath(slug))
    .map((league) => ({ params: { league } }));

export const GET: APIRoute = async ({ params }) => {
  const league = params.league as CanonicalLeagueSlug;
  await preloadPlayerSearchIndex(league);
  const { teams, players } = buildPlayerSearchIndex(league);
  return new Response(JSON.stringify({ teams, players }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
