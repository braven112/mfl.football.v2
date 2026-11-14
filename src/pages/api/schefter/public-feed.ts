/**
 * GET /api/schefter/public-feed?league=<slug>&limit=<n>
 *
 * Public, read-only, CORS-open: the beat reporter's latest league NEWS
 * (transactions, trades, milestones, weekly articles), for embedding off-site.
 * Tips and rumor-mill posts never leave — see src/utils/schefter-public-feed.ts
 * for exactly what is filtered and which fields are exposed.
 *
 * Body: { league: string, posts: Array<{ id, timestamp, kind, headline, excerpt, url }> }
 */

import type { APIRoute } from 'astro';
import { leagueUrl } from '../../../config/leagues';
import { resolveSchefterLeague } from '../../../utils/schefter-league';
import { getSchefterFeedIfAny } from '../../../utils/schefter-league-data';
import { selectPublicFeed } from '../../../utils/schefter-public-feed';

export const prerender = false;

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  // Five minutes at the edge: the feed moves a few times a day, and an
  // embed must never turn into a Redis read per page view.
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
  'Access-Control-Allow-Origin': '*',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  // Never the session: this is the same answer for every caller.
  const league = resolveSchefterLeague({ url });
  if (!league) return json({ error: 'Unknown league.', code: 'bad_league' }, 400);
  if (!league.features?.schefterFeed) {
    return json({ error: 'Not available for this league.', code: 'feature_disabled' }, 404);
  }

  const feed = await getSchefterFeedIfAny(league).catch(() => null);
  const limit = Number(url.searchParams.get('limit') ?? 6);
  const posts = selectPublicFeed(feed?.posts as never, league.slug, limit).map(({ path, ...p }) => ({
    ...p,
    url: leagueUrl(league, path),
  }));
  return json({ league: league.name, posts });
};
