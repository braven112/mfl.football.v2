import type { APIRoute } from 'astro';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { loadNflGameDetail } from '../../utils/nfl-game-detail-source';
import type { NflGameDetailResponse } from '../../types/live-scoring';

export const prerender = false;

/**
 * Real NFL box scores + scoring plays for the live-scoring page.
 *
 * A THIN WRAPPER over `src/utils/nfl-game-detail-source.ts`, which owns the
 * fan-out, the cache and the ESPN→MFL id translation. The logic moved there
 * when the broadcast board needed the same slate in-process: a page that
 * fetches its own API to render itself puts our own edge in the path of its
 * first paint, and this repo has already shipped that outage once.
 *
 * `Cache-Control: no-store`, like every live route here. A CDN-cached live box
 * score is not stale, it is WRONG while looking live.
 */
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async ({ url }) => {
  const parsedWeek = parseInt(url.searchParams.get('week') ?? '', 10);
  if (!Number.isInteger(parsedWeek) || parsedWeek < 1 || parsedWeek > 25) {
    return json({ error: 'Valid week parameter required' }, 400);
  }
  const yearNum = parseInt(url.searchParams.get('year') ?? '', 10);
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
    ? yearNum
    : getCurrentSeasonYear();

  const payload: NflGameDetailResponse = await loadNflGameDetail({
    week: parsedWeek,
    year,
    searchParams: url.searchParams,
  });
  return json(payload, 200);
};
