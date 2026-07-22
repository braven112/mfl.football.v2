/**
 * GET /api/schefter/player-mentions
 *
 * Feed posts that mention a player — powers the "Schefter Report" section
 * of PlayerDetailsModal. Matches on the post's tagged `playerIds` (MFL id)
 * or the player's full name in the headline/body (wire posts and articles
 * don't tag ids).
 *
 * Query params:
 *   ?id=12345           MFL player id (optional)
 *   ?name=Josh%20Allen  player display name — "First Last" or "Last, First"
 *   ?limit=4            max posts to return (default 4, min 1, max 10)
 *   ?league=<slug>      slug or navSlug; TheLeague default
 *
 * At least one of id/name is required (400 otherwise).
 *
 * Response:
 *   { posts: PlayerMention[] }   // newest first; empty for feed-less leagues
 *
 * Public — the feed itself is public; this just filters it.
 */

import type { APIRoute } from 'astro';
import { resolveSchefterLeague } from '../../../utils/schefter-league';
import { getSchefterFeed } from '../../../utils/schefter-league-data';
import { findPlayerMentions } from '../../../utils/schefter-player-mentions';

export const prerender = false;

// Feed content changes at most hourly (scanner cadence); a longer shared
// cache than the leaderboards is fine here.
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
};
const DEFAULT_LIMIT = 4;
const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 80;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
  if (raw == null) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

export const GET: APIRoute = async ({ url }) => {
  // Public route — league from ?league= (slug or navSlug), TheLeague default.
  const league = resolveSchefterLeague({ url });
  if (!league) return json({ error: 'bad_league' }, 400);

  const playerId = url.searchParams.get('id')?.trim().slice(0, MAX_QUERY_LENGTH) || null;
  const playerName = url.searchParams.get('name')?.trim().slice(0, MAX_QUERY_LENGTH) || null;
  if (!playerId && !playerName) return json({ error: 'missing_player' }, 400);

  const limit = clampInt(url.searchParams.get('limit'), DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);

  // Leagues without a wired feed (best-ball) just have no mentions.
  let posts;
  try {
    posts = getSchefterFeed(league).posts;
  } catch {
    return json({ posts: [] });
  }

  return json({ posts: findPlayerMentions(posts, { playerId, playerName }, limit) });
};
