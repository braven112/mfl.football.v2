/**
 * TEMPORARY — Live Scoring preseason hero (2026-08-20 → 2026-08-23 PT).
 *
 * For this one preseason weekend the homepage hero IS this message, on both
 * leagues — see `showTestDriveHero`, which the two homepages use to suppress
 * their normal hero rather than stack a second one above it.
 *
 * Why it needs a hero at all: the board joins MFL fantasy points to real ESPN
 * game data, and none of the ESPN half can be exercised in the offseason.
 * MFL's `liveScoring` export errors outright before the season, so the board
 * has nothing to show and nobody can tell whether the new work functions.
 * `?demo=live` fixes that — real CURRENT rosters on the fantasy side, a
 * genuinely live NFL slate on the other — but it takes four query params
 * nobody would guess, so the CTA carries them and the reader never sees them.
 *
 * **It removes itself.** Past the window below `isTestDriveWindow` returns
 * false, the homepages fall back to their normal hero rotation, and nothing
 * else changes — so a forgotten deploy cannot leave a "test this weekend"
 * hero up in October, nor a homepage with its real hero suppressed. When it
 * lapses for good, delete this file, LiveScoringTestDrive.astro, its test,
 * and the two homepage call sites; nothing else imports them.
 */

import { ALL_LEAGUES, leagueHasFeature, type LeagueDefinition } from '../config/leagues';

/**
 * The slate the board is pointed at.
 *
 * `demo=live` is the mode; the three `espn*` params are the validation
 * override (see resolveEspnTarget) that swaps the page's own week for another
 * ESPN slate. Without them the board asks for regular-season week 1, which
 * does not exist yet, and every game comes back empty — exactly the "is it
 * broken or is it just August?" ambiguity this hero exists to remove.
 *
 * These are plumbing, not copy. The hero used to explain each one in a
 * disclosure panel; owners do not need to read a query string to tap a button
 * (owner direction, 2026-08-21), so the CTA carries them and the page says
 * nothing about them.
 */
export const TEST_DRIVE_PARAMS: ReadonlyArray<readonly [param: string, value: string]> = [
  ['demo', 'live'],
  ['espnSeason', '1'],
  ['espnWeek', '3'],
  ['espnYear', '2026'],
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
}

/**
 * The board for THIS league, or null if it has none.
 *
 * One league, not both: an owner reading TheLeague's homepage is being asked
 * to check TheLeague's board, and offering the AFL's alongside it turns a
 * single instruction into a choice (owner direction, 2026-08-21).
 *
 * Draft-only leagues get null even though they carry the `liveScoring` flag:
 * their MFL season is created at draft time, so before it there are no
 * matchups and `?demo=live` renders the honest-but-useless "scores will appear
 * here when games begin" (verified against best-ball-1). A hero whose whole job
 * is "go look at this" must not link a page with nothing on it — that reads as
 * the feature being broken, which is the opposite of the point.
 */
export function testDriveBoard(slug: string): TestDriveBoard | null {
  const league = (ALL_LEAGUES as LeagueDefinition[]).find((l) => l.slug === slug);
  if (!league || league.bestBall || !leagueHasFeature(league.slug, 'liveScoring')) return null;
  return {
    slug: league.slug,
    name: league.name,
    path: `/${league.slug}/live-scoring?${TEST_DRIVE_QUERY}`,
  };
}

/**
 * Whether this league's homepage should show the preseason hero INSTEAD of its
 * normal one.
 *
 * The page asks the same question the component does, because the page is what
 * suppresses `SeasonDailyHero` / `AflHero`. Splitting the two conditions is how
 * a homepage ends up with no hero at all — or with two.
 */
export function showTestDriveHero(slug: string, now: Date): boolean {
  return isTestDriveWindow(now) && testDriveBoard(slug) !== null;
}
