/**
 * Current NFL Week Calculator
 *
 * Determines the current NFL week from the PUBLISHED NFL schedule
 * (src/utils/nfl-week-starts.mjs), which falls back to the Labor Day
 * derivation only for seasons the NFL has not released yet.
 *
 * This file used to carry its own `SEASON_CONFIGS` table of Week 1 Thursdays,
 * two of them marked "estimated", plus a "first Thursday of September"
 * fallback. Its 2026 entry said Sep 10; the season opened Wednesday Sep 9. It
 * was one of six such tables in the repo, and they disagreed.
 *
 * Regular season is weeks 1-18; weeks 19-22 are the NFL playoffs, which we do
 * not hold start dates for and which run on a strict weekly cadence anyway.
 */

import { nflWeekFor } from './nfl-week-starts.mjs';

/**
 * Calculate the NFL week number for a given date.
 *
 * @param date - The date to calculate the week for (defaults to now)
 * @param year - The NFL season year (defaults to current year if before September, otherwise next year)
 * @returns The NFL week number (1-22), or null if date is before the season's first game
 */
export function getCurrentNFLWeek(date: Date = new Date(), year?: number): number | null {
  // NFL season runs Sep-Feb, so Jan-Aug uses the previous year's season.
  const seasonYear = year ?? (date.getMonth() < 8 ? date.getFullYear() - 1 : date.getFullYear());
  return nflWeekFor(seasonYear, date) || null;
}

/**
 * Get the current NFL week for the current season
 * Throws an error if called before the season starts
 *
 * @returns The current NFL week number (1-22)
 */
export function getCurrentWeek(): number {
  const week = getCurrentNFLWeek();

  if (week === null) {
    // If no current week, we're in the off-season
    // Return week 1 as a safe default for development
    return 1;
  }

  return week;
}

/**
 * Check if we're currently in the NFL season
 */
export function isInSeason(): boolean {
  return getCurrentNFLWeek() !== null;
}

/**
 * Get the current week for a specific league year
 * This is useful for historical data where we want to know what week it is
 * in that season context
 *
 * @param leagueYear - The year to get the current week for
 * @returns The current week number, or the last week if season is over
 */
export function getCurrentWeekForYear(leagueYear: number): number {
  const now = new Date();
  const currentYear = now.getFullYear();

  // If requesting a historical year, return the last week of that season
  if (leagueYear < currentYear) {
    return 18; // Last regular season week (or 22 if you want playoffs)
  }

  // If requesting current or future year, calculate normally
  const week = getCurrentNFLWeek(now, leagueYear);
  return week ?? 1;
}
