/**
 * Schefter feed mode — is the Schefter Report acting as a personal assistant
 * right now, or filling an empty offseason?
 *
 * In season the feed's job is signal: news about players you roster or watch,
 * plus the deadline nudges that used to exist only as a push. Out of season
 * that content does not exist, so the feed falls back to the league-wide
 * filler (wire, lore, quiet-day posts) that keeps it alive from February to
 * Labor Day. One date decides which, and it lives HERE so no page re-derives
 * it — the repo has already shipped the same year-rollover formula five times
 * with a different bug in each copy.
 *
 * Boundaries:
 * - OPENS on the **AFL NL draft** — the commissioner's official start of the
 *   season (2026-09-07). Once both AFL conferences have drafted, rosters are
 *   set and the feed is already carrying real news. Labor Day was the first
 *   cut and was too late: in 2026 the AL draft ran Aug 29 and the NL draft
 *   Aug 30, over a week before Labor Day, while the site still called it the
 *   offseason and served wire filler to owners whose teams were built.
 *   Site-wide, not per league: it is ONE season, and the drafts that open it
 *   happen to be the AFL's.
 * - CLOSES `SEASON_END_WEEKS` after kickoff.
 *
 * The date is READ from the AFL's resolved-events feed rather than written
 * here, so it moves with the league calendar instead of rotting after one
 * year. When that feed cannot answer — a future season it has not computed
 * yet, a missing file — it falls back to `SEASON_START_WEEKS_BEFORE_LABOR_DAY`
 * ahead of Labor Day, which is derived rather than hardcoded for the same
 * reason `nflWeekOneKickoff` is.
 *
 * SCOPE: this window is the Schefter feed's alone — the rail, the /news For
 * You default, the assistant-post lanes. It deliberately does NOT move
 * `getCurrentSeasonYear()`, whose Labor Day rollover is load-bearing for
 * standings, playoffs, MVP and draft order across ~71 files. Changing that
 * clock is its own change with its own testing.
 *
 * Two near-misses this module deliberately does NOT reuse:
 * - `isSeasonWindowOpen()` from pecking-order-season-window.mjs closes at
 *   SEASON_WINDOW_WEEKS = 20 (~late January), which is BEFORE the Super Bowl.
 *   That constant is the Pecking Order's own tuning; sharing it would mean
 *   retuning that column silently moves the feed, and vice versa. Only the
 *   kickoff math is shared, because that part is a fact about the NFL.
 * - `isInSeason()` from current-week.ts is table-driven off SEASON_CONFIGS
 *   (2024-2026 only) and expires. The Labor Day-derived math does not.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCurrentSeasonYear, getLaborDayForYear } from './league-year';
import { getLeagueBySlug } from '../config/leagues';
import { nflWeekOneKickoff } from './pecking-order-season-window.mjs';

export type FeedMode = 'in-season' | 'offseason';

/**
 * Weeks after kickoff that the feed stays in season mode.
 *
 * The Super Bowl falls ~22 weeks after the opener (2027-02-14 for a
 * 2026-09-10 kickoff). 23 leaves a few days on the far side so the feed does
 * not flip to filler on the Monday morning everyone is still talking about the
 * game. Verified against the 2024-2027 openers in
 * tests/schefter-season-mode.test.ts.
 */
export const SEASON_END_WEEKS = 23;

/**
 * Fallback only — used when the AFL's resolved-events feed cannot supply the
 * NL draft date for the season being asked about. Three weeks clears both
 * leagues' real starts without reaching back into the summer.
 */
export const SEASON_START_WEEKS_BEFORE_LABOR_DAY = 3;

/** The event that officially opens the season. */
export const SEASON_START_EVENT_ID = 'afl-nl-draft';

/** Parsed once per process; the file is cron-written and small. */
let cachedEvents: { leagueYear?: number; events?: Array<{ id: string; startDate?: string }> } | null | undefined;

