/**
 * Surplus Value Calculator
 *
 * Converts projected fantasy points into dollar values and compares against
 * estimated auction costs to produce surplus value per player.
 * Positive surplus = bargain, negative surplus = overpay.
 */

import { parseNumber } from './formatters';
import type {
  PositionSalaryBenchmark,
  SurplusValueInput,
  SurplusValueResult,
} from '../types/surplus-value';
import historicalSalaryCurves from '../data/theleague/historical-salary-curves.json';

const LEAGUE_MINIMUM = 425_000;

type CurveTier = {
  basePrice: number;
  decayRate: number;
  dataPoints?: number;
};

type PositionCurveSet = {
  avg?: CurveTier;
  max?: CurveTier;
  min?: CurveTier;
};

type RankedSalaryEntry = {
  position: string;
  globalRank: number;
  positionRank: number;
  salary: number;
};

const CURVES_BY_POSITION = historicalSalaryCurves as Record<string, PositionCurveSet>;

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
 * Market pressure multiplier from global rank (1 = best).
 */
function getRankMultiplier(rank: number): number {
  let multiplier = 0.5;
  if (rank <= 10) {
    multiplier = 4.8 - (rank - 1) * 0.22; // 4.8x -> 2.82x
  } else if (rank <= 30) {
    multiplier = 2.82 - ((rank - 10) / 20) * 1.22; // 2.82x -> 1.6x
  } else if (rank <= 100) {
    multiplier = 1.6 - ((rank - 30) / 70) * 0.65; // 1.6x -> 0.95x
  } else {
    multiplier = Math.max(0.5, 0.95 - ((rank - 100) / 200) * 0.45); // 0.95x -> 0.5x
  }
  return Math.max(0.5, multiplier);
}

function evaluateCurve(tier: CurveTier | undefined, rank: number): number {
  if (!tier || !Number.isFinite(tier.basePrice) || tier.basePrice <= 0) return 0;
  const safeRank = Math.max(1, rank);
  const decay = Number.isFinite(tier.decayRate) ? tier.decayRate : 0;
  return tier.basePrice * Math.exp(decay * (safeRank - 1));
}

function estimateHistoricalCurveCost(
  position: string,
  positionRank: number,
  positionSalaryAvg: PositionSalaryBenchmark,
): number {
  const pos = normalizePosition(position);
  const curves = CURVES_BY_POSITION[pos] ?? CURVES_BY_POSITION.DEF ?? {};

  const avgCurveRaw = evaluateCurve(curves.avg, positionRank);
  const maxCurveRaw = evaluateCurve(curves.max, positionRank);
  const minCurveRaw = evaluateCurve(curves.min, positionRank);

  const fallbackBase =
    positionSalaryAvg.top5Average > 0
      ? positionSalaryAvg.top5Average
      : positionSalaryAvg.top3Average > 0
        ? positionSalaryAvg.top3Average * 0.9
        : 1_000_000;

  const avgCurve = avgCurveRaw > 0 ? avgCurveRaw : fallbackBase;
  const maxCurve = maxCurveRaw > 0 ? maxCurveRaw : Math.max(avgCurve, fallbackBase);
  const minCurve = minCurveRaw > 0 ? minCurveRaw : Math.max(LEAGUE_MINIMUM, avgCurve * 0.55);

  let estimated: number;
  if (positionRank <= 3) {
    estimated = maxCurve * 0.62 + avgCurve * 0.38;
  } else if (positionRank <= 5) {
    estimated = maxCurve * 0.45 + avgCurve * 0.55;
  } else if (positionRank <= 12) {
    estimated = maxCurve * 0.2 + avgCurve * 0.75 + minCurve * 0.05;
  } else if (positionRank <= 24) {
    estimated = maxCurve * 0.1 + avgCurve * 0.75 + minCurve * 0.15;
  } else {
    estimated = avgCurve * 0.62 + minCurve * 0.38;
  }

  // Anchor top tiers to franchise/extension benchmark ranges.
  if (positionRank <= 3 && positionSalaryAvg.top3Average > 0) {
    estimated = estimated * 0.25 + positionSalaryAvg.top3Average * 0.75;
  } else if (positionRank <= 5 && positionSalaryAvg.top5Average > 0) {
    estimated = estimated * 0.35 + positionSalaryAvg.top5Average * 0.65;
  }

  return Math.max(LEAGUE_MINIMUM, estimated);
}

