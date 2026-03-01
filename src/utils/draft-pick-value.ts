/**
 * Draft Pick Valuation
 *
 * Assigns dollar surplus values to draft picks using TheLeague's
 * position-specific slotted salary schedule (ROOKIE_SALARIES_2026).
 *
 * Since we don't know what position a team will draft, we use a weighted
 * average across skill positions reflecting typical dynasty draft patterns.
 * PK and DEF are excluded — nobody trades up to draft a kicker.
 *
 * Production value is estimated using a multiplier curve: top picks
 * produce significantly more value relative to cost than late picks.
 */

import { ROOKIE_SALARIES_2026 } from './draft-pick-cap-impact';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Weights reflecting typical dynasty rookie draft position distribution */
const POSITION_WEIGHTS: Record<string, number> = {
  WR: 0.40,
  RB: 0.30,
  QB: 0.15,
  TE: 0.15,
};

const SKILL_POSITIONS = Object.keys(POSITION_WEIGHTS);

/** Standard rookie contract length in TheLeague */
const ROOKIE_CONTRACT_YEARS = 3;

/** Number of teams in the league */
const TEAMS_IN_LEAGUE = 16;

/**
 * Production multiplier by overall pick position.
 *
 * Represents the ratio of a drafted player's expected production value
 * to their slotted salary. Early picks are bargains (high multiplier)
 * because elite rookies produce like expensive veterans but cost a
 * fraction of the price. Late picks approach breakeven.
 *
 * Calibrated against TheLeague's $45M cap and 10% escalation.
 */
function getProductionMultiplier(overallPick: number): number {
  if (overallPick <= 3) return 2.5;
  if (overallPick <= 6) return 2.3;
  if (overallPick <= 10) return 2.0;
  if (overallPick <= 14) return 1.8;
  if (overallPick <= 17) return 1.6;  // End of round 1 + toilet bowl
  if (overallPick <= 22) return 1.4;
  if (overallPick <= 28) return 1.25;
  if (overallPick <= 35) return 1.15;
  return 1.0;                          // Round 3+ (breakeven)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftPickValue {
  round: number;
  pickInRound: number;
  overallPick: number;
  /** Weighted average salary across skill positions */
  expectedSalary: number;
  /** Estimated production value (salary × multiplier) */
  expectedProductionValue: number;
  /** Annual surplus: productionValue - salary */
  surplusValue: number;
  contractYears: number;
  /** Total surplus over the rookie contract */
  totalSurplusOverContract: number;
  /** Salary range across positions: { min, max } */
  salaryRange: { min: number; max: number };
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Get the weighted-average salary for a specific pick slot using
 * the real slotted salary schedule.
 */
export function getWeightedSalary(round: number, pickNumber: number): {
  weightedAvg: number;
  min: number;
  max: number;
} {
  const roundData = ROOKIE_SALARIES_2026[round];
  const slotData = roundData?.[pickNumber];

  if (!slotData) {
    // Round 3+ or unknown slot: use flat-rate minimum
    const fallback = 450_000;
    return { weightedAvg: fallback, min: 425_000, max: 475_000 };
  }

  let weightedSum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const pos of SKILL_POSITIONS) {
    const salary = slotData[pos] ?? 425_000;
    weightedSum += salary * POSITION_WEIGHTS[pos];
    if (salary < min) min = salary;
    if (salary > max) max = salary;
  }

  return {
    weightedAvg: Math.round(weightedSum / 50_000) * 50_000, // Round to nearest $50K
    min,
    max,
  };
}

/**
 * Convert a pick-in-round number (1-based within the round) to an
 * overall pick number used in the slotted salary table.
 *
 * Round 1 picks: 1–17 (includes toilet bowl pick 17)
 * Round 2 picks: 18–35 (includes toilet bowl picks 34, 35)
 */
export function toOverallPick(round: number, pickInRound: number): number {
  if (round === 1) return pickInRound;
  if (round === 2) return 17 + pickInRound;
  // Round 3+
  return 35 + pickInRound;
}

/**
 * Calculate the value of a specific draft pick using the real
 * slotted salary schedule.
 */
export function calculatePickValue(
  round: number,
  pickInRound: number,
): DraftPickValue {
  const overallPick = toOverallPick(round, pickInRound);

  // For the salary lookup, we use the overall pick number for rounds 1-2
  // (since ROOKIE_SALARIES_2026 is keyed by overall pick)
  const salaryLookupPick = round === 1 ? pickInRound : overallPick;
  const { weightedAvg, min, max } = getWeightedSalary(round, salaryLookupPick);

  const multiplier = getProductionMultiplier(overallPick);
  const expectedProductionValue = Math.round((weightedAvg * multiplier) / 50_000) * 50_000;
  const surplusValue = expectedProductionValue - weightedAvg;

  return {
    round,
    pickInRound,
    overallPick,
    expectedSalary: weightedAvg,
    expectedProductionValue,
    surplusValue,
    contractYears: ROOKIE_CONTRACT_YEARS,
    totalSurplusOverContract: surplusValue * ROOKIE_CONTRACT_YEARS,
    salaryRange: { min, max },
  };
}

/**
 * Estimate the value of a future draft pick where we don't know
 * the exact pick position. Uses the middle pick in the round.
 */
export function estimateFuturePickValue(round: number): DraftPickValue {
  const midPick = Math.ceil(TEAMS_IN_LEAGUE / 2); // Pick 8
  return calculatePickValue(round, midPick);
}

/**
 * Build a value map for all available draft picks, keyed by
 * "year-round-franchiseId" to match DraftPickKey.
 *
 * Since future picks don't have known slot positions, uses
 * the round's middle pick as the estimate.
 */
export function buildPickValueMap(
  draftPicks: Array<{ year: string; round: string; originalPickFor: string }>,
): Record<string, DraftPickValue> {
  const map: Record<string, DraftPickValue> = {};

  for (const pick of draftPicks) {
    const key = `${pick.year}-${pick.round}-${pick.originalPickFor}`;
    if (map[key]) continue; // Already computed

    const round = parseInt(pick.round, 10);
    if (isNaN(round) || round < 1) continue;

    map[key] = estimateFuturePickValue(round);
  }

  return map;
}
