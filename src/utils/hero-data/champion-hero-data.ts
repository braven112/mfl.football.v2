/**
 * Champion-hero data helper.
 *
 * Casting rule (Brandon): the champion-crowned hero features the CHAMPION's
 * TOP SCORER in the championship game — the player who won it for them. This
 * helper joins two existing offseason-hero-data readers:
 *   - getChampionshipResult(seasonYear) → who won (winnerFranchiseId + scores)
 *   - getWeekTopScorerCandidates(seasonYear) → the completed week's box score
 *     (highest week present in the playerScores feed = the title game week)
 * then filters the box score to the winning franchise and picks the single
 * highest-scoring player.
 *
 * Season resolution mirrors ChampionCrownedHero's enrichChampion: the
 * championship spans the Dec→Jan boundary, so try the derived season year
 * first, then fall back to seasonYear-1 (a January reference date resolves to
 * the previous NFL season).
 */

import {
  getChampionshipResult as defaultGetChampionshipResult,
  getWeekTopScorerCandidates as defaultGetWeekTopScorerCandidates,
} from '../offseason-hero-data';

/** The champion's title-game top scorer. */
export interface ChampionTopScorer {
  playerId: string;
  franchiseId: string;
  score: number;
  /** The championship-game week (highest week in the playerScores feed) */
  week: number;
}

/**
 * Thin injectable seam so tests can pass fixture data without touching the
 * on-disk feeds. Both default to the real offseason-hero-data readers.
 */
export interface ChampionDataDeps {
  getChampionshipResult: typeof defaultGetChampionshipResult;
  getWeekTopScorerCandidates: typeof defaultGetWeekTopScorerCandidates;
}

const defaultDeps: ChampionDataDeps = {
  getChampionshipResult: defaultGetChampionshipResult,
  getWeekTopScorerCandidates: defaultGetWeekTopScorerCandidates,
};

/**
 * Resolve the champion's top scorer in the championship game for a season.
 *
 * Returns null when there's no championship result (season not played /
 * bracket not final) or when the winning franchise has no scored player in
 * the title-game week (feed missing or empty).
 *
 * @param seasonYear - The season to resolve. Tries `seasonYear`, then
 *   `seasonYear - 1` (Dec→Jan boundary), matching ChampionCrownedHero.
 * @param deps - Injectable readers (defaults to real feeds).
 */
export function getChampionshipWeekTopScorer(
  seasonYear: number,
  deps: ChampionDataDeps = defaultDeps,
): ChampionTopScorer | null {
  return (
    resolveForYear(seasonYear, deps) ?? resolveForYear(seasonYear - 1, deps)
  );
}

/** Single-year resolution (no fallback). */
function resolveForYear(
  seasonYear: number,
  deps: ChampionDataDeps,
): ChampionTopScorer | null {
  const result = deps.getChampionshipResult(seasonYear);
  if (!result) return null;

  const { week, candidates } = deps.getWeekTopScorerCandidates(seasonYear);
  if (week <= 0 || !candidates.length) return null;

  let best: ChampionTopScorer | null = null;
  for (const c of candidates) {
    if (c.franchiseId !== result.winnerFranchiseId) continue;
    if (!best || c.score > best.score) {
      best = {
        playerId: c.playerId,
        franchiseId: c.franchiseId,
        score: c.score,
        week,
      };
    }
  }
  return best;
}
