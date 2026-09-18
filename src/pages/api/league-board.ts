import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { getLeagueBySlug, leagueHasFeature, type CanonicalLeagueSlug } from '../../config/leagues';
import { assembleLeagueBoard } from '../../utils/live/league-board';
import { strictThrowbackScopeForLeagueSlug } from '../../utils/throwback-scope';

export const prerender = false;

/**
 * The league board's POLL.
 *
 * It answers the CANONICAL model (`src/types/live.ts`) rather than the raw MFL
 * payload `/api/live-scoring` serves, because the board that reads it is the
 * shared kit and the kit does not know MFL's shape. The page still assembles
 * its own first paint IN PROCESS and never through here — a page that fetches
 * its own API to render itself puts our edge in the path of its first paint,
 * and this repo has already shipped that outage.
 *
 * ── IT GOES THROUGH THE SAME ASSEMBLER AS THE PAGE ────────────────────────
 * `assembleLeagueBoard`, not `readLeagueLive` directly. Three things would
 * otherwise differ 25 seconds after the first paint, and each is worse for
 * being intermittent:
 *
 *  - **Throwback art.** Resolved on the page alone, the board reverts to
 *    present-day crests on the first poll — a change an owner attributes to
 *    the game rather than to us.
 *  - **The viewer's own matchup.** Scoped by league in one place, so a
 *    session from another league cannot light up "YOUR MATCHUP" here on a
 *    franchise `0001` it does not own.
 *  - **The offseason replay.** The page falls back to it on an empty-but-
 *    healthy feed; a poll that did not would blank the board a minute later.
 *
 * ── THE SLATE IS NOT HERE ─────────────────────────────────────────────────
 * `games` comes back empty and that is deliberate. The island reads the NFL
 * slate from `useNflScoreboard`, which shares its poll store with the games
 * rail, so putting an ESPN read on this route would add a second fetch per
 * viewer per poll for data the page already has a live source for.
 */
export const GET: APIRoute = async ({ url, request }) => {
  const slugParam = url.searchParams.get('league') ?? '';
  const league = getLeagueBySlug(slugParam);

  // A league we do not run, or one whose board is switched off in the
  // registry, is a 400 rather than a default league's board: answering with
  // someone else's scores is worse than answering with nothing.
  if (!league || !leagueHasFeature(league.slug, 'liveScoring')) {
    return json({ ok: false, error: 'Unknown league' }, 400);
  }
  const slug = league.slug as CanonicalLeagueSlug;

  const weekNum = parseInt(url.searchParams.get('week') ?? '', 10);
  if (!Number.isInteger(weekNum) || weekNum < 1 || weekNum > 25) {
    return json({ ok: false, error: 'Valid week parameter required' }, 400);
  }

  const yearNum = parseInt(url.searchParams.get('year') ?? '', 10);
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
    ? yearNum
    : getCurrentSeasonYear();

  try {
    const assembled = await assembleLeagueBoard({
      slug,
      leagueId: league.id,
      week: weekNum,
      year,
      // Only the signed session. The viewer's own franchise and their stored
      // throwback era both come from it, and nothing unsigned may name either.
      authUser: getAuthUser(request),
      searchParams: url.searchParams,
      // STRICT: the lenient resolver falls back to TheLeague for anything it
      // does not recognise, which would hand a best-ball board TheLeague's era
      // rules. `undefined` is the right answer for a league with no throwback.
      throwbackScope: strictThrowbackScopeForLeagueSlug(slug) ?? undefined,
      sample: leagueHasFeature(slug, 'liveScoringSample'),
    });
    return json(assembled.board, 200);
  } catch {
    // `ok: false` rather than a 500: the island keeps its last good board on a
    // failed poll, so a live screen degrades to "numbers from a minute ago"
    // instead of going blank. The pill is what says the read failed.
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
