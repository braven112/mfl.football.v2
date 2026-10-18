/**
 * An owner matches one of their unmatched Sleeper players to an MFL player,
 * or withdraws that match. The crowd rules live in `player-fixes.ts`.
 *
 * A plain form posts here and is sent back to the fix list on
 * `/live/settings` with a one-word outcome in `?fix=` (303, so a refresh
 * never re-submits), the same shape as `/api/live-sleeper`.
 *
 * Every pick is checked before it counts, because two owners agreeing is what
 * applies it to everyone:
 *  - the Sleeper player must be one the id join left UNMATCHED (a vote never
 *    re-points a match that works);
 *  - he must be on one of the viewer's own Sleeper rosters, so a vote comes
 *    from someone who actually knows who he is;
 *  - the MFL player must exist at a fantasy position.
 *
 * POST only: it changes stored state. The session cookie is SameSite=Lax.
 */

import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../utils/auth';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { getSleeperLink, sleeperViewerKey } from '../../utils/sleeper/link';
import { discoverSleeperBoardLeagues, readViewerSleeperPlayers } from '../../utils/sleeper/live';
import { loadMflPlayerIndex, loadSleeperPlayerMap } from '../../utils/sleeper/players';
import { MFL_PLAYER_ID, SLEEPER_PLAYER_ID, clearPlayerFix, submitPlayerFix } from '../../utils/sleeper/player-fixes';

export const prerender = false;

const back = (outcome: string) =>
  new Response(null, {
    status: 303,
    headers: { Location: `/live/settings?fix=${outcome}#sleeper-fixes`, 'Cache-Control': 'no-store' },
  });


export const POST: APIRoute = async ({ request }) => {
  const user = getMflLiveUser(request);
  const voter = user ? sleeperViewerKey(user) : null;
  if (!user || !voter) return back('signed-out');

  const form = await request.formData().catch(() => null);
  const action = String(form?.get('action') ?? '');
  const sid = String(form?.get('sid') ?? '');
  if (!SLEEPER_PLAYER_ID.test(sid)) return back('invalid');

  if (action === 'clear') {
    return back((await clearPlayerFix(voter, sid)) ? 'cleared' : 'error');
  }
  if (action !== 'match') return back('invalid');

  const mfl = String(form?.get('mfl') ?? '');
  if (!MFL_PLAYER_ID.test(mfl)) return back('pick');

  const year = getCurrentSeasonYear();
  const [map, link] = await Promise.all([
    loadSleeperPlayerMap(year),
    getSleeperLink(user).catch(() => null),
  ]);
  const player = map[sid];
  if (!link || !player || player.mfl) return back('invalid');
  const choice = loadMflPlayerIndex(year).get(mfl);
  if (!choice) return back('invalid');

  const leagues = await discoverSleeperBoardLeagues(link, year).catch(() => []);
  const rostered = await readViewerSleeperPlayers(leagues).catch(() => new Map<string, string[]>());
  if (!rostered.has(sid)) return back('not-yours');

  const outcome = await submitPlayerFix({
    voter,
    sid,
    mfl,
    subject: { name: player.name, position: player.position, team: player.team },
  });
  return back(outcome);
};
