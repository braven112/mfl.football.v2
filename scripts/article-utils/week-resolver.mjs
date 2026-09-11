/**
 * NFL week detection utilities.
 *
 * Determines the current NFL week from the published NFL schedule,
 * and finds the last completed week from scoring data.
 */

import {
  REGULAR_SEASON_WEEKS,
  nflWeekFor,
  nflWeekStartInstant,
} from '../../src/utils/nfl-week-starts.mjs';

/**
 * The Week 1 kickoff instant for a season.
 *
 * This used to be a hand-maintained `KICKOFF_DATES` map covering 2024-2027,
 * every entry of which assumed a Thursday. Its 2026 entry said Sep 10; the
 * season actually opened Wednesday Sep 9. The map is gone —
 * src/utils/nfl-week-starts.mjs reads MFL's published schedule and falls back
 * to the Labor Day derivation only for seasons the NFL has not released, so
 * this never returns null and never silently expires.
 *
 * @param {number} year
 * @returns {Date}
 */
export function getKickoffDate(year) {
  return nflWeekStartInstant(year, 1);
}

/**
 * Get the current NFL week number for a given season year, capped at the
 * regular season. Returns 0 before the season's first game.
 *
 * The boundary rule lives in nflWeekFor: a week becomes current when the
 * PREVIOUS week ends (the Tuesday after it opened), not when its own first
 * game kicks off. Anchoring on the kickoff alone makes the week lag whenever
 * the next one opens late — 2026's week 18 is all-Sunday, so Jan 5-9 would
 * still report week 17 while MFL had long since advanced.
 */
export function getCurrentNFLWeek(year, now = new Date()) {
  return Math.min(nflWeekFor(year, now), REGULAR_SEASON_WEEKS);
}

/**
 * Find the last completed week from weekly results data.
 * A week is "complete" when all franchises have non-zero scores.
 *
 * `minScores` is the league's franchise count — the historical default of 16
 * matches TheLeague; AFL callers must pass 24 or a week with only 16-23
 * reporting franchises is misclassified as complete.
 */
export function getCompletedWeek(weeklyResults, minScores = 16) {
  if (!weeklyResults?.weeks) return 0;
  for (let i = weeklyResults.weeks.length - 1; i >= 0; i--) {
    const week = weeklyResults.weeks[i];
    const scores = Object.values(week.scores || {});
    if (scores.length >= minScores && scores.every(s => s > 0)) {
      return week.week;
    }
  }
  return 0;
}

/**
 * Get the season year based on the current date.
 * Before February, we're still in the previous season.
 */
export function getSeasonYear(now = new Date()) {
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Get matchup pairings for a given week from weekly-results-raw data.
 * Returns array of { franchise1Id, franchise2Id } objects.
 */
export function getMatchupPairings(weeklyResultsRaw, weekNum) {
  if (!Array.isArray(weeklyResultsRaw)) return [];
  const weekData = weeklyResultsRaw.find(w =>
    String(w?.weeklyResults?.week) === String(weekNum)
  );
  if (!weekData?.weeklyResults?.matchup) return [];
  return weekData.weeklyResults.matchup.map(m => ({
    franchise1Id: m.franchise?.[0]?.id,
    franchise2Id: m.franchise?.[1]?.id,
  })).filter(m => m.franchise1Id && m.franchise2Id);
}
