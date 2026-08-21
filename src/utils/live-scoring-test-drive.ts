/**
 * TEMPORARY — Live Scoring test-drive promo (2026-08-20 → 2026-08-23 PT).
 *
 * The live-scoring board joins MFL fantasy points to real ESPN game data, and
 * none of that can be exercised in the offseason: MFL's `liveScoring` export
 * errors outright before the season starts, so the board has nothing to show
 * and nobody can tell whether the ESPN half works. `?demo=live` is the answer
 * — real CURRENT rosters on the fantasy side, a genuinely live NFL slate on
 * the other — but it needs four query params that no owner would guess.
 *
 * Hence this promo: it puts the URL, and an explanation of each param, at the
 * top of both homepages for the preseason weekend so real owners look at real
 * games on their real phones before Week 1.
 *
 * **It removes itself.** Past the window below `isTestDriveWindow` returns
 * false and both homepages render nothing extra — so a forgotten merge cannot
 * leave a stale "test this today" banner up in October. When it lapses for
 * good, delete this file, LiveScoringTestDrive.astro, and the two call sites
 * (both homepages); nothing else imports it.
 */

import { ALL_LEAGUES, leagueHasFeature, type LeagueDefinition } from '../config/leagues';

/**
 * The slate the board is pointed at.
 *
 * `demo=live` is the mode; the three `espn*` params are the validation
 * override (see resolveEspnTarget) that swaps the page's own week for another
 * ESPN slate. Without them the board asks for regular-season week 1, which
 * does not exist yet, and every game comes back empty — which is exactly the
 * "is it broken or is it just August?" ambiguity this promo exists to remove.
 */
export const TEST_DRIVE_PARAMS: ReadonlyArray<readonly [param: string, value: string, note: string]> = [
  ['demo', 'live', 'Real current rosters, live NFL games. MFL has no fantasy points yet, so every score reads 0.0 — that part is expected.'],
  ['espnSeason', '1', 'Which ESPN season type: 1 preseason, 2 regular, 3 postseason.'],
  ['espnWeek', '3', 'Week within that slate — preseason week 3.'],
  ['espnYear', '2026', 'Season year — ESPN files a January playoff game under the previous season, so this is not always the calendar year.'],
];

/** `demo=live&espnSeason=1&…` — the query string as it appears in the URL. */
export const TEST_DRIVE_QUERY = TEST_DRIVE_PARAMS.map(([k, v]) => `${k}=${v}`).join('&');

/**
 * PT window, as timestamps. Preseason week 3 runs Thu 8/20 → Sun 8/23; the
 * promo covers exactly those four days and then stops. Note the day boundary
 * is PACIFIC, not UTC — written on the evening of the 20th PT, which is
 * already the 21st in UTC, and a UTC-dated window would have shipped dark
 * through the night games it was built for.
 */
const STARTS_AT = Date.parse('2026-08-20T00:00:00-07:00');
const ENDS_AT = Date.parse('2026-08-24T00:00:00-07:00');

export function isTestDriveWindow(now: Date): boolean {
  const t = now.getTime();
  return t >= STARTS_AT && t < ENDS_AT;
}

export interface TestDriveBoard {
  slug: string;
  name: string;
  /** Internal route, prefix intact — both homepages render prefixed paths. */
  path: string;
  /** True for the league whose homepage is being rendered. */
  isCurrent: boolean;
}

/**
 * One entry per league with something to actually look at, current league
 * first. Derived from the registry rather than listed here, so a league that
 * gains or loses `liveScoring` is right without touching this file.
 *
 * Draft-only leagues are excluded even though they carry the flag: their
 * season is created on MFL at draft time, so before it there are no matchups
 * and `?demo=live` renders the honest-but-useless "scores will appear here
 * when games begin" (verified against best-ball-1). A promo whose whole job
 * is "go look at this" must not link a page with nothing on it — that reads
 * as the feature being broken, which is the opposite of the point.
 */
export function testDriveBoards(currentSlug: string): TestDriveBoard[] {
  return (ALL_LEAGUES as LeagueDefinition[])
    .filter((l) => leagueHasFeature(l.slug, 'liveScoring') && !l.bestBall)
    .map((l) => ({
      slug: l.slug,
      name: l.name,
      path: `/${l.slug}/live-scoring?${TEST_DRIVE_QUERY}`,
      isCurrent: l.slug === currentSlug,
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}
