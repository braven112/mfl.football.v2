/**
 * My Ranks — the site owner's own ranks for the pages that show "My Rank".
 *
 * GET  /api/my-ranks?league=<slug>   → every kind at once (src/utils/my-ranks.ts)
 * POST /api/my-ranks?league=<slug>   { blendRedraftPct } → save the Blend slider
 *
 * Brandon's alone, the same gate as /admin/my-rankings: the site owner's own
 * franchise session in either of his leagues (isSiteOwnerAnywhere). Everyone else gets a 404,
 * so the endpoint says nothing about whether a board exists. Responses are
 * `private, no-store`: the ranks come from paid subscriptions and must never
 * sit in a shared cache. Only the slider's NUMBER is stored (Redis); no
 * ranking data is ever written anywhere by this endpoint.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getLeagueBySlug } from '../../config/leagues';
import { isSiteOwnerAnywhere } from '../../utils/site-owner';
import { BOARD_KEY_BY_SLUG, loadPrivateBoard } from '../../utils/private-rankings';
import { blendKey, buildMyRanks, DEFAULT_BLEND_REDRAFT_PCT } from '../../utils/my-ranks';
import { getRedis } from '../../utils/redis-client';
import { getCachedRosters } from '../../utils/mfl-roster-cache';
import { getCurrentSeasonYear, getLeagueYearForSlug } from '../../utils/league-year';
import { isSeasonWindowOpen } from '../../utils/pecking-order-season-window.mjs';

const PRIVATE = {
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: PRIVATE });

function gate(request: Request, url: URL) {
  const slug = url.searchParams.get('league') ?? '';
  const league = getLeagueBySlug(slug);
  const user = getAuthUser(request);
  // His boards are his in both leagues: My Rankings switches between them
  // under one sign-in, so the save must too (a TheLeague session saving the
  // AFL blend used to 404 as "Couldn't save").
  if (!league || !BOARD_KEY_BY_SLUG[league.slug] || !isSiteOwnerAnywhere(user)) return null;
  return league;
}

async function readBlend(slug: string): Promise<number> {
  try {
    const redis = await getRedis();
    const v = Number(await redis?.get(blendKey(slug)));
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_BLEND_REDRAFT_PCT;
  } catch {
    return DEFAULT_BLEND_REDRAFT_PCT;
  }
}

async function readContractYears(slug: string, leagueId: string): Promise<Record<string, number>> {
  try {
    const rosters = await getCachedRosters(String(getLeagueYearForSlug(slug)), leagueId);
    const out: Record<string, number> = {};
    for (const [id, entry] of Object.entries(rosters ?? {})) {
      const y = Number(entry.contractYear);
      if (Number.isFinite(y)) out[id] = y;
    }
    return out;
  } catch {
    return {};
  }
}

export const GET: APIRoute = async ({ request, url }) => {
  const league = gate(request, url);
  if (!league) return respond({ error: 'Not found' }, 404);

  const load = await loadPrivateBoard(BOARD_KEY_BY_SLUG[league.slug]);
  if (!load.ok) return respond({ error: load.message, reason: load.reason }, 503);

  const [blendRedraftPct, contractYears] = await Promise.all([
    readBlend(league.slug),
    readContractYears(league.slug, league.id),
  ]);
  const inSeason = isSeasonWindowOpen(getCurrentSeasonYear());
  const kinds = buildMyRanks({ board: load.board, inSeason, contractYears, blendRedraftPct });
  return respond({ league: league.slug, generatedAt: load.board.generatedAt, blendRedraftPct, inSeason, kinds });
};

export const POST: APIRoute = async ({ request, url }) => {
  const league = gate(request, url);
  if (!league) return respond({ error: 'Not found' }, 404);
  const body = (await request.json().catch(() => null)) as { blendRedraftPct?: unknown } | null;
  const pct = Number(body?.blendRedraftPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return respond({ error: 'blendRedraftPct must be 0–100' }, 400);
  const redis = await getRedis();
  if (!redis) return respond({ error: 'Storage not configured' }, 503);
  await redis.set(blendKey(league.slug), Math.round(pct));
  return respond({ ok: true, blendRedraftPct: Math.round(pct) });
};
