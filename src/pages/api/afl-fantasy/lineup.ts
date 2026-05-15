/**
 * AFL Lineup API — GET (fetch lineup data) & POST (submit lineup)
 *
 * GET  /api/afl-fantasy/lineup?week=12  → returns LineupPayload JSON
 * POST /api/afl-fantasy/lineup          → submits lineup to MFL (AFL league)
 *
 * Both require authentication via session cookie.
 * POST uses the owner's MFL cookie — never commish credentials.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { mflFetch } from '../../../utils/mfl-fetch';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { getCurrentWeekForYear } from '../../../utils/current-week';

const MFL_LEAGUE_ID = '19621';

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

    const year = getCurrentLeagueYear();
    const starterList = starters.join(',');

    // MFL lineup import endpoint
    const url = `https://api.myfantasyleague.com/${year}/import`;
    const postBody = `TYPE=lineup&L=${MFL_LEAGUE_ID}&W=${weekNum}&STARTERS=${starterList}`;

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

    const url = new URL(request.url);
    const weekParam = url.searchParams.get('week');
    const week = weekParam ? parseInt(weekParam, 10) : getCurrentWeekForYear(getCurrentLeagueYear());

    if (isNaN(week) || week < 1 || week > 22) {
      return json({ error: 'Invalid week.' }, 400);
    }

    const year = getCurrentLeagueYear();

    // Fetch rosters from MFL to get current starters
    const rostersUrl = `https://api.myfantasyleague.com/${year}/export?TYPE=rosters&L=${MFL_LEAGUE_ID}&FRANCHISE=${user.franchiseId}&JSON=1`;
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
