/**
 * POST /api/trades/submit
 *
 * Submit a trade proposal to MFL on behalf of the authenticated user.
 * Uses the user's MFL cookie (authUser.id) for per-user authentication.
 * Always operates in OWNER mode — never sends MFL_IS_COMMISH.
 *
 * Security:
 * - Validates the user has a resolved franchise before allowing trade submission
 * - Verifies the user owns every player they're offering (roster check)
 * - Never uses commissioner credentials for owner-level operations
 *
 * Uses mflFetch() to handle the cross-origin redirect from
 * api.myfantasyleague.com → www49, which would otherwise strip the
 * Cookie header and cause "API requires a logged in user" errors.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { mflFetch } from '../../../utils/mfl-fetch';
import { createMFLApiClient } from '../../../utils/mfl-matchup-api';
import { reportOwnerTrades } from '../../../utils/owner-trade-reports';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (!user) {
    return new Response(
      JSON.stringify({ success: false, message: 'Authentication required. Please sign in.' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  if (!user.id) {
    return new Response(
      JSON.stringify({ success: false, message: 'MFL session not found. Please sign in again.' }),
      { status: 401, headers: JSON_HEADERS }
    );
  }

  if (!user.franchiseId) {
    return new Response(
      JSON.stringify({ success: false, message: 'No franchise associated with your account.' }),
      { status: 403, headers: JSON_HEADERS }
    );
  }

  try {
    const body = await request.json();
    const { offeredTo, willGiveUp, willReceive, comments } = body;

    if (!offeredTo || !willGiveUp || !willReceive) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing required fields: offeredTo, willGiveUp, willReceive' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const year = getCurrentLeagueYear();
    const leagueId = user.leagueId || '13522';

    // SECURITY: Verify the user owns every player they're offering
    // willGiveUp is a comma-separated string of player IDs (and possibly draft pick tokens)
    const offeredPlayerIds = willGiveUp.split(',').map((s: string) => s.trim()).filter((id: string) => id && /^\d+$/.test(id));

    if (offeredPlayerIds.length > 0) {
      const mflClient = createMFLApiClient({
        leagueId,
        year: String(year),
        mflUserId: user.id,
      });
      const rosters = await mflClient.getRosters();
      const userRoster = rosters[user.franchiseId] || [];

      const notOwned = offeredPlayerIds.filter((pid: string) => !userRoster.includes(pid));
      if (notOwned.length > 0) {
        return new Response(
          JSON.stringify({ success: false, message: 'You can only offer players from your own roster.' }),
          { status: 403, headers: JSON_HEADERS }
        );
      }
    }

    const params = new URLSearchParams({
      TYPE: 'tradeProposal',
      L: leagueId,
      OFFEREDTO: offeredTo,
      WILL_GIVE_UP: willGiveUp,
      WILL_RECEIVE: willReceive,
    });

    if (comments?.trim()) {
      params.set('COMMENTS', comments.trim());
    }

    const importUrl = `https://api.myfantasyleague.com/${year}/import`;

    console.log(`[trades/submit] POST ${importUrl} (OFFEREDTO=${offeredTo})`);

    // Owner mode: only MFL_USER_ID cookie, no MFL_IS_COMMISH
    const mflResponse = await mflFetch({
      url: importUrl,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });

    const responseText = await mflResponse.text();
    console.log('[trades/submit] MFL response:', mflResponse.status, responseText.substring(0, 500));

    // MFL returns HTTP 200 even for errors — check response body
    if (responseText.includes('<error>') || responseText.includes('"error"')) {
      const errorMatch = responseText.match(/<error[^>]*>(.*?)<\/error>/s)
        || responseText.match(/"error"\s*:\s*"([^"]+)"/);
      const errorMsg = errorMatch?.[1] || 'MFL rejected the trade proposal';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    if (!mflResponse.ok) {
      return new Response(
        JSON.stringify({ success: false, message: `MFL API error: ${mflResponse.status}` }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    // Detect when MFL returns an HTML page instead of an API response
    if (responseText.includes('<html') || responseText.includes('<!DOCTYPE')) {
      return new Response(
        JSON.stringify({ success: false, message: 'MFL did not process the trade. Please try again.' }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    // Silent capture: re-read pendingTrades to grab MFL's assigned trade_id
    // for the offer we just sent, then feed it into the Schefter rumor mill.
    // MFL's tradeProposal response doesn't return the offer id, so a refetch
    // is the reliable way to record it. Fire-and-forget — a capture failure
    // must never reject the submit.
    void (async () => {
      try {
        const url = `https://api.myfantasyleague.com/${year}/export?TYPE=pendingTrades&L=${leagueId}&JSON=1`;
        const res = await mflFetch({ url, method: 'GET', mflUserCookie: user.id });
        if (!res.ok) return;
        const text = await res.text();
        const data = JSON.parse(text);
        const pending = data?.pendingTrades;
        const raw = pending?.pendingTrade ?? pending?.trade;
        if (!raw) return;
        const rows = Array.isArray(raw) ? raw : [raw];
        await reportOwnerTrades(user.franchiseId!, rows);
      } catch {
        // swallow — capture is best-effort
      }
    })();

    return new Response(
      JSON.stringify({ success: true, message: 'Trade proposal submitted' }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[trades/submit] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
