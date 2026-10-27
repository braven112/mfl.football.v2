import type { APIRoute } from 'astro';
import { appJson, requireOwnerLeague } from '../../../utils/live/owner-league';
import { buildPlayerCard, loadLeaguePlayersData, loadWeeklyScores } from '../../../utils/live/mfl-players';
import { getCurrentNFLWeek } from '../../../utils/current-week';
import { getCurrentSeasonYear } from '../../../utils/league-year';
import { byeWeeksForSeason } from '../../../utils/nfl-bye-weeks';
import { checkRateLimit } from '../../../utils/rate-limit';

export const prerender = false;

/**
 * One player's card in the app: `?league=<mfl id>&id=<mfl player id>`.
 * Status, bye, every scored week this season under the league's own rules,
 * and who rosters him there. Read only; same gate and reads as `players.ts`.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const gate = await requireOwnerLeague(request, url.searchParams.get('league'));
  if (gate instanceof Response) return gate;
  const { user, league } = gate;

  const playerId = (url.searchParams.get('id') ?? '').trim();
  if (!/^\d{1,6}$/.test(playerId)) return appJson({ ok: false, error: 'Valid player id required' }, 400);

  const limit = await checkRateLimit('mfl-live-players', `${league.leagueId}:${league.franchiseId}`, 60, 60);
  if (!limit.allowed) return appJson({ ok: false, error: 'Too many requests. Try again in a minute.' }, 429);

  const week = getCurrentNFLWeek(new Date()) ?? 0;
  const ref = { leagueId: league.leagueId, franchiseId: league.franchiseId, year: league.year, host: league.host };
  const data = await loadLeaguePlayersData({
    ref,
    cookie: user.id,
    week,
    byes: byeWeeksForSeason(getCurrentSeasonYear()) ?? {},
  });
  if (!data) return appJson({ ok: false, error: 'MFL did not answer for this league just now.' }, 503);

  const weekly = await loadWeeklyScores(ref, user.id, week, data.league.endWeek);
  const card = buildPlayerCard(data, playerId, weekly);
  if (!card) return appJson({ ok: false, error: 'No such player' }, 404);
  return appJson(card);
};
