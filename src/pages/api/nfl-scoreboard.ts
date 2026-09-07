import type { APIRoute } from 'astro';
import { fetchNflScoreboard } from '../../utils/nfl-scoreboard-source';

export const prerender = false;

/**
 * Real NFL scoreboard for the live-scoring page — score, quarter, real clock,
 * possession, and the in-progress drive situation (red zone, down & distance,
 * last play). Proxies ESPN's public scoreboard API.
 *
 * A thin HTTP wrapper: the fetching and parsing live in
 * `utils/nfl-scoreboard-source.ts`, because the live-scoring pages need the
 * same slate for their SERVER render and a second copy of the parse rules is
 * how the two would disagree about a team code or a network.
 *
 * `no-store`: scores must never be cached. A CDN copy of a live scoreboard is
 * not stale, it is wrong while looking live.
 *
 * Note `ok` in the response. An empty `games` array on a Tuesday is a healthy
 * answer; an empty one because ESPN 500'd is an outage. Collapsing the two
 * makes an outage render as "no games today", which is the exact failure mode
 * this repo keeps re-learning (resolveLineupFillState, player-news).
 */
export const GET: APIRoute = async ({ url }) => {
  const board = await fetchNflScoreboard({
    week: url.searchParams.get('week'),
    year: url.searchParams.get('year'),
    params: url.searchParams,
  });

  return new Response(JSON.stringify(board), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