function getTopTierFloor(
  positionRank: number,
  positionSalaryAvg: PositionSalaryBenchmark,
): number {
  if (positionRank <= 3 && positionSalaryAvg.top3Average > 0) {
    return roundToNearest50k(positionSalaryAvg.top3Average * 1.0);
  }
  if (positionRank <= 5 && positionSalaryAvg.top5Average > 0) {
    return roundToNearest50k(positionSalaryAvg.top5Average * 0.95);
  }
  return 0;
}

function getMedianBenchmark(positionSalaryAvg: PositionSalaryBenchmark): number | null {
  const candidates = [
    positionSalaryAvg.medianSalary,
    positionSalaryAvg.starterMedian,
    positionSalaryAvg.averageSalary,
  ];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate) && (candidate as number) > 0) {
      return candidate as number;
    }
  }
  return null;
}

function getMedianCloseness(
  positionRank: number,
  positionPlayerCount: number | undefined,
): number {
  if (!Number.isFinite(positionPlayerCount) || (positionPlayerCount as number) < 8) return 0;

  const totalPlayers = positionPlayerCount as number;
  const medianRank = (totalPlayers + 1) / 2;
  const window = Math.max(8, Math.round(totalPlayers * 0.24));
  const distance = Math.abs(positionRank - medianRank);
  if (distance > window) return 0;
  return Math.max(0, 1 - distance / window);
}

function applyMedianBenchmarkAnchor(
  baseCost: number,
  positionRank: number,
  positionPlayerCount: number | undefined,
  positionSalaryAvg: PositionSalaryBenchmark,
): number {
  if (positionRank <= 5) return baseCost;

  const medianBenchmark = getMedianBenchmark(positionSalaryAvg);
  if (!medianBenchmark || medianBenchmark <= 0) return baseCost;

  const closeness = getMedianCloseness(positionRank, positionPlayerCount);
  if (closeness <= 0) return baseCost;

  // Pull mid-tier players toward the observed median salary band.
  const weight = 0.2 + closeness * 0.65; // 0.20 -> 0.85
  let anchored = baseCost * (1 - weight) + medianBenchmark * weight;

  const upperBand = medianBenchmark * (1.25 + (1 - closeness) * 0.6);
  const lowerBand = Math.max(
    LEAGUE_MINIMUM,
    medianBenchmark * (0.65 + (1 - closeness) * 0.1),
  );
  anchored = Math.min(upperBand, Math.max(lowerBand, anchored));

  return Math.max(LEAGUE_MINIMUM, anchored);
}

/**
 * Estimate likely auction cost from blended historical curves + market context.
 */
