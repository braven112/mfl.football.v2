/**
 * MFL Live's poll endpoint.
 *
 * A THIN wrapper over `assembleMflLiveBoard` — the page calls that same
 * function in process for its first paint and never fetches this route to
 * render itself. See the assembler's header for why that rule exists in blood.
 *
 * `no-store`, without exception: a CDN copy of a live board is wrong while
 * looking live.
 *
 * `?source=mfl` is the MFL Live mobile app's board: MFL data only, no ESPN,
 * no Sleeper, no headshots or NFL club art (see `mflOnly` on the assembler).
 * The app signs in with a Bearer token, which `getMflLiveUser` accepts. Its
 * board also carries the decisions the web board makes client-side — game
 * states, projected finals, Final, precision and the next-poll hint — see
 * `utils/live/mfl-live-app-view.ts`.
 */

import type { APIRoute } from 'astro';
import { getMflLiveUser } from '../../utils/auth';
import { getCurrentNFLWeek } from '../../utils/current-week';
import { assembleMflLiveBoard } from '../../utils/mfl-live-board';
import { MFL_LIVE_LEAGUE_COOKIE } from '../../utils/mfl-live-selection';
import { readMflLiveSelection } from '../../utils/mfl-live-selection-store';
import { mflLiveAppCadence, toMflLiveAppBoard } from '../../utils/live/mfl-live-app-view';

import { listLeagueData, loadLeagueData } from '../../utils/league-data';

export const prerender = false;

const NO_STORE = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

/** The current-era (2025+) seasons the old `20{2[5-9],[3-9][0-9]}` glob matched. */
const CURRENT_ERA_FEED = /\/mfl-feeds\/20(?:2[5-9]|[3-9]\d)\//;

/**
 * Every kickoff MFL has published, for the app's poll hint. The FULL schedule,
 * as in api/cron/lineup-check.ts: cron-generated files, and a kickoff stays
 * visible however long ago MFL's week pointer moved. Any league's copy is the
 * same NFL schedule, so the de-duplicated union is fine. Read through the
 * league-data loader (cached while the instance is warm), never a glob that
 * compiles every league's schedule into the function; a failed read is no
 * poll hint rather than a failed board.
 */
async function loadKickoffs(): Promise<string[]> {
  try {
    const paths = listLeagueData('data/*/mfl-feeds/*/nflSchedule-full.json').filter((p) =>
      CURRENT_ERA_FEED.test(p),
    );
    const schedules = await Promise.all(paths.map((p) => loadLeagueData<any>(p)));
    return [
      ...new Set(
        schedules.flatMap((data) => {
          const weeks = data?.fullNflSchedule?.nflSchedule;
          if (!Array.isArray(weeks)) return [];
          return weeks.flatMap((w: any) => {
            const matchups = Array.isArray(w?.matchup) ? w.matchup : w?.matchup ? [w.matchup] : [];
            return matchups.map((g: any) => g?.kickoff).filter(Boolean);
          });
        }),
      ),
    ];
  } catch (err) {
    console.error('[live-board] could not read the NFL schedule:', err);
    return [];
  }
}

export const GET: APIRoute = async ({ request, url, cookies }) => {
  const user = getMflLiveUser(request);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, reason: 'unauthenticated' }), {
      status: 401,
      headers: NO_STORE,
    });
  }

  // The RAW resolver result, never clamped up to 1. MFL serves no live scoring
  // before the Week 1 Thursday, and clamping is what hides that gap: a week-1
  // request in the September pre-kickoff window fails against a perfectly
  // healthy league. `null` here means "no NFL week is running", which the
  // board renders as its own state rather than as a failed read.
  const mflOnly = url.searchParams.get('source') === 'mfl';
  // Only the MFL Live app's view carries the poll hint.
  const kickoffs = mflOnly ? await loadKickoffs() : [];
  const currentWeek = getCurrentNFLWeek(new Date());
  const requested = Number.parseInt(url.searchParams.get('week') ?? '', 10);
  const week = Number.isFinite(requested) && requested > 0 ? requested : currentWeek;

  if (!week) {
    const empty = { ok: true, week: 0, leagues: [], playerMeta: {}, preSeason: true };
    return new Response(
      JSON.stringify(mflOnly ? { ...empty, ...mflLiveAppCadence(empty, kickoffs, Date.now()) } : empty),
      { status: 200, headers: NO_STORE },
    );
  }

  try {
    const { board } = await assembleMflLiveBoard({
      user,
      week,
      // A CHECK against what the session may see, never an input — the
      // resolver only returns ids already present in this owner's own list.
      leaguesParam: url.searchParams.get('leagues'),
      // The choice saved to the ACCOUNT, so the phone (which has no cookie)
      // and the web board watch the same leagues; the cookie is the fallback.
      leaguesCookie: await readMflLiveSelection(user, cookies.get(MFL_LIVE_LEAGUE_COOKIE)?.value),
      mflOnly,
    });
    return new Response(JSON.stringify(mflOnly ? toMflLiveAppBoard(board, kickoffs) : board), {
      status: 200,
      headers: NO_STORE,
    });
  } catch {
    // 200 with `ok: false`, matching `/api/live-scoring`: the island keeps its
    // last good payload and flips a freshness pill rather than blanking a
    // board mid-afternoon. `{}` is truthy, so the client gates on the FLAG.
    // The app still gets a poll hint, so a failed read is retried on the
    // schedule's cadence rather than never.
    const failed = { ok: false, week, leagues: [], playerMeta: {} };
    return new Response(
      JSON.stringify(mflOnly ? { ...failed, ...mflLiveAppCadence(failed, kickoffs, Date.now()) } : failed),
      { status: 200, headers: NO_STORE },
    );
  }
};
