/**
 * Live win-probability + projected-final model.
 *
 * MFL's `liveScoring` feed gives current points and remaining NFL game-seconds
 * per player, plus league projections (from `projectedScores`), but NOT a win
 * probability — so we model it here. Used by the live-scoring island to draw
 * the projected final and the win-probability bar, and covered by
 * tests/live-win-probability.test.ts.
 *
 * The model is deliberately simple and explainable:
 *   - Projected final = current points + expected points from time still to be
 *     played, where a player's remaining expectation is his full-game
 *     projection scaled by the fraction of his NFL game that is left.
 *   - Win probability = normal CDF of the projected-final margin over a spread
 *     (σ) that shrinks as game-time runs out — lots of football left ⇒ more
 *     uncertainty ⇒ closer to 50/50; nothing left ⇒ deterministic.
 */

/** One NFL regulation game in seconds (4 × 15 min). MFL counts regulation. */
export const NFL_GAME_SECONDS = 3600;

/** Minimum spread (points) so a near-final game isn't perfectly certain. */
const MIN_SIGMA = 3;
/** Volatility per √(projected points still to be scored). Tuned, not fitted. */
const VOLATILITY = 3.4;

/** Minimal per-player shape the model needs. */
export interface ProjectablePlayer {
  /** Current live fantasy points. */
  live: number;
  /** Full-game league projection for this player (0 if none available). */
  projected: number;
  /** NFL game-seconds still to be played for this player (0 = final/not counting). */
  secondsRemaining: number;
}

/**
 * Expected final fantasy points for a single player: current points plus the
 * portion of his projection tied to the game-time still left. A player whose
 * game hasn't started (live 0, full seconds remaining) contributes his whole
 * projection; a finished player contributes exactly his live total.
 */
export function projectPlayerFinal(p: ProjectablePlayer): number {
  const remaining = clampSeconds(p.secondsRemaining);
  if (remaining <= 0) return p.live;
  const fractionLeft = remaining / NFL_GAME_SECONDS;
  return p.live + p.projected * fractionLeft;
}

/** Projected remaining points for a player (0 once his game is final). */
export function projectPlayerRemaining(p: ProjectablePlayer): number {
  const remaining = clampSeconds(p.secondsRemaining);
  if (remaining <= 0) return 0;
  return p.projected * (remaining / NFL_GAME_SECONDS);
}

/** Sum current live points for a lineup. */
export function sumLive(players: ProjectablePlayer[]): number {
  return players.reduce((s, p) => s + p.live, 0);
}

/** Team projected final = Σ per-player projected finals. */
export function projectTeamFinal(players: ProjectablePlayer[]): number {
  return players.reduce((s, p) => s + projectPlayerFinal(p), 0);
}

/** Team projected remaining points = Σ per-player remaining projections. */
export function projectTeamRemaining(players: ProjectablePlayer[]): number {
  return players.reduce((s, p) => s + projectPlayerRemaining(p), 0);
}

export interface MatchupProjection {
  homeLive: number;
  awayLive: number;
  homeProjectedFinal: number;
  awayProjectedFinal: number;
  /** Combined projected points still to be scored across both lineups. */
  remainingPoints: number;
  /** P(home team wins), 0–1. */
  homeWinProbability: number;
  /** Whether every relevant game is over (no points left to score). */
  isFinal: boolean;
}

/**
 * Full projection for a head-to-head. Pass the two lineups' starters.
 * Returns projected finals plus the home team's win probability.
 */
export function projectMatchup(
  homePlayers: ProjectablePlayer[],
  awayPlayers: ProjectablePlayer[],
): MatchupProjection {
  const homeLive = sumLive(homePlayers);
  const awayLive = sumLive(awayPlayers);
  const homeProjectedFinal = projectTeamFinal(homePlayers);
  const awayProjectedFinal = projectTeamFinal(awayPlayers);
  const remainingPoints =
    projectTeamRemaining(homePlayers) + projectTeamRemaining(awayPlayers);

  return {
    homeLive,
    awayLive,
    homeProjectedFinal,
    awayProjectedFinal,
    remainingPoints,
    homeWinProbability: winProbability(
      homeProjectedFinal,
      awayProjectedFinal,
      remainingPoints,
    ),
    isFinal: remainingPoints <= 0,
  };
}

/**
 * P(home wins) from projected finals and the projected points still to score.
 * With nothing left to play it collapses to a deterministic result on the
 * current margin (1 / 0.5 / 0). Otherwise it's the normal CDF of the margin
 * over a spread that widens with the remaining points.
 */
export function winProbability(
  homeProjectedFinal: number,
  awayProjectedFinal: number,
  remainingPoints: number,
): number {
  const margin = homeProjectedFinal - awayProjectedFinal;

  if (remainingPoints <= 0) {
    if (margin > 0) return 1;
    if (margin < 0) return 0;
    return 0.5;
  }

  const sigma = MIN_SIGMA + VOLATILITY * Math.sqrt(remainingPoints);
  return clamp01(normalCdf(margin / sigma));
}

// ── helpers ──

function clampSeconds(s: number): number {
  if (!Number.isFinite(s) || s < 0) return 0;
  return Math.min(s, NFL_GAME_SECONDS);
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation. */
function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}
