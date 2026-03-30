/**
 * NFL week detection utilities.
 *
 * Determines the current NFL week based on kickoff dates,
 * and finds the last completed week from scoring data.
 */

/** NFL season kickoff dates (Thursday night, Week 1). */
const KICKOFF_DATES = {
  2024: new Date('2024-09-05T20:20:00-04:00'),
  2025: new Date('2025-09-04T20:20:00-04:00'),
  2026: new Date('2026-09-10T20:20:00-04:00'),
  2027: new Date('2027-09-09T20:20:00-04:00'),
};

/**
 * Get the current NFL week number (1-18) for a given season year.
 * Returns 0 if before the season, caps at 18 if after.
 */
export function getCurrentNFLWeek(year, now = new Date()) {
  const kickoff = KICKOFF_DATES[year];
  if (!kickoff) return 0;
  const diff = now - kickoff;
  if (diff < 0) return 0;
  const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  return Math.min(week, 18);
}

/**
 * Find the last completed week from weekly results data.
 * A week is "complete" when all 16 franchises have non-zero scores.
 */
export function getCompletedWeek(weeklyResults) {
  if (!weeklyResults?.weeks) return 0;
  for (let i = weeklyResults.weeks.length - 1; i >= 0; i--) {
    const week = weeklyResults.weeks[i];
    const scores = Object.values(week.scores || {});
    if (scores.length >= 16 && scores.every(s => s > 0)) {
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
