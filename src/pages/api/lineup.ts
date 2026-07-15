/**
 * Lineup API — GET (fetch lineup data) & POST (submit lineup)
 *
 * GET  /api/lineup?week=12  → returns LineupPayload JSON
 * POST /api/lineup          → submits lineup to MFL
 *
 * Both require authentication via session cookie.
 * POST uses the owner's MFL cookie — never commish credentials.
 *
 * Phase 2 registry sweep: this route used to be duplicated at
 * api/afl-fantasy/lineup.ts (92% identical — only the hardcoded league id and
 * year-rollover function differed). Merged into one route that resolves the
 * league from the session user's `leagueId` via the registry, and picks the
 * right year-rollover clock via `getLeagueYearForSlug` (CLAUDE.md "Year
 * rollover — two independent clocks": TheLeague flips Feb 14, AFL flips
 * June 1). `api/afl-fantasy/lineup.ts` now just re-exports GET/POST from
 * here so existing clients keep working unchanged.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { mflFetch } from '../../utils/mfl-fetch';
import { getLeagueYearForSlug } from '../../utils/league-year';
import { getCurrentWeekForYear } from '../../utils/current-week';
import { buildMflExportUrl } from '../../utils/mfl-url';
import { getLeagueById, getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../../config/leagues';

/**
 * Resolve the league for this request from the session user's `leagueId`
 * (JWT-scoped, never client-supplied). Falls back to the default league if
 * the id doesn't match a registry entry — this should only happen for a
 * malformed/legacy session, and defaulting keeps GET/POST behavior the same
 * as before this route existed for multiple leagues.
 */
function resolveLeague(leagueId: string | undefined) {
  return (leagueId && getLeagueById(leagueId)) || getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!;
}

// ---------------------------------------------------------------------------
// POST — Submit lineup to MFL
// ---------------------------------------------------------------------------

export const POST: APIRoute = async ({ request }) => {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const user = getAuthUser(request);
    if (!user?.id) return json({ error: 'Authentication required. Please sign in.' }, 401);
    if (!user.franchiseId) return json({ error: 'No franchise associated with your account.' }, 403);

    const league = resolveLeague(user.leagueId);

    const body = await request.json();
    const { week, starters } = body as { week?: number; starters?: string[] };

    const weekNum = typeof week === 'number' ? Math.floor(week) : NaN;
    if (isNaN(weekNum) || weekNum < 1 || weekNum > 22 || !Array.isArray(starters) || starters.length !== 9) {
      return json({ error: 'Invalid lineup: must provide week (1-22) and exactly 9 starter IDs.' }, 400);
    }

    // Validate all IDs are numeric strings (MFL player IDs)
    if (starters.some((id) => !/^\d+$/.test(id))) {
      return json({ error: 'Invalid player IDs in lineup.' }, 400);
    }

    const year = getLeagueYearForSlug(league.slug);
    const starterList = starters.join(',');

    // MFL lineup import endpoint
    const url = `https://api.myfantasyleague.com/${year}/import`;
    const postBody = `TYPE=lineup&L=${league.id}&W=${weekNum}&STARTERS=${starterList}`;

    const response = await mflFetch({
      url,
      method: 'POST',
      mflUserCookie: user.id,
      body: postBody,
      timeoutMs: 15_000,
    });

    const text = await response.text();

    // MFL returns XML: <status>OK</status> on success, <error>msg</error> on failure
    if (text.includes('<error>')) {
      const errorMsg = text.match(/<error>(.*?)<\/error>/)?.[1] || 'Unknown MFL error';
      console.error('[lineup] MFL submit error:', errorMsg);
      return json({ error: `MFL: ${errorMsg}` }, 422);
    }

    if (text.includes('<status>OK</status>') || text.includes('>OK<')) {
      return json({ success: true, message: 'Lineup submitted successfully.' });
    }

    // Unexpected response
    console.warn('[lineup] Unexpected MFL response:', text.slice(0, 500));
    return json({ error: 'Unexpected response from MFL. Your lineup may or may not have been saved.' }, 500);
  } catch (error) {
    console.error('[lineup] Submit error:', error);
    return json({ error: 'Internal server error. Please try again.' }, 500);
  }
};

// ---------------------------------------------------------------------------
// GET — Fetch lineup data for a given week (used by week selector)
// ---------------------------------------------------------------------------

export const GET: APIRoute = async ({ request }) => {
  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const user = getAuthUser(request);
    if (!user?.id) return json({ error: 'Authentication required.' }, 401);
    if (!user.franchiseId) return json({ error: 'No franchise.' }, 403);

    const league = resolveLeague(user.leagueId);
    const year = getLeagueYearForSlug(league.slug);

    const url = new URL(request.url);
    const weekParam = url.searchParams.get('week');
    const week = weekParam ? parseInt(weekParam, 10) : getCurrentWeekForYear(year);

    if (isNaN(week) || week < 1 || week > 22) {
      return json({ error: 'Invalid week.' }, 400);
    }

    // Fetch rosters from MFL to get current starters
    const rostersUrl = buildMflExportUrl({
      type: 'rosters',
      leagueId: league.id,
      year,
      params: { FRANCHISE: user.franchiseId },
    });
    const rostersRes = await mflFetch({
      url: rostersUrl,
      method: 'GET',
      mflUserCookie: user.id,
      timeoutMs: 10_000,
    });
    const rostersData = await rostersRes.json();

    return json({ week, rosters: rostersData });
  } catch (error) {
    console.error('[lineup] GET error:', error);
    return json({ error: 'Failed to fetch lineup data.' }, 500);
  }
};
