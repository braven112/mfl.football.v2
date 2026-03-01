/**
 * Surplus Value Calculator
 *
 * Converts projected fantasy points into dollar values and compares against
 * estimated auction costs to produce surplus value per player.
 * Positive surplus = bargain, negative surplus = overpay.
 */

import { parseNumber } from './formatters';
import type { SurplusValueInput, SurplusValueResult } from '../types/surplus-value';

const LEAGUE_MINIMUM = 425_000;

/**
 * Calculate league-wide points-per-dollar ratio from rostered players.
 */
export function calculatePointsPerDollar(
  projectedScores: Map<string, number>,
  rosteredPlayers: Map<string, { salary: number; position: string }>,
): number {
  let totalPoints = 0;
  let totalSalary = 0;
  for (const [id, roster] of rosteredPlayers) {
    const pts = projectedScores.get(id) ?? 0;
    if (pts > 0 && roster.salary > 0) {
      totalPoints += pts;
      totalSalary += roster.salary;
    }
  }
  return totalSalary > 0 ? totalPoints / totalSalary : 0;
}

/**
 * Convert projected points to a dollar value.
 */
export function pointsToDollarValue(
  projectedPoints: number,
  pointsPerDollar: number,
): number {
  if (pointsPerDollar <= 0) return 0;
  return Math.round(projectedPoints / pointsPerDollar);
}

/**
 * Estimate likely auction cost using rank-based multiplier curve.
 */
export function estimateAuctionCost(
  player: { id: string; position: string },
  signals: {
    customRank?: number;
    adpDynasty?: number;
    positionSalaryAvg: { top3Average: number; top5Average: number };
    totalAvailableCap: number;
    totalFreeAgents: number;
  },
): number {
  const avgPricePerPlayer =
    signals.totalFreeAgents > 0
      ? signals.totalAvailableCap / signals.totalFreeAgents
      : 1_000_000;

  const rank = signals.customRank ?? signals.adpDynasty ?? 999;

  // Rank-to-multiplier curve (exponential decay)
  let multiplier: number;
  if (rank <= 10) {
    multiplier = 10 - (rank - 1) * 0.6; // 10x -> 4.6x
  } else if (rank <= 30) {
    multiplier = 4.6 - ((rank - 10) / 20) * 2.6; // 4.6x -> 2.0x
  } else if (rank <= 100) {
    multiplier = 2.0 - ((rank - 30) / 70) * 1.0; // 2.0x -> 1.0x
  } else {
    multiplier = Math.max(0.5, 1.0 - ((rank - 100) / 200) * 0.5); // 1.0x -> 0.5x
  }

  let estimated = avgPricePerPlayer * multiplier;

  // Clamp: minimum is league minimum, max is position top3Average * 1.2
  const ceiling = signals.positionSalaryAvg.top3Average * 1.2;
  estimated = Math.max(LEAGUE_MINIMUM, Math.min(estimated, ceiling));

  // Round to nearest $50K
  return Math.round(estimated / 50_000) * 50_000;
}

/**
 * Calculate surplus value: dollar value minus estimated auction cost.
 */
export function calculateSurplusValue(
  projectedDollarValue: number,
  estimatedAuctionCost: number,
): number {
  return projectedDollarValue - estimatedAuctionCost;
}

/**
 * Calculate age from MFL birthdate (Unix timestamp in seconds).
 */
function calculateAge(birthdate: string | undefined): number | null {
  if (!birthdate) return null;
  const ts = parseInt(birthdate, 10);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const born = new Date(ts * 1000);
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDiff = now.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < born.getDate())) {
    age--;
  }
  return age;
}

/**
 * Normalize position string (e.g., "Def" -> "DEF").
 */
function normalizePosition(position: string): string {
  const upper = position.toUpperCase();
  if (upper === 'DEF' || upper === 'D/ST') return 'DEF';
  return upper;
}

/**
 * Calculate surplus values for all players.
 */
export function calculateAllSurplusValues(
  input: SurplusValueInput,
): SurplusValueResult[] {
  // Build projected scores map
  const projectedScores = new Map<string, number>();
  for (const ps of input.projectedScores) {
    const score = parseNumber(ps.score);
    if (score > 0) projectedScores.set(ps.id, score);
  }

  // Build player metadata map
  const playerMeta = new Map<
    string,
    { name: string; position: string; team: string; birthdate?: string }
  >();
  for (const p of input.players) {
    playerMeta.set(p.id, {
      name: p.name,
      position: normalizePosition(p.position),
      team: p.team,
      birthdate: p.birthdate,
    });
  }

  // Build rostered players map
  const rosteredPlayers = new Map<
    string,
    { salary: number; position: string; contractYears: number }
  >();
  let totalAvailableCap = 0;
  let totalFreeAgents = 0;
  const rosteredIds = new Set<string>();

  for (const franchise of input.rosters) {
    for (const rp of franchise.player) {
      const salary = parseNumber(rp.salary);
      const meta = playerMeta.get(rp.id);
      rosteredIds.add(rp.id);
      rosteredPlayers.set(rp.id, {
        salary,
        position: meta?.position ?? 'N/A',
        contractYears: parseInt(rp.contractYear, 10) || 0,
      });
    }
  }

  // Count free agents (players with projections who are not rostered)
  for (const id of projectedScores.keys()) {
    if (!rosteredIds.has(id)) {
      totalFreeAgents++;
    }
  }

  // Estimate total available cap (sum of all teams' current cap space, rough estimate)
  // We approximate: totalAvailableCap = (salaryCap * teamCount) - totalRosteredSalary
  const teamCount = input.rosters.length || 16;
  const salaryCap = 45_000_000;
  let totalRosteredSalary = 0;
  for (const { salary } of rosteredPlayers.values()) {
    totalRosteredSalary += salary;
  }
  totalAvailableCap = Math.max(0, salaryCap * teamCount - totalRosteredSalary);

  // Calculate points-per-dollar ratio
  const pointsPerDollar = calculatePointsPerDollar(
    projectedScores,
    rosteredPlayers,
  );

  // Build results for all players with projections
  const results: SurplusValueResult[] = [];

  for (const [playerId, pts] of projectedScores) {
    const meta = playerMeta.get(playerId);
    if (!meta) continue;

    const dollarValue = pointsToDollarValue(pts, pointsPerDollar);
    const customRank = input.customRankings?.get(playerId);
    const adpDynasty = input.adpDynasty?.get(playerId);

    const posAvg = input.salaryAverages.positions[meta.position] ?? {
      top3Average: 0,
      top5Average: 0,
    };

    const estCost = estimateAuctionCost(
      { id: playerId, position: meta.position },
      {
        customRank,
        adpDynasty,
        positionSalaryAvg: posAvg,
        totalAvailableCap,
        totalFreeAgents,
      },
    );

    const surplus = calculateSurplusValue(dollarValue, estCost);
    const surplusPercent = estCost > 0 ? surplus / estCost : 0;

    const rostered = rosteredPlayers.get(playerId);

    results.push({
      playerId,
      name: meta.name,
      position: meta.position,
      nflTeam: meta.team,
      age: calculateAge(meta.birthdate),
      projectedPoints: pts,
      dollarValue,
      estimatedCost: estCost,
      surplusValue: surplus,
      surplusPercent,
      isRostered: rosteredIds.has(playerId),
      currentSalary: rostered?.salary ?? null,
      contractYears: rostered?.contractYears ?? null,
      rank: customRank ?? adpDynasty ?? null,
    });
  }

  return results;
}
