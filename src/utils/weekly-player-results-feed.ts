/**
 * Load a league-season's Season Results payload for `PlayerDetailsModal`,
 * straight off the committed MFL feeds.
 *
 * WHY A LOADER AND NOT ANOTHER COPY OF THE GLUE. `buildWeeklyPlayerResults`
 * needs five feeds lined up on the SAME season, and getting that wrong has
 * shipped: pairing one season's results with another season's schedule stamped
 * BYE on all 17 weeks (`tests/weekly-player-results-schedule.test.ts`).
 * TheLeague's three pages each wired that by hand through `import.meta.glob`;
 * a fourth and fifth hand-wiring for the AFL's pages is how the seasons drift
 * apart. This is the one place the five feeds are chosen together.
 *
 * WHY NOT `import.meta.glob`. The AFL's free-agents page is deliberately
 * SSR-slim — its per-year feed parsing was moved out to a build step precisely
 * so 24 years of eager globs stop landing in the serverless bundle. Reading
 * ONE season at request time keeps that property. The feeds are league data,
 * read through src/utils/league-data.ts (the store, in production): a caller
 * awaits {@link preloadWeeklyPlayerResults} first so the sync build below is
 * served from memory.
 *
 * The result is cached per league-season: the payload covers every player in
 * the league at once, so building it per request would redo the same ~500
 * player × 17 week assembly on every page view.
 */

import { hasLeagueData, leagueFeedPath, preloadLeagueData, readLeagueDataSync } from './league-data';
import { buildWeeklyPlayerResults, type WeeklyResultsPayload } from './weekly-player-results';
import { parsePlayerWeekScores } from './player-week-scores.mjs';

/** Fallback when `league.json` carries no `endWeek` — TheLeague's own value. */
const DEFAULT_END_WEEK = 17;

const cache = new Map<string, WeeklyResultsPayload>();

/** Every feed the payload is built from. */
const FEEDS = [
  'weekly-results-raw.json',
  'nflSchedule-full.json',
  'nflSchedule.json',
  'league.json',
  'fantasyPointsAllowed.json',
  'players.json',
  'playerScores-by-week.json',
];

/** Load the feeds `loadWeeklyPlayerResults(dataPath, year)` reads. */
export function preloadWeeklyPlayerResults(dataPath: string, year: number | string): Promise<void> {
  return preloadLeagueData(FEEDS.map((f) => leagueFeedPath(dataPath, year, f)));
}

/**
 * @param dataPath League data root, from the registry (`league.dataPath`) —
 *   never a hardcoded `data/<slug>` (CLAUDE.md § League registry).
 * @param year The SEASON year. Results-shaped data, so `getCurrentSeasonYear()`,
 *   never the league year.
 */
export function loadWeeklyPlayerResults(
  dataPath: string,
  year: number | string
): WeeklyResultsPayload {
  const key = `${dataPath}:${year}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // A feed that exists but could not be read (no preload, and not on disk)
  // leaves the payload uncached, so a request that preloads still gets it.
  let complete = true;
  const readFeed = (file: string): any => {
    const p = leagueFeedPath(dataPath, year, file);
    const value = readLeagueDataSync(p);
    if (value === null && hasLeagueData(p)) complete = false;
    return value;
  };

  const weeklyResultsRaw = readFeed('weekly-results-raw.json');
  // nflSchedule-full.json (MFL's W=ALL export) first: from week 1 onward the
  // plain nflSchedule.json carries only the CURRENT week, and a schedule
  // missing every other week renders all 17 as "Bye".
  const schedule =
    readFeed('nflSchedule-full.json') ??
    readFeed('nflSchedule.json');
  const leagueData = readFeed('league.json');

  // MFL's own last week, so the AFL's 18 and TheLeague's 17 are read rather
  // than remembered. A week the league does not score costs one empty row.
  const parsedEnd = Number.parseInt(String(leagueData?.league?.endWeek ?? ''), 10);
  const endWeek = Number.isInteger(parsedEnd) && parsedEnd >= 1 && parsedEnd <= 18
    ? parsedEnd
    : DEFAULT_END_WEEK;

  // Gated on the SCHEDULE alone, deliberately not on `weeklyResultsRaw`.
  // Requiring the lineup feed here would let the very blind spot this loader
  // exists to cover suppress its own fix: a league-season with no readable
  // weeklyResults but real full-pool scores would return `{}` and hide the
  // table again. `buildWeeklyPlayerResults` already normalizes a non-array.
  const payload = schedule
    ? buildWeeklyPlayerResults(
        weeklyResultsRaw ?? [],
        schedule,
        readFeed('fantasyPointsAllowed.json'),
        readFeed('players.json'),
        leagueData,
        endWeek,
        parsePlayerWeekScores(readFeed('playerScores-by-week.json')),
      )
    : {};

  if (complete) cache.set(key, payload);
  return payload;
}