function readSeasonEvents() {
  if (cachedEvents !== undefined) return cachedEvents;
  try {
    // Path from the REGISTRY, never a literal — tests/league-literal-guard
    // fails on a `data/afl-fantasy` string in src/.
    const league = getLeagueBySlug('afl-fantasy');
    cachedEvents = league
      ? JSON.parse(readFileSync(join(process.cwd(), league.dataPath, 'resolved-events.json'), 'utf8'))
      : null;
  } catch {
    cachedEvents = null;
  }
  return cachedEvents;
}

/** The NL draft instant for `seasonYear`, or null when the feed can't say. */
/**
 * Midnight PACIFIC on the calendar day `iso` names.
 *
 * The event feed is cron-written, and its `startDate` carries a time component
 * that depends on the TZ of the process that generated it: the same NL draft
 * was written as `2026-08-30T00:00:00.000Z` by a run under UTC and
 * `2026-08-30T07:00:00.000Z` by one under the app's pinned
 * `America/Los_Angeles`. Consuming the instant would let a re-generated feed
 * slide the season switch seven hours — in the UTC case, into the evening of
 * the day BEFORE the draft. The stable fact is the calendar date, so take the
 * date portion and anchor it to the league's own clock.
 *
 * -07:00 is PDT, which is what late August/early September is in every year
 * this switch can open in; the season never begins during PST.
 */
function startOfPacificDay(iso: string): Date | null {
  const day = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00-07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function seasonStartEventDate(seasonYear: number): Date | null {
  const data = readSeasonEvents();
  if (!data || data.leagueYear !== seasonYear) return null;
  const iso = (data.events ?? []).find((e) => e.id === SEASON_START_EVENT_ID)?.startDate;
  if (!iso) return null;
  return startOfPacificDay(iso);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The instant season mode begins for `seasonYear` — the NL draft, or the fallback. */
export function seasonModeStart(seasonYear: number): Date {
  return (
    seasonStartEventDate(seasonYear) ??
    new Date(
      getLaborDayForYear(seasonYear).getTime() -
        SEASON_START_WEEKS_BEFORE_LABOR_DAY * WEEK_MS,
    )
  );
}

/** The instant season mode ends for `seasonYear`. */
export function seasonModeEnd(seasonYear: number): Date {
  return new Date(nflWeekOneKickoff(seasonYear).getTime() + SEASON_END_WEEKS * WEEK_MS);
}

/**
 * Which mode the feed is in at `now`.
 *
 * The season year comes from `getCurrentSeasonYear()` — the RESULTS clock
 * (Labor Day), never `getCurrentLeagueYear()` (Feb 14, roster-management
 * shaped). Picking the wrong one here would leave the feed in season mode for
 * roughly six months of the calendar.
 */
export function resolveFeedMode(now: Date = new Date()): FeedMode {
  // `getCurrentSeasonYear` still rolls at Labor Day, so in the weeks BEFORE it
  // this returns last season. Check that season's window first, then the one
  // opening ahead of us — otherwise the pre-Labor-Day stretch this constant
  // exists to cover would resolve against a season that ended in February.
  const seasonYear = getCurrentSeasonYear(now);
  for (const year of [seasonYear, seasonYear + 1]) {
    if (now >= seasonModeStart(year) && now <= seasonModeEnd(year)) return 'in-season';
  }
  return 'offseason';
}

/**
 * The tab a visitor lands on when the URL carries no `?source=`.
 *
 * This one line is the whole "quiet by default" decision: in season a signed-in
 * owner opens on their own players, everyone else opens on the full feed.
 * `null` means "All" — the historical default, and the only thing a
 * logged-out or team-less visitor ever sees, in either mode.
 *
 * An explicit `?source=` in the URL must always win over this; callers apply
 * it only when the param is absent.
 */
export function defaultSource(mode: FeedMode, canWatch: boolean): 'watching' | null {
  return mode === 'in-season' && canWatch ? 'watching' : null;
}
