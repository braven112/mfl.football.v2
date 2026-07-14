/**
 * POST /api/cut-player
 *
 * Drop a player from the authenticated user's roster via MFL's `add_drop`
 * page handler — the same endpoint MFL's website uses for an owner's add/drop.
 * Uses the user's MFL cookie (authUser.id) for per-user authentication.
 *
 * Why `add_drop` and not `import?TYPE=fcfsWaiver`: the fcfsWaiver API applies a
 * strict "resulting roster must be within the in-season limit" validation, even
 * for a pure drop, so it refuses any cut while a roster is over the limit (e.g.
 * an offseason 19/16). The `add_drop` page handler is the standard owner
 * free-agent add/drop page every owner uses to cut down to the limit before the
 * season; it permits reducing an over-limit roster. Captured from MFL's own web
 * UI: POST https://{host}/{year}/add_drop with form fields
 *   L, add_settings, PROJSRC=mfl, add_pid (empty), drop_pid=<id>, ROUND, COMMENTS, SUBMIT
 * It returns an HTML page (not API XML/JSON), so success is verified by
 * re-reading the roster rather than by parsing the response body.
 *
 * Security:
 * - Validates the user has a resolved franchise before allowing the cut
 * - Verifies the user owns the player being cut (roster check)
 * - Never uses commissioner credentials — owner cookie only
 *
 * Uses mflFetch() to handle cross-origin redirects while preserving the Cookie
 * header (Node strips it on cross-origin redirects otherwise).
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentLeagueYear, getAflLeagueYear } from '../../utils/league-year';
import { mflFetch } from '../../utils/mfl-fetch';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';
import { getLeagueById } from '../../config/leagues';

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
    const { playerId } = await request.json();

    if (!playerId || !/^\d+$/.test(String(playerId))) {
      return new Response(
        JSON.stringify({ success: false, message: 'Missing or invalid playerId' }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    const leagueId = user.leagueId || '13522';
    const league = getLeagueById(leagueId);
    // Leagues roll to the new MFL year on different clocks: TheLeague flips
    // Feb 14, AFL flips June 1 (registry leagueYearRollover). Using TheLeague's
    // clock for AFL would target a not-yet-created MFL league between Feb 14
    // and June 1.
    const year = league?.leagueYearRollover ? getAflLeagueYear() : getCurrentLeagueYear();

    // SECURITY: Verify the player belongs to the user's roster
    const mflClient = createMFLApiClient({
      leagueId,
      year: String(year),
      mflUserId: user.id,
    });
    const rosters = await mflClient.getRosters();
    const userRoster = rosters[user.franchiseId] || [];

    if (!userRoster.includes(String(playerId))) {
      // The roster page renders from a periodically-synced static feed, so it
      // can show players that were already dropped from the live MFL roster.
      // Distinguish "already gone" (stale page) from "never yours" so the user
      // isn't told they're cutting someone else's player when they're not.
      // In duplicate-player leagues (AFL's two-conference format) another
      // franchise legitimately holds a copy of every player, so "on another
      // roster" proves nothing — always report the stale-page case there.
      const onAnyRoster = league?.duplicatePlayers
        ? false
        : Object.values(rosters).some((r) => r.includes(String(playerId)));
      const message = onAnyRoster
        ? 'You can only cut players from your own roster.'
        : 'This player is no longer on your roster — they may have already been dropped. Refresh the page to see your current roster.';
      return new Response(
        JSON.stringify({ success: false, message }),
        { status: onAnyRoster ? 403 : 409, headers: JSON_HEADERS }
      );
    }

    // Execute the drop via MFL's `add_drop` page handler (the owner add/drop
    // page) — captured from MFL's own web UI. Unlike the fcfsWaiver API, this
    // path lets an owner reduce an over-limit roster, which is the whole point
    // during offseason cutdown. We POST to the league's own MFL web host (the
    // `api.` gateway is for the API, not page handlers).
    const host = league?.mflHost || 'www44.myfantasyleague.com';
    const addDropUrl = `https://${host}/${year}/add_drop`;
    const params = new URLSearchParams({
      L: leagueId,
      add_settings: '',
      PROJSRC: 'mfl',
      add_pid: '',
      drop_pid: String(playerId),
      ROUND: '1',
      COMMENTS: '',
      SUBMIT: 'Perform Add/Drop',
    });

    console.log(`[cut-player] POST ${addDropUrl} add_drop owner-mode (franchise=${user.franchiseId}, drop=${playerId})`);

    const mflResponse = await mflFetch({
      url: addDropUrl,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });

    const responseText = await mflResponse.text();
    console.log('[cut-player] MFL response:', mflResponse.status, responseText.substring(0, 300));

    if (!mflResponse.ok) {
      return new Response(
        JSON.stringify({ success: false, message: `MFL API error: ${mflResponse.status}` }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    // add_drop returns an HTML page, not API XML/JSON. On failure it re-renders
    // the page with MFL's error message; on success it renders the updated
    // roster page without one. Treat a recognized error message as a definitive
    // failure first — this is authoritative even if a subsequent roster read
    // lags. (add_drop's "would create an invalid roster" failure is exactly the
    // case we expect to NOT see anymore, but other failures — locked period,
    // auth — still surface here.)
    const errMatch = responseText.match(/Transaction Would Create[^<]*/i)
      || responseText.match(/Exceeds League Limit[^<]*/i)
      || responseText.match(/<error[^>]*>(.*?)<\/error>/s);
    if (errMatch) {
      const errorMsg = (errMatch[1] || errMatch[0] || '').trim() || 'MFL rejected the cut request';
      return new Response(
        JSON.stringify({ success: false, message: errorMsg }),
        { status: 400, headers: JSON_HEADERS }
      );
    }

    // No MFL error in the page — confirm the drop actually landed by re-reading
    // the roster. Drops reflect quickly outside the season-end→Feb-14 pre-
    // rollover window (we're well outside it here).
    const afterRosters = await mflClient.getRosters();
    const stillRostered = (afterRosters[user.franchiseId] || []).includes(String(playerId));
    if (stillRostered) {
      return new Response(
        JSON.stringify({ success: false, message: 'MFL did not process the cut. Please try again.' }),
        { status: 502, headers: JSON_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Player successfully cut' }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[cut-player] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error. Please try again.' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
