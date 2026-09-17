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
 * WHY `readFileSync` AND NOT `import.meta.glob`. The AFL's free-agents page is
 * deliberately SSR-slim — its per-year feed parsing was moved out to a build
 * step precisely so 24 years of eager globs stop landing in the serverless
 * bundle. Reading ONE season at request time keeps that property, and it is
 * what `afl-player-scoring.ts` already does next door. Feeds older than
 * `SEASONS_KEPT` seasons are excluded from the function
 * (scripts/lib/archived-feed-files.mjs), so an archive season reads back empty
 * here and the modal hides the table exactly as it did before.
 *
 * The result is cached per league-season: the payload covers every player in
 * the league at once, so building it per request would redo the same ~500
 * player × 17 week assembly on every page view.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildWeeklyPlayerResults, type WeeklyResultsPayload } from './weekly-player-results';
import { parsePlayerWeekScores } from './player-week-scores.mjs';

/** Fallback when `league.json` carries no `endWeek` — TheLeague's own value. */
const DEFAULT_END_WEEK = 17;

const cache = new Map<string, WeeklyResultsPayload>();

function readFeed(dataPath: string, year: number | string, file: string): any {
  const full = resolve(process.cwd(), `${dataPath}/mfl-feeds/${year}/${file}`);
  try {
    return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : null;
  } catch {
    return null;
  }
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

  const weeklyResultsRaw = readFeed(dataPath, year, 'weekly-results-raw.json');
  // nflSchedule-full.json (MFL's W=ALL export) first: from week 1 onward the
  // plain nflSchedule.json carries only the CURRENT week, and a schedule
  // missing every other week renders all 17 as "Bye".
  const schedule =
    readFeed(dataPath, year, 'nflSchedule-full.json') ??
    readFeed(dataPath, year, 'nflSchedule.json');
  const leagueData = readFeed(dataPath, year, 'league.json');

  // MFL's own last week, so the AFL's 18 and TheLeague's 17 are read rather
  // than remembered. A week the league does not score costs one empty row.
  const parsedEnd = Number.parseInt(String(leagueData?.league?.endWeek ?? ''), 10);
  const endWeek = Number.isInteger(parsedEnd) && parsedEnd >= 1 && parsedEnd <= 18
    ? parsedEnd
    : DEFAULT_END_WEEK;

  const payload = schedule && Array.isArray(weeklyResultsRaw)
    ? buildWeeklyPlayerResults(
        weeklyResultsRaw,
        schedule,
        readFeed(dataPath, year, 'fantasyPointsAllowed.json'),
        readFeed(dataPath, year, 'players.json'),
        leagueData,
        endWeek,
        parsePlayerWeekScores(readFeed(dataPath, year, 'playerScores-by-week.json')),
      )
    : {};

  cache.set(key, payload);
  return payload;
}
