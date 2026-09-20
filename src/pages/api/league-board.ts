import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentSeasonYear } from '../../utils/league-year';
import { getLeagueBySlug, leagueHasFeature, type CanonicalLeagueSlug } from '../../config/leagues';
import { assembleLeagueBoard } from '../../utils/live/league-board';
import { assembleMflLeagueBoard } from '../../utils/live/mfl-league-board';
import { discoverBoardLeagues } from '../../utils/cross-league-live';
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
  // Parsed once, before the two paths diverge — they validate identically and
  // a second copy is a second thing to keep in step.
  const week = parseInt(url.searchParams.get('week') ?? '', 10);
  const yearNum = parseInt(url.searchParams.get('year') ?? '', 10);
  const year = Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
    ? yearNum
    : getCurrentSeasonYear();

  // ── `?mfl=` — MFL Live's own league boards ──────────────────────────────
  // Any league the SIGNED-IN account is in, including the ones this site does
  // not run. It is a separate parameter rather than an overload of `?league=`
  // because the two authorise differently and must not be confusable: a slug
  // names a league this site runs and is public, while an MFL id is checked
  // against the owner's own league list and the read carries their cookie.
  const mflId = (url.searchParams.get('mfl') ?? '').trim();
  if (mflId) {
    return mflLeagueBoard({ mflId, week, year, request });
  }

  const slugParam = url.searchParams.get('league') ?? '';
  const league = getLeagueBySlug(slugParam);

  // A league we do not run, or one whose board is switched off in the
  // registry, is a 400 rather than a default league's board: answering with
  // someone else's scores is worse than answering with nothing.
  if (!league || !leagueHasFeature(league.slug, 'liveScoring')) {
    return json({ ok: false, error: 'Unknown league' }, 400);
  }
  const slug = league.slug as CanonicalLeagueSlug;

  if (!Number.isInteger(week) || week < 1 || week > 25) {
    return json({ ok: false, error: 'Valid week parameter required' }, 400);
  }

  try {
    const assembled = await assembleLeagueBoard({
      slug,
      leagueId: league.id,
      week,
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

/**
 * One league's board for MFL Live, polled.
 *
 * The page assembles its own first paint in process; this keeps it current.
 * Same posture as the slug path: a failed read is `ok: false` under a 200 so
 * the island holds its last good board rather than blanking a live screen.
 */
async function mflLeagueBoard(input: {
  mflId: string;
  week: number;
  year: number;
  request: Request;
}): Promise<Response> {
  const { mflId, week, year, request } = input;

  // Unauthenticated is a 401, not an empty board: every read on this path uses
  // the owner's own MFL cookie, and there is nothing to serve without one.
  const user = getAuthUser(request);
  if (!user) return json({ ok: false, error: 'unauthenticated' }, 401);

  if (!Number.isInteger(week) || week < 1 || week > 25) {
    return json({ ok: false, error: 'Valid week parameter required' }, 400);
  }

  try {
    // THE CHECK, and the reason this route cannot just take the id: the league
    // must be one this account is actually in. `discoverBoardLeagues` is keyed
    // on the owner's own MFL cookie, so a league id from a URL can only ever
    // narrow what the session may already see — never widen it.
    const leagues = await discoverBoardLeagues(user);
    const league = leagues.find((l) => l.id === mflId);
    if (!league) return json({ ok: false, error: 'Unknown league' }, 404);

    const { board } = await assembleMflLeagueBoard({ user, league, week, year });
    return json(board, 200);
  } catch {
    return json({ ok: false }, 200);
  }
}

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
