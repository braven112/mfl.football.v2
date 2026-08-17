/**
 * Current league-year / season-year clocks for node scripts.
 *
 * Same Feb-14 / Labor-Day logic as src/utils/league-year.ts and the inline
 * copy in scripts/fetch-mfl-feeds.mjs#getYearsToFetch (which predates this
 * helper). Two independent clocks — see CLAUDE.md "Year rollover":
 *
 *   - league year advances Feb 14 @ 8:45 PM PT (new MFL league created)
 *   - season year advances Labor Day (NFL season starts)
 *
 * The base (pivot) year is ALWAYS `calendarYear - 1`; the two cutoff checks
 * are what advance it. Env pins (PUBLIC_BASE_YEAR / MFL_YEAR / MFL_SEASON)
 * are floor-only: a stale pin self-heals and a pin can never drag the
 * calculation backwards (see tests/league-year-rollover.test.ts).
 */

const getNonEmpty = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

/** Labor Day for a given year (first Monday in September). */
export const getLaborDay = (year) => {
  const septemberFirst = new Date(year, 8, 1); // Month 8 = September (0-indexed)
  const dayOfWeek = septemberFirst.getDay(); // 0 = Sunday, 1 = Monday, etc.

  let daysUntilMonday;
  if (dayOfWeek === 1) {
    daysUntilMonday = 0; // Sept 1st is already Monday
  } else if (dayOfWeek === 0) {
    daysUntilMonday = 1; // Sept 1st is Sunday, Labor Day is Sept 2nd
  } else {
    daysUntilMonday = 8 - dayOfWeek; // Days until next Monday
  }

  return new Date(year, 8, 1 + daysUntilMonday, 0, 0, 0, 0);
};

/**
 * Resolve the two year clocks.
 *
 * @param {Date} [now] - injectable for tests; defaults to the current time
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ currentLeagueYear: number, currentSeasonYear: number }}
 */
export const getCurrentYears = (now = new Date(), env = process.env) => {
  const envYear = getNonEmpty(env.PUBLIC_BASE_YEAR) ||
    getNonEmpty(env.MFL_YEAR) ||
    getNonEmpty(env.MFL_SEASON);

  // Base year is always the previous calendar year; env pin only pushes it
  // forward (mirrors src/utils/league-year.ts).
  const autoBaseYear = now.getFullYear() - 1;
  const parsedEnvYear = envYear ? parseInt(envYear, 10) : NaN;
  const baseYear = Number.isFinite(parsedEnvYear)
    ? Math.max(parsedEnvYear, autoBaseYear)
    : autoBaseYear;

  // Feb 14th @ 8:45 PM PT cutoff (Feb 15 04:45 UTC in PST)
  const febCutoff = new Date(Date.UTC(now.getFullYear(), 1, 15, 4, 45, 0, 0));

  // Labor Day cutoff (first Monday in September)
  const laborDay = getLaborDay(now.getFullYear());

  let currentLeagueYear = baseYear;
  let currentSeasonYear = baseYear;

  // After Feb 14th @ 8:45 PT, league year advances (rosters move to new MFL league)
  if (now >= febCutoff) {
    currentLeagueYear = baseYear + 1;
  }

  // After Labor Day, season year advances (standings/playoffs show new season)
  if (now >= laborDay) {
    currentSeasonYear = baseYear + 1;
  }

  return { currentLeagueYear, currentSeasonYear };
};
