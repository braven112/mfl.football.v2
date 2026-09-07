/**
 * Current NFL Week Calculator
 * Automatically determines the current NFL week based on the season schedule
 *
 * The season structure is DERIVED, not tabulated. This file used to carry a
 * hand-maintained SEASON_CONFIGS list of Week 1 kickoffs for 2024-2026, which
 * meant `isInSeason()` and every week number silently expired after 2026 —
 * falling through to a helper that placed kickoff on the FIRST Thursday of
 * September (Sep 3 in 2026) instead of the Thursday after Labor Day (Sep 10),
 * a full week early.
 *
 * `nflWeekOneKickoff` reproduces all three retired rows to the minute and keeps
 * working for every year after them. It is the repo's one kickoff derivation,
 * shared with the Pecking Order's season window and the Schefter feed mode.
 */

import { nflWeekOneKickoff } from './pecking-order-season-window.mjs';

/** 18 regular-season weeks since the 2021 expansion, plus 4 playoff rounds. */
const REGULAR_SEASON_WEEKS = 18;
const PLAYOFF_WEEKS = 4;
const MAX_WEEK = REGULAR_SEASON_WEEKS + PLAYOFF_WEEKS;

/**
 * Calculate the NFL week number for a given date
 *
 * @param date - The date to calculate the week for (defaults to now)
 * @param year - The NFL season year (defaults to current year if before September, otherwise next year)
 * @returns The NFL week number (1-22), or null if date is before season starts
 */
export function getCurrentNFLWeek(date: Date = new Date(), year?: number): number | null {
  // Determine the season year if not provided
  // NFL season runs Sep-Feb, so Jan-Aug uses previous year's season
  const seasonYear = year ?? (date.getMonth() < 8 ? date.getFullYear() - 1 : date.getFullYear());

  const week1Start = nflWeekOneKickoff(seasonYear);

  // Check if date is before season starts
  if (date < week1Start) {
    return null;
  }

  // Calculate milliseconds since week 1 start
  const msSinceStart = date.getTime() - week1Start.getTime();

  // Convert to weeks (7 days = 1 week)
  const weeksSinceStart = Math.floor(msSinceStart / (7 * 24 * 60 * 60 * 1000));

  // Week number is weeks since start + 1, capped at the last playoff week
  return Math.min(weeksSinceStart + 1, MAX_WEEK);
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
