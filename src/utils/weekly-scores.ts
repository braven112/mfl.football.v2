/**
 * Weekly Scores Utilities
 *
 * Functions for processing weekly fantasy scores data from MFL.
 * Used for trend analysis and player performance tracking.
 */

export interface WeeklyScoresByPlayer {
  [week: number]: number;
}

/**
 * Process raw weekly results data into a map of player scores by week
 *
 * @param rawData - Raw weekly results from MFL API
 * @param _currentWeek - Current week (unused but kept for API compatibility)
 * @returns Map of playerId -> { week: score }
 */
export function processWeeklyScores(
  rawData: any,
  _currentWeek?: number
): Map<string, WeeklyScoresByPlayer> {
  const scoresByPlayer = new Map<string, WeeklyScoresByPlayer>();

  // Ensure rawData is an array
  const weeks = Array.isArray(rawData)
    ? rawData
    : rawData?.weeklyResults
      ? [rawData]
      : [];

  weeks.forEach((weekItem: any) => {
    const weekResults = weekItem.weeklyResults;
    if (!weekResults) return;

    const week = parseInt(weekResults.week, 10);
    const matchups = Array.isArray(weekResults.matchup)
      ? weekResults.matchup
      : [weekResults.matchup];

    matchups.forEach((matchup: any) => {
      const franchises = Array.isArray(matchup.franchise)
        ? matchup.franchise
        : [matchup.franchise];

      franchises.forEach((franchise: any) => {
        const players = Array.isArray(franchise.player)
          ? franchise.player
          : franchise.player
            ? [franchise.player]
            : [];

        players.forEach((p: any) => {
          if (!scoresByPlayer.has(p.id)) {
            scoresByPlayer.set(p.id, {});
          }
          // Only store numeric scores
          const score = parseFloat(p.score);
          if (!isNaN(score)) {
            scoresByPlayer.get(p.id)![week] = score;
          }
        });
      });
    });
  });

  return scoresByPlayer;
}

/**
 * Calculate trend weeks based on current week
 * Returns up to 3 completed weeks, capped at week 17
 *
 * @param currentWeek - The current NFL week
 * @returns Array of week numbers for trend analysis
 */
export function calculateTrendWeeks(currentWeek: number): number[] {
  const lastCompletedWeek = Math.min(currentWeek > 1 ? currentWeek - 1 : 0, 17);
  const trendWeeks: number[] = [];

  for (let i = 0; i < 3; i++) {
    const w = lastCompletedWeek - i;
    if (w > 0) {
      trendWeeks.push(w);
    }
  }

  return trendWeeks;
}

/**
 * Get player's scores for specific weeks
 *
 * @param scoresByPlayer - Map from processWeeklyScores
 * @param playerId - Player ID to look up
 * @param weeks - Array of week numbers
 * @returns Array of scores for each week (null if no score)
 */
export function getPlayerTrendScores(
  scoresByPlayer: Map<string, WeeklyScoresByPlayer>,
  playerId: string,
  weeks: number[]
): (number | null)[] {
  const playerScores = scoresByPlayer.get(playerId);
  if (!playerScores) {
    return weeks.map(() => null);
  }

  return weeks.map((week) => playerScores[week] ?? null);
}

/**
 * Calculate average score for a player over given weeks
 *
 * @param scoresByPlayer - Map from processWeeklyScores
 * @param playerId - Player ID to look up
 * @param weeks - Array of week numbers
 * @returns Average score or null if no scores
 */
export function getPlayerAverageScore(
  scoresByPlayer: Map<string, WeeklyScoresByPlayer>,
  playerId: string,
  weeks: number[]
): number | null {
  const scores = getPlayerTrendScores(scoresByPlayer, playerId, weeks);
  const validScores = scores.filter((s): s is number => s !== null);

  if (validScores.length === 0) return null;

  return validScores.reduce((sum, s) => sum + s, 0) / validScores.length;
}
