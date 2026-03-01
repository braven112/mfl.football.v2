/**
 * Value-Over-Replacement (VORP) Calculator
 *
 * VORP = player's projected points minus the replacement-level player's
 * projected points at that position. Replacement level is determined by
 * league size * starters per position.
 */

import { pointsToDollarValue } from './surplus-value';

export interface VORPConfig {
  teamCount: number;
  startersPerPosition: Record<string, number>;
}

/**
 * TheLeague config: 16 teams
 * Starting lineup: 1 QB, 2 RB (flex allows ~2), 3 WR (flex allows ~3), 1 TE, 1 PK, 1 DEF
 */
export const THE_LEAGUE_VORP_CONFIG: VORPConfig = {
  teamCount: 16,
  startersPerPosition: {
    QB: 1,
    RB: 2,
    WR: 3,
    TE: 1,
    PK: 1,
    DEF: 1,
  },
};

/**
 * Normalize position string for VORP lookup.
 */
function normalizePosition(position: string): string {
  const upper = position.toUpperCase();
  if (upper === 'DEF' || upper === 'D/ST') return 'DEF';
  return upper;
}

/**
 * Calculate the replacement-level projected points for each position.
 * Replacement level = the (teamCount * startersPerPosition + 1)th player (0-indexed).
 */
export function calculateReplacementLevels(
  projectedScores: Map<string, number>,
  players: Map<string, { position: string }>,
  config: VORPConfig = THE_LEAGUE_VORP_CONFIG,
): Map<string, number> {
  // Group players by position, sorted by projected points descending
  const byPosition = new Map<string, number[]>();

  for (const [id, pts] of projectedScores) {
    const player = players.get(id);
    if (!player) continue;
    const pos = normalizePosition(player.position);
    if (!config.startersPerPosition[pos]) continue;
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(pts);
  }

  // Sort each position descending
  for (const scores of byPosition.values()) {
    scores.sort((a, b) => b - a);
  }

  // Replacement level = the Nth player (0-indexed)
  const replacementLevel = new Map<string, number>();
  for (const [pos, starters] of Object.entries(config.startersPerPosition)) {
    const scores = byPosition.get(pos) ?? [];
    const replacementIndex = config.teamCount * starters; // 0-indexed = the (N+1)th player
    replacementLevel.set(pos, scores[replacementIndex] ?? 0);
  }

  return replacementLevel;
}

/**
 * Calculate VORP for a single player.
 */
export function calculateVORP(
  projectedPoints: number,
  position: string,
  replacementLevel: Map<string, number>,
): number {
  const replacement = replacementLevel.get(normalizePosition(position)) ?? 0;
  return projectedPoints - replacement;
}

export interface VORPResult {
  vorpPoints: number;
  vorpDollar: number;
}

/**
 * Calculate VORP for all players.
 * Returns Map<playerId, { vorpPoints, vorpDollar }>.
 */
export function calculateAllVORP(
  projectedScores: Map<string, number>,
  players: Map<string, { position: string }>,
  pointsPerDollar: number,
  config: VORPConfig = THE_LEAGUE_VORP_CONFIG,
): Map<string, VORPResult> {
  const replacementLevel = calculateReplacementLevels(
    projectedScores,
    players,
    config,
  );

  const results = new Map<string, VORPResult>();

  for (const [id, pts] of projectedScores) {
    const player = players.get(id);
    if (!player) continue;

    const vorpPoints = calculateVORP(pts, player.position, replacementLevel);
    const vorpDollar = pointsToDollarValue(vorpPoints, pointsPerDollar);

    results.set(id, { vorpPoints, vorpDollar });
  }

  return results;
}
