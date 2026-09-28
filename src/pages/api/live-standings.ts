/**
 * GET /api/live-standings?week=N — the poll behind `/live/standings`.
 *
 * Every league the signed-in owner has switched on in MFL Live, as standings
 * plus this week's matchups (what the Live and Projected views add). The page
 * renders its first paint in process and only its POLL comes here — see
 * `src/pages/live/standings.astro`.
 *
 * The league set comes from the session's own MFL leagues, narrowed by the
 * same cookie `/live` reads. Nothing in the query can widen it.
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { assembleMflLiveStandings } from '../../utils/live/mfl-live-standings';
import { MFL_LIVE_LEAGUE_COOKIE } from '../../utils/mfl-live-selection';

export const prerender = false;

export const GET: APIRoute = async ({ url, request, cookies }) => {
  const user = getAuthUser(request);
  if (!user) return json({ ok: false, error: 'unauthenticated' }, 401);

  const week = parseInt(url.searchParams.get('week') ?? '', 10);
  if (!Number.isInteger(week) || week < 1 || week > 25) {
    return json({ ok: false, error: 'Valid week parameter required' }, 400);
  }

  try {
    const standings = await assembleMflLiveStandings({
      user,
      week,
      leaguesParam: url.searchParams.get('leagues'),
      leaguesCookie: cookies.get(MFL_LIVE_LEAGUE_COOKIE)?.value ?? null,
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
