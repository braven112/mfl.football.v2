/**
 * Default ranks — the "My Rank" every owner sees (Brandon, 2026-11-22).
 *
 * GET /api/default-ranks?league=<slug> → { league, label, ranks }
 *
 * One board for everyone, in every league, on every page: FantasySharks, the
 * built-in source in data/ranking-sources/<league year>.json. No per-page
 * lists and no blends; those are the site owner's alone (/api/my-ranks).
 *
 * Public data (FantasySharks publishes it), so it may sit in a shared cache.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { getLeagueBySlug } from '../../config/leagues';
import { getLeagueYearForSlug } from '../../utils/league-year';
import { loadLeagueData } from '../../utils/league-data';
import { DEFAULT_RANK_SOURCE, defaultRankList } from '../../utils/default-ranks';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
};

export const GET: APIRoute = async ({ url }) => {
  const league = getLeagueBySlug(url.searchParams.get('league') ?? '');
  if (!league) {
    return new Response(JSON.stringify({ error: 'Unknown league' }), { status: 404, headers: HEADERS });
  }
  const year = getLeagueYearForSlug(league.slug);
  // The file for the league year may not exist yet right after a rollover;
  // last year's board beats an empty column.
  const snapshot =
    (await loadLeagueData<any>(`data/ranking-sources/${year}.json`).catch(() => null)) ??
    (await loadLeagueData<any>(`data/ranking-sources/${year - 1}.json`).catch(() => null));
  const list = defaultRankList(snapshot);
  return new Response(
    JSON.stringify({ league: league.slug, source: DEFAULT_RANK_SOURCE, ...list }),
    { status: 200, headers: HEADERS },
  );
};