export function estimateAuctionCost(
  player: { id: string; position: string },
  signals: {
    customRank?: number;
    adpDynasty?: number;
    positionRank?: number;
    positionPlayerCount?: number;
    positionSalaryAvg: PositionSalaryBenchmark;
    totalAvailableCap: number;
    totalFreeAgents: number;
  },
): number {
  const avgPricePerPlayer =
    signals.totalFreeAgents > 0
      ? signals.totalAvailableCap / signals.totalFreeAgents
      : 1_000_000;

  const globalRank = Math.max(1, signals.customRank ?? signals.adpDynasty ?? 999);
  const positionRank = Math.max(1, signals.positionRank ?? globalRank);

  const marketCost = avgPricePerPlayer * getRankMultiplier(globalRank);
  const historicalCost = estimateHistoricalCurveCost(
    player.position,
    positionRank,
    signals.positionSalaryAvg,
  );

  let estimated: number;
  if (positionRank <= 5) {
    estimated = historicalCost * 0.9 + marketCost * 0.1;
  } else if (positionRank <= 24) {
    estimated = historicalCost * 0.7 + marketCost * 0.3;
  } else {
    estimated = historicalCost * 0.55 + marketCost * 0.45;
  }

  const topTierFloor = getTopTierFloor(positionRank, signals.positionSalaryAvg);
  if (topTierFloor > 0) {
    estimated = Math.max(estimated, topTierFloor);
  }

  estimated = applyMedianBenchmarkAnchor(
    estimated,
    positionRank,
    signals.positionPlayerCount,
    signals.positionSalaryAvg,
  );

  const top3Average = signals.positionSalaryAvg.top3Average;
  if (top3Average > 0) {
    const ceiling =
      positionRank <= 1
        ? top3Average * 1.45
        : positionRank <= 3
          ? top3Average * 1.28
          : positionRank <= 5
            ? Math.max(top3Average * 1.16, signals.positionSalaryAvg.top5Average * 1.28)
            : top3Average * 1.08;
    estimated = Math.min(estimated, ceiling);
  }

  return Math.max(LEAGUE_MINIMUM, roundToNearest50k(estimated));
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

function roundToNearest50k(value: number): number {
  return Math.round(value / 50_000) * 50_000;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function isRookieDeal(
  rostered: { salary: number; contractYears: number } | undefined,
  draftYear: number | undefined,
  leagueYear: number | undefined,
): boolean {
  if (!rostered || rostered.salary <= 0) return false;
  if (rostered.salary > 2_000_000) return false;

  if (
    Number.isFinite(leagueYear) &&
    Number.isFinite(draftYear) &&
    leagueYear! >= draftYear! &&
    leagueYear! - draftYear! <= 3
  ) {
    return true;
  }

  // Fallback heuristic when draft year is missing.
  return rostered.contractYears > 0 && rostered.contractYears <= 4;
}

function collectComparableSamples(
  entries: RankedSalaryEntry[],
  targetRank: number,
  rankKey: 'positionRank' | 'globalRank',
  minimumSampleSize: number,
): number[] {
  const windows = rankKey === 'positionRank'
    ? [2, 3, 5, 8, 12, 18, 24, 9999]
    : [8, 12, 20, 30, 50, 80, 9999];

  for (const window of windows) {
    const samples = entries
      .filter((entry) => Math.abs(entry[rankKey] - targetRank) <= window)
      .map((entry) => entry.salary)
      .filter((salary) => salary > 0);

    if (samples.length >= minimumSampleSize || window === 9999) {
      return samples;
    }
  }

  return [];
}

function estimateComparableRankCost(
  player: { position: string; globalRank: number | null; positionRank: number | null },
  rankedSalaries: RankedSalaryEntry[],
  fallbackCost: number,
): number {
  if (rankedSalaries.length === 0) return fallbackCost;

  let samples: number[] = [];
  const samePosition = rankedSalaries.filter((entry) => entry.position === player.position);

  if (player.positionRank != null && samePosition.length > 0) {
    samples = collectComparableSamples(samePosition, player.positionRank, 'positionRank', 4);
  }

  if (samples.length < 4 && player.globalRank != null) {
    samples = collectComparableSamples(rankedSalaries, player.globalRank, 'globalRank', 6);
  }

  if (samples.length === 0) return fallbackCost;

  const peerMedian = median(samples);
  const blended = peerMedian * 0.72 + fallbackCost * 0.28;
  return Math.max(LEAGUE_MINIMUM, roundToNearest50k(blended));
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
    { name: string; position: string; team: string; birthdate?: string; draftYear?: number }
  >();
  for (const p of input.players) {
    playerMeta.set(p.id, {
      name: p.name,
      position: normalizePosition(p.position),
      team: p.team,
      birthdate: p.birthdate,
      draftYear: p.draftYear,
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

  // Derive a rank fallback from projected points so players without ADP/custom
  // still get differentiated market estimates.
  const projectedRank = new Map<string, number>();
  const projectedSorted = [...projectedScores.entries()]
    .sort((a, b) => b[1] - a[1]);
  projectedSorted.forEach(([id], index) => {
    projectedRank.set(id, index + 1);
  });

  const marketRank = new Map<string, number>();
  for (const [id] of projectedScores) {
    const signal =
      input.customRankings?.get(id) ??
      input.adpDynasty?.get(id) ??
      projectedRank.get(id);
    if (Number.isFinite(signal)) {
      marketRank.set(id, signal as number);
    }
  }

  // Position rank (WR#1, WR#2...) for benchmark/curve pricing tiers.
  const positionRank = new Map<string, number>();
  const byPosition = new Map<string, Array<{ id: string; rankSignal: number; projectedPoints: number }>>();
  for (const [id, points] of projectedScores) {
    const meta = playerMeta.get(id);
    const rankSignal = marketRank.get(id);
    if (!meta || !Number.isFinite(rankSignal)) continue;
    const pos = meta.position;
    const bucket = byPosition.get(pos) ?? [];
    bucket.push({ id, rankSignal: rankSignal as number, projectedPoints: points });
    byPosition.set(pos, bucket);
  }

  for (const playersAtPosition of byPosition.values()) {
    playersAtPosition.sort((a, b) => {
      if (a.rankSignal !== b.rankSignal) return a.rankSignal - b.rankSignal;
      return b.projectedPoints - a.projectedPoints;
    });
    playersAtPosition.forEach((entry, index) => {
      positionRank.set(entry.id, index + 1);
    });
  }

  const positionPlayerCount = new Map<string, number>();
  for (const [position, playersAtPosition] of byPosition.entries()) {
    positionPlayerCount.set(position, playersAtPosition.length);
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

  // Build a market dataset from rostered non-rookie salaries keyed by rank.
  const rankedSalaries: RankedSalaryEntry[] = [];
  for (const [id, rostered] of rosteredPlayers) {
    if (rostered.salary <= 0) continue;
    const globalRank = marketRank.get(id);
    const posRank = positionRank.get(id);
    if (!Number.isFinite(globalRank) || !Number.isFinite(posRank)) continue;
    const meta = playerMeta.get(id);
    if (isRookieDeal(rostered, meta?.draftYear, input.leagueYear)) continue;
    rankedSalaries.push({
      position: meta?.position ?? rostered.position,
      globalRank: globalRank as number,
      positionRank: posRank as number,
      salary: rostered.salary,
    });
  }

  // Build results for all players with projections
  const results: SurplusValueResult[] = [];

  for (const [playerId, pts] of projectedScores) {
    const meta = playerMeta.get(playerId);
    if (!meta) continue;

    const dollarValue = pointsToDollarValue(pts, pointsPerDollar);
    const customRank = input.customRankings?.get(playerId);
    const adpDynasty = input.adpDynasty?.get(playerId);
    const rank = customRank ?? adpDynasty ?? projectedRank.get(playerId) ?? null;
    const posRank = positionRank.get(playerId) ?? null;

    const posAvg = input.salaryAverages.positions[meta.position] ?? {
      top3Average: 0,
      top5Average: 0,
    };
    const posPlayerCount = positionPlayerCount.get(meta.position);

    const modeledCost = estimateAuctionCost(
      { id: playerId, position: meta.position },
      {
        customRank: rank ?? undefined,
        adpDynasty,
        positionRank: posRank ?? undefined,
        positionPlayerCount: posPlayerCount,
        positionSalaryAvg: posAvg,
        totalAvailableCap,
        totalFreeAgents,
      },
    );

    const rostered = rosteredPlayers.get(playerId);
    const rookieDeal = isRookieDeal(rostered, meta.draftYear, input.leagueYear);
    const marketComparableCost = estimateComparableRankCost(
      {
        position: meta.position,
        globalRank: rank,
        positionRank: posRank,
      },
      rankedSalaries,
      modeledCost,
    );
    const topTierFloor = posRank != null ? getTopTierFloor(posRank, posAvg) : 0;
    const anchoredComparableCost = posRank != null
      ? applyMedianBenchmarkAnchor(
        Math.max(marketComparableCost, topTierFloor),
        posRank,
        posPlayerCount,
        posAvg,
      )
      : marketComparableCost;
    // Show actual salary only for players on rookie deals.
    const estCost = rookieDeal && rostered && rostered.salary > 0
      ? rostered.salary
      : roundToNearest50k(Math.max(anchoredComparableCost, topTierFloor));

    const surplus = calculateSurplusValue(dollarValue, estCost);
    const surplusPercent = estCost > 0 ? surplus / estCost : 0;

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
      rank,
    });
  }

  return results;
}
