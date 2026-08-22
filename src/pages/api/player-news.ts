import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../utils/rate-limit';
import { getPlayer, getGlobalPlayerMap } from '../../utils/player-map';
import { getCurrentLeagueYear, getTestDateFromSearchParams } from '../../utils/league-year';
import {
  fetchAthleteNews,
  isValidEspnId,
  clampLimit,
  playerNewsWindowDays,
  type PlayerNewsResult,
} from '../../utils/player-news';

export const prerender = false;

/**
 * ESPN athlete-scoped player news for the player modals.
 *
 * Proxied server-side rather than fetched from the browser: ESPN's CORS posture
 * on this unofficial endpoint is unverifiable from here, the upstream URL stays
 * out of the client bundle, and the browser only ever sees our normalized shape
 * — so an upstream change degrades to `empty` instead of a client TypeError.
 *
 * DEF resolution is deliberately NOT here. A team defense has no ESPN athlete id
 * (0 of 32 in the MFL feed, structurally), so the caller substitutes its marquee
 * defender's id from def-spotlight-players — which the modal already imports for
 * the hero band, so it costs no extra bundle. This route stays purely
 * athlete-scoped.
 */

/** Successful reads are identical for every visitor, so they are CDN-cacheable. */
const CACHE_OK = 'public, s-maxage=300, stale-while-revalidate=1800';

/**
 * Failures must NEVER be cached. A cached 429 or a cached "ESPN is down" pins
 * the broken response in front of every visitor for the whole window — the same
 * shape as the Cloudflare NFL-logo saga, where a cached 404 kept serving broken
 * icons for hours after the origin was fixed.
 */
const CACHE_NEVER = 'no-store';

function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl },
  });
}

/** Client IP for rate limiting. This route is unauthenticated, so there is no
 *  franchiseId to key on the way the LLM-backed endpoints do. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || 'anon';
}

/**
 * Resolve an MFL player id to an ESPN id that is definitely an NFL athlete.
 *
 * Doing this server-side is what keeps college ids out of the NFL athlete
 * endpoint: `resolveEspnId` falls back to a college athlete id for incoming
 * rookies, and a college id is numerically indistinguishable from an NFL one —
 * passing one upstream silently returns a DIFFERENT player's news. The feed's
 * `espn_id` is the only trustworthy source, and the map that holds it is already
 * memory-cached here.
 *
 * It also means callers only need the MFL id they already have, so no page has
 * to thread a second id through its modal payload.
 */
function resolveNflEspnId(mflId: string): string | null {
  const fromYear = getPlayer(getCurrentLeagueYear(), mflId)?.nflEspnId;
  if (fromYear) return fromYear;
  // Union of every season — covers a player missing from the current feed.
  return getGlobalPlayerMap().get(mflId)?.nflEspnId ?? null;
}

export const GET: APIRoute = async ({ request, url }) => {
  const mflId = url.searchParams.get('mflId') ?? '';

  // `?testDate=YYYY-MM-DD` moves the clock that picks the recency window, the
  // way every other date-dependent surface here is exercised. It is a distinct
  // URL, so it gets its own cache entry and can never poison the real one.
  const now = getTestDateFromSearchParams(url.searchParams) ?? new Date();

  // Two ways in. `mflId` is the normal path. A direct `espnId` is for the team
  // DEF stand-in, whose id comes from def-spotlight-players (ESPN's own roster
  // scrape) and is therefore known-NFL without a feed lookup.
  const espnId = mflId
    ? (/^\d{1,12}$/.test(mflId) ? resolveNflEspnId(mflId) ?? '' : '')
    : url.searchParams.get('espnId') ?? '';

  // Validate BEFORE any upstream call. The id is interpolated into an ESPN URL
  // path, so rejecting non-digits here is what stops this route being usable as
  // a general-purpose proxy for arbitrary ESPN paths.
  if (!isValidEspnId(espnId)) {
    // A known player with no ESPN id is not an error — there is simply nothing
    // to ask about (every team DEF, and a handful of kickers).
    if (mflId && /^\d{1,12}$/.test(mflId)) {
      return json(
        {
          espnId: null,
          status: 'empty',
          items: [],
          fetchedAt: new Date().toISOString(),
          windowDays: playerNewsWindowDays(now),
        },
        200,
        CACHE_OK,
      );
    }
    return json({ error: 'invalid player id' }, 400, CACHE_NEVER);
  }

  const limit = clampLimit(url.searchParams.get('limit'));

  const rate = await checkRateLimit('player-news', clientIp(request), 60, 60);
  if (!rate.allowed) {
    return json({ error: 'rate limited' }, 429, CACHE_NEVER);
  }

  let result: PlayerNewsResult;
  try {
    result = await fetchAthleteNews(espnId, limit, now);
  } catch (error) {
    // fetchAthleteNews is written not to throw; this is belt-and-braces so an
    // unexpected throw still degrades to a typed error rather than a 500 page.
    console.error('[player-news] unexpected failure:', error);
    return json(
      {
        espnId,
        status: 'error',
        items: [],
        fetchedAt: new Date().toISOString(),
        reason: 'upstream-network',
        windowDays: playerNewsWindowDays(now),
      },
      200,
      CACHE_NEVER,
    );
  }

  // `error` rides a 200 so the client renders its retryable error state rather
  // than a fetch rejection — but it is explicitly uncacheable.
  return json(result, 200, result.status === 'error' ? CACHE_NEVER : CACHE_OK);
};
