/**
 * GET /api/mfl-live/trade-builder?league=&with=  — what the trade builder
 * shows: every other team, your roster and future picks, and (with `with=`)
 * that team's. ANY MFL league the account is in; read with the owner's own
 * cookie on the league's host.
 */

import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { loadTradeBuilder } from '../../../utils/live/mfl-live-app-trades';

export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  const withFid = url.searchParams.get('with');
  try {
    const view = await loadTradeBuilder(
      {
        leagueId: league.leagueId,
        year: league.year,
        host: league.host,
        franchiseId: league.franchiseId,
        mflUserCookie: user.id,
      },
      withFid && /^\d{1,4}$/.test(withFid) ? withFid : null,
    );
    return appJson(view);
  } catch (error) {
    console.error('[mfl-live/trade-builder] failed:', error);
    return appJson({ success: false, message: "Couldn't read the rosters from MFL. Try again." }, 502);
  }
};
