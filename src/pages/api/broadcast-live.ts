import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { getCurrentNFLWeek } from '../../utils/current-week';
import { assembleBroadcastBoard } from '../../utils/broadcast-board';
import { BROADCAST_LEAGUE_COOKIE } from '../../utils/broadcast-selection';
import type { BroadcastPollResponse } from '../../types/live-broadcast';

export const prerender = false;

/**
 * The one poll the broadcast board makes.
 *
 * A THIN WRAPPER over `assembleBroadcastBoard`, which the PAGE also calls in
 * process for its first paint. One implementation, two callers — a page that
 * fetches its own API to render itself puts our own edge in the path of the
 * paint, and that hop has already silently stopped landing once.
 *
 * Scope comes from the SESSION, never from a param. `?leagues=` can only
 * narrow the set the owner's own MFL cookie already returned, because the
 * resolver only ever answers with ids present in that list. There is no value
 * a caller can send that reaches a league this owner is not in.
 *
 * `Cache-Control: no-store`: a CDN copy of a live board is not stale, it is
 * WRONG while looking live.
 */
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/**
 * The shape an unauthenticated or failed call answers with.
 *
 * `ok: false` with empty collections, never a 500 and never a bare `{}`. The
 * island keeps its last good numbers on a failed poll and only changes the
 * status pill — "the feed says nothing" and "we could not reach the feed" are
 * different facts all the way to the pixels, and an empty 200 that looked
 * healthy would wipe a live board.
 */
const failed = (week: number): BroadcastPollResponse => ({
  ok: false,
  week,
  fetchedAt: new Date().toISOString(),
  leagues: [],
  moments: [],
  redZone: [],
  games: [],
});

export const GET: APIRoute = async ({ request, url, cookies }) => {
  const week = (() => {
    const raw = parseInt(url.searchParams.get('week') ?? '', 10);
    if (Number.isInteger(raw) && raw >= 1 && raw <= 25) return raw;
    return getCurrentNFLWeek(new Date()) ?? 1;
  })();

  const user = getAuthUser(request);
  if (!user) return json(failed(week), 401);

  try {
    const board = await assembleBroadcastBoard({
      user,
      leaguesParam: url.searchParams.get('leagues'),
      leaguesCookie: cookies.get(BROADCAST_LEAGUE_COOKIE)?.value ?? null,
      week,
      year: getCurrentSeasonYear(),
    });
    return json(board.poll, 200);
  } catch (error) {
    console.warn('[broadcast-live] assembly failed:', (error as Error)?.message);
    return json(failed(week), 200);
  }
};
