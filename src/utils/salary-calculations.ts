/**
 * Salary cap calculation utilities for fantasy football roster management
 */

import { parseNumber } from './formatters';

/**
 * Fantasy football salary cap constants
 */
export const SALARY_CAP = 45_000_000;
export const ROSTER_LIMIT = 28;
export const TARGET_ACTIVE_COUNT = 22;
export const RESERVE_FOR_ROOKIES = 5_000_000;

/**
 * Salary years for multi-year contract projections
 */
export const SALARY_YEARS = [2025, 2026, 2027, 2028, 2029];

/**
 * Cap inclusion percentages by player status
 * - current: Percentage that counts toward current season cap
 * - future: Percentage that counts toward future season caps
 */
export const CAP_INCLUSION = {
  ACTIVE: { current: 1, future: 1 },
  PRACTICE: { current: 0.5, future: 1 },
  INJURED: { current: 1, future: 1 },
} as const;

/**
 * Normalize player status to standard categories
 * @param status - Raw status from MFL API
 * @returns Normalized status: 'ACTIVE', 'PRACTICE', or 'INJURED'
 */
export const normalizeStatus = (status = 'ROSTER'): 'ACTIVE' | 'PRACTICE' | 'INJURED' => {
  const normalized = status.toUpperCase();
  if (normalized.includes('TAXI')) return 'PRACTICE';
  if (normalized.includes('INJURED') || normalized === 'IR') return 'INJURED';
  return 'ACTIVE';
};

/**
 * Get cap inclusion percentage for a player status
 * @param tag - Player status tag (ACTIVE, PRACTICE, INJURED)
 * @param isCurrent - Whether calculating for current season (vs future)
 * @returns Cap inclusion percentage (0.5 = 50%, 1 = 100%)
 */
export const getCapPercent = (tag = 'ACTIVE', isCurrent = true): number => {
  const normalized = tag.toUpperCase() as keyof typeof CAP_INCLUSION;
  const map = CAP_INCLUSION[normalized] ?? { current: 1, future: 1 };
  return isCurrent ? map.current ?? 1 : map.future ?? 1;
};

/**
 * Player interface for cap calculations
 */
export interface CapPlayer {
  salary?: number | string;
  contractYears?: number | string;
  displayTag?: string;
}

/**
 * Calculate cap charges for each salary year
 * Applies 10% annual salary escalation for multi-year contracts
 * @param rows - List of players on roster
 * @returns Array of cap charges, one per year in SALARY_YEARS
 */
export const calculateCapCharges = (rows: CapPlayer[] = []): number[] =>
  SALARY_YEARS.map((_, index) =>
    rows.reduce((sum, player) => {
      const contractYears = parseNumber(player.contractYears ?? 0);
      if (contractYears > index) {
        const isCurrent = index === 0;
        const percent = getCapPercent(player.displayTag ?? 'ACTIVE', isCurrent);
        const baseSalary = parseNumber(player.salary);
        // Apply 10% annual salary escalation for multi-year contracts
        const salaryForYear = baseSalary * Math.pow(1.10, index);
        return sum + (salaryForYear * percent || 0);
      }
      return sum;
    }, 0)
  );

/**
 * Waiver penalty percentages by contract years remaining
 * - Current year: 50% of salary
 * - Future year: Percentage based on years remaining
 */
export const FUTURE_PERCENT_BY_YEARS: Record<number, number> = {
  1: 0,
  2: 0.15,
  3: 0.25,
  4: 0.35,
  5: 0.45,
};

/**
 * Dead money adjustment interface
 */
export interface DeadMoneyAdjustment {
  franchiseId?: string;
  salary?: number | string;
  amount?: number | string;
  yearOffset?: number | string;
  seasonOffset?: number | string;
  yearsRemaining?: number;
}

/**
 * Aggregate dead money charges across salary years
 * @param adjustments - List of dead money adjustments
 * @param franchiseId - Filter to specific franchise (optional)
 * @returns Array of dead money amounts, one per year in SALARY_YEARS
 */
export const aggregateDeadMoney = (
  adjustments: DeadMoneyAdjustment[] = [],
  franchiseId?: string
): number[] => {
  return adjustments.reduce((acc, adj) => {
    if (franchiseId && adj.franchiseId !== franchiseId) return acc;

    const baseOffset = parseNumber(adj.yearOffset ?? adj.seasonOffset ?? 0);
    const salary = parseNumber(adj.salary) || parseNumber(adj.amount);
    const yearsRemaining = adj.yearsRemaining;
    const hasYearsRemaining = Number.isFinite(yearsRemaining);

    // Waiver penalty: current 50%, future percentage based on years
    const currentPenalty = hasYearsRemaining ? 0.5 * salary : salary; // carryover hits 100% current year
    const futurePenalty =
      hasYearsRemaining && yearsRemaining !== undefined && FUTURE_PERCENT_BY_YEARS[yearsRemaining] !== undefined
        ? FUTURE_PERCENT_BY_YEARS[yearsRemaining] * salary
        : 0;

    if (acc[baseOffset] === undefined) acc[baseOffset] = 0;
    acc[baseOffset] += currentPenalty;

    if (futurePenalty > 0) {
      if (acc[baseOffset + 1] === undefined) acc[baseOffset + 1] = 0;
      acc[baseOffset + 1] += futurePenalty;
    }

    return acc;
  }, Array(SALARY_YEARS.length).fill(0));
};

/**
 * Calculate contract years metadata for a roster
 * @param rows - List of players on roster
 * @returns Total contract years and longest contract
 */
export const calculateContractYearsMeta = (rows: CapPlayer[] = []): {
  contractYearsTotal: number;
  longestContract: number;
} => {
  const contractYearsTotal = rows.reduce(
    (sum, player) => sum + Math.max(parseNumber(player.contractYears ?? 0), 0),
    0
  );
  const longestContract = rows.reduce(
    (max, player) => Math.max(max, parseNumber(player.contractYears ?? 0)),
    0
  );
  return { contractYearsTotal, longestContract };
};

/**
 * Calculate available cap space
 * @param capCharges - Total cap charges for the season
 * @param deadMoney - Dead money charges for the season (default: 0)
 * @param capLimit - Salary cap limit (default: SALARY_CAP)
 * @returns Available cap space
 */
export const calculateCapSpace = (
  capCharges: number,
  deadMoney = 0,
  capLimit = SALARY_CAP
): number => {
  return capLimit - capCharges - deadMoney;
};

/**
 * Calculate effective cap space (cap space minus reserve for rookies)
 * @param capSpace - Available cap space
 * @param reserve - Reserve amount for rookies (default: RESERVE_FOR_ROOKIES)
 * @returns Effective cap space available for veteran acquisitions
 */
export const calculateEffectiveCapSpace = (
  capSpace: number,
  reserve = RESERVE_FOR_ROOKIES
): number => {
  return capSpace - reserve;
};
