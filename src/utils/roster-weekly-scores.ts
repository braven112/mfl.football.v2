/**
 * Per-player weekly score lookup for the rosters page's trend columns.
 *
 * Extracted from `src/pages/theleague/rosters.astro`'s frontmatter. The input
 * is MFL's `weeklyResults` feed, which is shaped by how many of a thing there
 * were: one matchup comes back as an object, several as an array, and the same
 * for franchises and players. Every level below therefore needs the
 * array-or-single normalization, and dropping any one of them silently loses a
 * week of scores rather than throwing.
 */

/** MFL returns a single child as an object and multiple as an array. */
type OneOrMany<T> = T | T[];

interface WeeklyPlayerEntry {
  id?: string;
  /** MFL sends scores as strings, and as `''` for a player who did not play. */
  score?: string;
}

interface WeeklyFranchiseEntry {
  player?: OneOrMany<WeeklyPlayerEntry>;
}

interface WeeklyMatchupEntry {
  franchise?: OneOrMany<WeeklyFranchiseEntry>;
}

interface WeeklyResultsBody {
  week?: string | number;
  matchup?: OneOrMany<WeeklyMatchupEntry>;
}

export interface WeeklyResultsWeek {
  weeklyResults?: WeeklyResultsBody;
}

/** Raw feed: an array of weeks, or a single week's object. */
export type WeeklyResultsRaw = OneOrMany<WeeklyResultsWeek> | null | undefined;

/** playerId → `{ [week]: score }`. */
export type ScoresByPlayer = Map<string, Record<number, number>>;

/**
 * Build the playerId → week → score lookup the trend columns read.
 *
 * Non-numeric scores are skipped rather than stored as 0: a player who did not
 * play has no score, and a 0 would render as a real zero-point week.
 */
export function processWeeklyScores(rawData: WeeklyResultsRaw): ScoresByPlayer {
  const scoresByPlayer: ScoresByPlayer = new Map();

  const weeks: WeeklyResultsWeek[] = Array.isArray(rawData)
    ? rawData
    : rawData?.weeklyResults
      ? [rawData]
      : [];

  weeks.forEach((weekItem) => {
    const weekResults = weekItem.weeklyResults;
    if (!weekResults) return;

    const week = parseInt(String(weekResults.week), 10);
    const matchups = Array.isArray(weekResults.matchup)
      ? weekResults.matchup
      : [weekResults.matchup as WeeklyMatchupEntry];

    matchups.forEach((matchup) => {
      if (!matchup) return;
      const franchises = Array.isArray(matchup.franchise)
        ? matchup.franchise
        : [matchup.franchise as WeeklyFranchiseEntry];
      franchises.forEach((franchise) => {
        if (!franchise) return;
        const players = Array.isArray(franchise.player)
          ? franchise.player
          : franchise.player
            ? [franchise.player]
            : [];
        players.forEach((p) => {
          if (!p?.id) return;
          if (!scoresByPlayer.has(p.id)) {
            scoresByPlayer.set(p.id, {});
          }
          const score = parseFloat(p.score as string);
          if (!isNaN(score)) {
            scoresByPlayer.get(p.id)![week] = score;
          }
        });
      });
    });
  });

  return scoresByPlayer;
}
