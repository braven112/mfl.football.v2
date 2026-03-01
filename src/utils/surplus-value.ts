/**
 * Surplus Value Calculator
 *
 * Converts projected fantasy points into dollar values and compares them
 * against likely salary costs to produce a surplus value per player.
 * Positive surplus = bargain, negative surplus = overpay.
 *
 * This is the foundational utility for the Dynasty Value Analysis system.
 * Consumed by Free Agent Targets, VORP Rankings, and Trade Value Analyzer.
 *
 * Pure functions only — no side effects, all data passed as arguments.
 */

import { parseNumber } from './formatters';
import type { SurplusValueInput, SurplusValueResult } from '../types/surplus-value';

/** Minimum salary in the league ($425K) */
const LEAGUE_MINIMUM = 425_000;

/**
 * Calculate league-wide points-per-dollar ratio from rostered players.
 *
 * This establishes the baseline conversion rate between projected points
 * and dollar value. Uses all rostered players with both projections and
 * salary > 0.
 */
export function calculatePointsPerDollar(
  projectedScores: Map<string, number>,
  rosteredPlayers: Map<string, { salary: number; position: string }>
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
 * Convert projected fantasy points into a dollar value.
 *
 * Uses the league-wide points-per-dollar ratio as the conversion rate.
 */
export function pointsToDollarValue(
  projectedPoints: number,
  pointsPerDollar: number
): number {
  if (pointsPerDollar <= 0) return 0;
  return Math.round(projectedPoints / pointsPerDollar);
}

/**
 * Estimate what a player will likely cost at auction.
 *
 * Combines multiple signals (custom rank, ADP, positional salary benchmarks)
 * to produce a cost estimate. Uses an exponential-decay rank-to-multiplier
 * curve applied to the average price per free agent.
 */
export function estimateAuctionCost(
  player: { id: string; position: string; age: number | null },
  signals: {
    customRank?: number;
    adpDynasty?: number;
    positionSalaryAvg: {
      top3Average: number;
      top5Average: number;
    };
    totalAvailableCap: number;
    totalFreeAgents: number;
  }
): number {
  const avgPricePerPlayer =
    signals.totalFreeAgents > 0
      ? signals.totalAvailableCap / signals.totalFreeAgents
      : 1_000_000;

  // Use custom rank as primary signal, ADP as fallback
  const rank = signals.customRank ?? signals.adpDynasty ?? 999;

  // Rank-to-multiplier curve (exponential decay)
  // Top 10: 4-10x average, Top 30: 2-4x, Top 100: 1-2x, 100+: 0.5-1x
  let multiplier: number;
  if (rank <= 10) {
    multiplier = 10 - (rank - 1) * 0.6; // 10x → 4.6x
  } else if (rank <= 30) {
    multiplier = 4.6 - ((rank - 10) / 20) * 2.6; // 4.6x → 2.0x
  } else if (rank <= 100) {
    multiplier = 2.0 - ((rank - 30) / 70) * 1.0; // 2.0x → 1.0x
  } else {
    multiplier = Math.max(0.5, 1.0 - ((rank - 100) / 200) * 0.5); // 1.0x → 0.5x
  }

  let estimated = avgPricePerPlayer * multiplier;

  // Clamp: minimum is league minimum ($425K), max is position top3Average * 1.2
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
  estimatedAuctionCost: number
): number {
  return projectedDollarValue - estimatedAuctionCost;
}

/**
 * Main orchestrator: calculate surplus values for all players.
 *
 * Accepts raw MFL data structures (strings for numbers, nested arrays)
 * and returns a flat array of SurplusValueResult sorted by surplus value desc.
 */
export function calculateAllSurplusValues(
  input: SurplusValueInput
): SurplusValueResult[] {
  const { projectedScores, players, rosters, salaryAverages, customRankings, adpDynasty } = input;

  // 1. Build projected scores map
  const projMap = new Map<string, number>();
  for (const s of projectedScores) {
    const score = parseNumber(s.score);
    if (score > 0) projMap.set(s.id, score);
  }

  // 2. Build rostered players map
  const rosteredMap = new Map<
    string,
    { salary: number; contractYears: number; status: string; franchiseId: string }
  >();
  for (const franchise of rosters) {
    const fPlayers = Array.isArray(franchise.player) ? franchise.player : [];
    for (const p of fPlayers) {
      if (!p?.id) continue;
      rosteredMap.set(p.id, {
        salary: parseNumber(p.salary),
        contractYears: parseNumber(p.contractYear),
        status: p.status || 'ROSTER',
        franchiseId: franchise.id,
      });
    }
  }

  // 3. Build a simpler map for points-per-dollar calculation
  const rosterForPPD = new Map<string, { salary: number; position: string }>();
  const playerPosMap = new Map<string, string>();
  for (const p of players) {
    if (p?.id && p?.position) {
      const pos = p.position === 'Def' ? 'DEF' : p.position;
      playerPosMap.set(p.id, pos);
    }
  }
  for (const [id, roster] of rosteredMap) {
    rosterForPPD.set(id, {
      salary: roster.salary,
      position: playerPosMap.get(id) || 'QB',
    });
  }

  // 4. Calculate league-wide points-per-dollar
  const ppd = calculatePointsPerDollar(projMap, rosterForPPD);

  // 5. Calculate available cap and free agent count for cost estimation
  //    Use total projected FA cap as a proxy: sum all rostered salaries,
  //    subtract from total league cap, divide by FA count.
  const totalFreeAgents = players.filter(
    (p) => !rosteredMap.has(p.id) && projMap.has(p.id)
  ).length;

  // Estimate total available cap: this is a heuristic.
  // Use average auction spend from salary averages across positions.
  let totalRosteredSalary = 0;
  for (const [, roster] of rosteredMap) {
    totalRosteredSalary += roster.salary;
  }
  // Assume ~16 teams × $45M cap, minus what's already committed
  const TEAM_COUNT = rosters.length || 16;
  const SALARY_CAP = 45_000_000;
  const totalAvailableCap = Math.max(0, TEAM_COUNT * SALARY_CAP - totalRosteredSalary);

  // 6. Build results for each player
  const now = Date.now() / 1000;
  const results: SurplusValueResult[] = [];

  for (const p of players) {
    if (!p?.id || !p?.position) continue;

    const pos = p.position === 'Def' ? 'DEF' : p.position;
    const projected = projMap.get(p.id) ?? 0;
    const rosterInfo = rosteredMap.get(p.id);
    const isRostered = !!rosterInfo;

    // Calculate age from birthdate (Unix timestamp)
    let age: number | null = null;
    if (p.birthdate) {
      const birthTimestamp = parseInt(p.birthdate, 10);
      if (birthTimestamp > 0) {
        age = Math.floor((now - birthTimestamp) / (365.25 * 24 * 60 * 60));
      }
    }

    // Format name: "Last, First" → "First Last"
    const nameParts = p.name.split(', ');
    const displayName =
      nameParts.length === 2 ? `${nameParts[1]} ${nameParts[0]}` : p.name;

    // Dollar value from projections
    const dollarValue = pointsToDollarValue(projected, ppd);

    // Position salary averages (fallback to reasonable defaults)
    const posAvg = salaryAverages?.positions?.[pos] ?? {
      top3Average: 5_000_000,
      top5Average: 4_000_000,
    };

    // Rank signal
    const customRank = customRankings?.get(p.id);
    const adpRank = adpDynasty?.get(p.id);
    const rank = customRank ?? adpRank ?? null;

    // Estimated auction cost
    const estCost = estimateAuctionCost(
      { id: p.id, position: pos, age },
      {
        customRank,
        adpDynasty: adpRank,
        positionSalaryAvg: posAvg,
        totalAvailableCap,
        totalFreeAgents,
      }
    );

    // Surplus
    const surplus = calculateSurplusValue(dollarValue, estCost);
    const surplusPercent = estCost > 0 ? surplus / estCost : 0;

    results.push({
      playerId: p.id,
      name: displayName,
      position: pos,
      nflTeam: p.team || '',
      age,
      projectedPoints: projected,
      dollarValue,
      estimatedCost: estCost,
      surplusValue: surplus,
      surplusPercent,
      isRostered,
      currentSalary: rosterInfo?.salary ?? null,
      contractYears: rosterInfo?.contractYears ?? null,
      rank,
    });
  }

  return results;
}
