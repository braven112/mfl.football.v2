import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { buildPlayerList, loadLeaguePlayersData, parsePlayerListQuery } from '../../../utils/live/mfl-players';
import { getCurrentNFLWeek } from '../../../utils/current-week';
import { getCurrentSeasonYear } from '../../../utils/league-year';
import { byeWeeksForSeason } from '../../../utils/nfl-bye-weeks';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

/**
 * The app's Players tab: `?league=<mfl id>&status=fa|all|trending&sort=proj|pts|owned&q=&pos=&limit=`.
 *
 * Read only, for any MFL league the account is in — `requireOwnerLeague`
 * checks that against the account's own league list and answers 401/400/403
 * itself. Every MFL read carries the owner's cookie (src/utils/live/mfl-players.ts).
 */
export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  // A search box types fast; a cold cache costs up to nine MFL reads.
  const limit = await checkRateLimit('mfl-live-players', `${league.leagueId}:${league.franchiseId}`, 60, 60);
  if (!limit.allowed) return appJson({ ok: false, error: 'Too many requests. Try again in a minute.' }, 429);

  const data = await loadLeaguePlayersData({
    ref: { leagueId: league.leagueId, franchiseId: league.franchiseId, year: league.year, host: league.host },
    cookie: user.id,
    week: getCurrentNFLWeek(new Date()) ?? 0,
    byes: byeWeeksForSeason(getCurrentSeasonYear()) ?? {},
  });
  if (!data) return appJson({ ok: false, error: 'MFL did not answer for this league just now.' }, 503);

  return appJson(buildPlayerList(data, parsePlayerListQuery(url.searchParams)));
};
