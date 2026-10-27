/**
 * GET /api/live-standings?week=N — the poll behind `/live/standings`.
 *
 * Every league the signed-in owner has switched on in MFL Live, as standings
 * plus this week's matchups (what the Live and Projected views add). The page
 * renders its first paint in process and only its POLL comes here — see
 * `src/pages/live/standings.astro`.
 *
 * The league set comes from the session's own MFL leagues, narrowed by the
 * same cookie `/live` reads. Nothing in the query can widen it. A paired TV's
 * watch-only pass reads it too: it is the page's own poll, and read-only.
 *
 * `?source=mfl` is the MFL Live mobile app's table: MFL data only, with no
 * headshots and no NFL club marks or colours (see `mflOnly` on the
 * assembler). The app signs in with a Bearer token, which `getBroadcastViewer`
 * accepts through `getMflLiveUser`. The app may leave `week` off: it then
 * gets the current NFL week, or `preSeason: true` when none is running. In
 * store mode each table also carries its ready-built `views` (Final, and Live
 * and Projected for Pro), so the phone holds no copy of the projection math.
 */
import type { APIRoute } from 'astro';
import { getBroadcastViewer } from '../../utils/broadcast-viewer';
import { getCurrentNFLWeek } from '../../utils/current-week';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { assembleMflLiveStandings } from '../../utils/live/mfl-live-standings';
import { MFL_LIVE_LEAGUE_COOKIE } from '../../utils/mfl-live-selection';
import { hasMflLivePro } from '../../utils/mfl-live-pro';

export const prerender = false;

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const user = (await getBroadcastViewer(request))?.user;
  if (!user) return json({ ok: false, error: 'unauthenticated' }, 401);

  const rawWeek = url.searchParams.get('week');
  let week: number;
  if (rawWeek === null || rawWeek === '') {
    // The RAW resolver result, never clamped up to 1 — MFL serves no live
    // scoring before the Week 1 kickoff, and `null` is its own state.
    const current = getCurrentNFLWeek(new Date());
    if (!current) {
      return json({ ok: true, week: 0, year: getCurrentSeasonYear(), leagues: [], preSeason: true }, 200);
    }
    week = current;
  } else {
    week = parseInt(rawWeek, 10);
    if (!Number.isInteger(week) || week < 1 || week > 25) {
      return json({ ok: false, error: 'Valid week parameter required' }, 400);
    }
  }

  try {
    const standings = await assembleMflLiveStandings({
      user,
      week,
      leaguesParam: url.searchParams.get('leagues'),
      leaguesCookie: cookies.get(MFL_LIVE_LEAGUE_COOKIE)?.value ?? null,
      mflOnly: url.searchParams.get('source') === 'mfl',
      // The same check the web page makes before it unlocks Live and Projected.
      proLocked: !hasMflLivePro(user),
    });
    return json({ ok: true, ...standings }, 200);
  } catch {
    // `ok: false` rather than a 500: the island keeps its last good tables on
    // a failed poll, so a live screen degrades to "a minute ago", never blank.
    return json({ ok: false }, 200);
  }
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Scores must never be cached.
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
