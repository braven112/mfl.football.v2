/**
 * Reader for data/nfl/bye-weeks.json.
 *
 * The bye calendar decides which seasons can be scheduled at all: without it
 * there is no way to know which weeks are clean, so a season MFL has not
 * published byes for is not schedulable. That makes "seasons we hold byes for"
 * the right list to offer, and the right default — NOT `getCurrentSeasonYear()`,
 * which rolls at Labor Day and therefore still says "last season" through the
 * entire summer, exactly when next season's schedule is being built.
 *
 * Refresh with `node scripts/fetch-nfl-bye-weeks.mjs`.
 */
import { readLeagueDataSync } from './league-data';

/**
 * League data, through src/utils/league-data.ts. Sync because its callers
 * are; the file is in the hot set src/middleware.ts preloads on every request
 * (src/utils/request-league-data.ts).
 */
export const BYE_WEEKS_FILE = 'data/nfl/bye-weeks.json';

const readFile = (): Record<string, Record<string, number>> =>
  readLeagueDataSync<{ seasons?: Record<string, Record<string, number>> }>(BYE_WEEKS_FILE)?.seasons ?? {};

/** Seasons we hold an NFL bye calendar for, newest first. */
export function schedulableSeasons(): number[] {
  return Object.keys(readFile())
    .map(Number)
    .filter((y) => Number.isInteger(y))
    .sort((a, b) => b - a);
}

/** NFL team code -> bye week for one season, or null if we have no calendar. */
export function byeWeeksForSeason(year: number): Record<string, number> | null {
  return readFile()[String(year)] ?? null;
}
