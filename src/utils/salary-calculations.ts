/**
 * Salary cap calculation utilities for fantasy football roster management
 */

import { parseNumber } from './formatters';
import { getCurrentLeagueYear } from './league-year';

/**
 * Fantasy football salary cap constants
 */
export const SALARY_CAP = 45_000_000;
export const ROSTER_LIMIT = 25;
export const TARGET_ACTIVE_COUNT = 22;
export const RESERVE_FOR_ROOKIES = 5_000_000;

/**
 * Salary years for multi-year contract projections.
 * Derived from getCurrentLeagueYear() so it auto-updates each year.
 */
export const SALARY_YEARS = (() => {
  const base = getCurrentLeagueYear();
  return [base, base + 1, base + 2, base + 3, base + 4];
})();

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
export type CapInclusionTable = Record<string, { current?: number; future?: number }>;

/**
 * Percentage of a salary that counts against the cap for a bucket.
 *
 * `isCurrent` is not cosmetic: practice-squad players count at a reduced rate
 * this year and in full in future years, so getting it wrong silently
 * understates next year's cap.
 *
 * The table is injectable only so a caller holding its own copy — the rosters
 * page reads `capInclusion` out of its serialized config — can pass it rather
 * than keeping a parallel implementation. It defaults to CAP_INCLUSION and
 * every existing caller is unaffected.
 */
export const getCapPercent = (
  tag = 'ACTIVE',
  isCurrent = true,
  capInclusion: CapInclusionTable = CAP_INCLUSION,
): number => {
  const normalized = String(tag).toUpperCase();
  const map = capInclusion[normalized] ?? { current: 1, future: 1 };
  return (isCurrent ? map.current : map.future) ?? 1;
};

/**
 * Collapse the many spellings of a roster status into the three buckets the
 * cap rules recognise. Substring matching on purpose — `status` arrives as
 * "IR", "Injured Reserve", "PRACTICE SQUAD" and more.
 *
 * Distinct from `normalizeStatus` above, which reads only `status`; this reads
 * `displayTag` first and falls back, which is what the roster table needs.
 */
export const normalizeBucket = (
  player: { displayTag?: string | null; status?: string | null },
): 'ACTIVE' | 'PRACTICE' | 'INJURED' => {
  const raw = String(player.displayTag ?? player.status ?? 'ACTIVE').toUpperCase();
  if (raw.includes('PRACTICE')) return 'PRACTICE';
  if (raw.includes('INJURED') || raw === 'IR') return 'INJURED';
  return 'ACTIVE';
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
 * Annual salary escalation applied to every multi-year contract.
 */
export const ANNUAL_ESCALATION = 1.1;

export interface ContractAction {
  type?: string;
  newSalary?: unknown;
  ufaYearIndex?: number;
  salaryBreakdown?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Declaration {
  years?: number | null;
  requestedYears?: number | null;
  [key: string]: unknown;
}

export interface CapChargeOptions {
  /** Override the module's SALARY_YEARS; only the LENGTH is read. */
  salaryYears?: readonly unknown[];
  capInclusion?: CapInclusionTable;
  /** Pending, unsaved actions keyed by player id (cuts, trades, extensions). */
  contractActions?: Record<string, ContractAction>;
  /** Optimistic local declarations, which win over the saved ones. */
  localDeclarations?: Record<string, Declaration>;
  declarationsByPlayer?: Record<string, Declaration>;
}

/**
 * Cap charge per contract year, accounting for unsaved roster moves.
 *
 * `calculateCapCharges` above is the plain read-only view. This is the same
 * math with the roster page's *pending* state layered on, in this order:
 *
 *  - cut/traded players contribute nothing (their dead money is added by the
 *    caller, not here);
 *  - a declaration's year count overrides the player's own contract length,
 *    and an optimistic local declaration overrides the saved one;
 *  - an extension's explicit per-year breakdown overrides the 10% escalation.
 *
 * Franchise tags and team options are added at their UFA year rather than
 * escalated, because they are one-year awards priced off positional averages.
 *
 * Called with no options this is equivalent to `calculateCapCharges(rows)`.
 */
export const calculateCapChargesWithActions = (
  rows: (CapPlayer & { id?: string | number; status?: string | null })[] = [],
  {
    salaryYears = SALARY_YEARS,
    capInclusion = CAP_INCLUSION,
    contractActions = {},
    localDeclarations = {},
    declarationsByPlayer = {},
  }: CapChargeOptions = {},
): number[] =>
  salaryYears.map((_, index) => {
    let total = rows.reduce((sum, player) => {
      const key = String(player.id ?? '');
      const action = contractActions[key];
      if (action && (action.type === 'cut' || action.type === 'trade')) return sum;

      const decl = localDeclarations[key] || declarationsByPlayer[key];
      const declYears = decl ? (decl.years ?? decl.requestedYears ?? null) : null;
      const effectiveContractYears =
        declYears != null ? declYears : parseNumber(player.contractYears ?? 0);

      if (effectiveContractYears <= index) return sum;

      const percent = getCapPercent(normalizeBucket(player), index === 0, capInclusion);
      let salaryForYear = parseNumber(player.salary) * ANNUAL_ESCALATION ** index;
      if (action && action.type === 'extension' && action.salaryBreakdown) {
        salaryForYear = Number(action.salaryBreakdown[`year${index}`] ?? salaryForYear);
      }
      return sum + (salaryForYear * percent || 0);
    }, 0);

    Object.values(contractActions).forEach((action) => {
      if (
        (action.type === 'franchise' || action.type === 'team-option')
        && action.ufaYearIndex === index
      ) {
        total += Number(action.newSalary ?? 0) || 0;
      }
    });

    return total;
  });

export interface BucketCaps {
  active: number;
  practice: number;
  injured: number;
  counts: { active: number; practice: number; injured: number };
}

/**
 * Current-year cap totals and headcounts per bucket.
 *
 * Reads `displayTag` only (not `status`) and always uses the current-year
 * percentage — it describes the roster as displayed right now.
 */
export const calculateBucketCaps = (
  rows: CapPlayer[] = [],
  capInclusion: CapInclusionTable = CAP_INCLUSION,
): BucketCaps =>
  rows.reduce<BucketCaps>(
    (acc, player) => {
      const tag = String(player.displayTag ?? 'active').toUpperCase();
      const percent = getCapPercent(tag, true, capInclusion);
      const salary = parseNumber(player.salary);
      if (tag === 'PRACTICE') {
        acc.practice += salary * percent;
        acc.counts.practice += 1;
      } else if (tag === 'INJURED') {
        acc.injured += salary * percent;
        acc.counts.injured += 1;
      } else {
        acc.active += salary * percent;
        acc.counts.active += 1;
      }
      return acc;
    },
    { active: 0, practice: 0, injured: 0, counts: { active: 0, practice: 0, injured: 0 } },
  );

/** Current-year cap spend per position. Expired contracts are excluded. */
export const calculatePositionCaps = (
  rows: (CapPlayer & { position?: string | null; status?: string | null })[] = [],
  capInclusion: CapInclusionTable = CAP_INCLUSION,
): Record<string, number> =>
  rows.reduce<Record<string, number>>((totals, player) => {
    if (parseNumber(player.contractYears ?? 0) <= 0) return totals;
    const percent = getCapPercent(normalizeBucket(player), true, capInclusion);
    const pos = String(player.position ?? 'UNK').toUpperCase();
    totals[pos] = (totals[pos] ?? 0) + parseNumber(player.salary) * percent;
    return totals;
  }, {});

/**
 * Dollars per fantasy point, per position — lower is better value.
 *
 * Scoreless players are skipped rather than counted as infinitely expensive,
 * which would make any position holding a benched player look terrible.
 */
export const calculateCapEfficiency = (
  rows: (CapPlayer & { position?: string | null; points?: unknown })[] = [],
): Record<string, number> => {
  const totals: Record<string, { totalCost: number; totalPoints: number }> = {};
  rows.forEach((player) => {
    if (parseNumber(player.contractYears ?? 0) <= 0) return;
    if (parseNumber(player.points ?? 0) <= 0) return;
    const pos = String(player.position ?? 'UNK').toUpperCase();
    if (!totals[pos]) totals[pos] = { totalCost: 0, totalPoints: 0 };
    totals[pos].totalCost += parseNumber(player.salary);
    totals[pos].totalPoints += parseNumber(player.points ?? 0);
  });

  const result: Record<string, number> = {};
  Object.entries(totals).forEach(([pos, data]) => {
    result[pos] = data.totalCost / data.totalPoints;
  });
  return result;
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

/**
 * Determine which year's salary averages to use for extension/franchise tag calculations.
 *
 * Week 14 frozen data is the most stable salary reference. After the league year rolls over
 * (Feb 14), the new year's data reflects post-rollover rosters with 10% escalation already
 * applied — using that would double-dip on escalation. Instead, we keep using the previous
 * season's frozen data until the current season reaches its own week 14 freeze.
 *
 * @param modules - Glob result of mfl-salary-averages-*.json files
 * @param getModuleData - Helper to unwrap Astro module default exports
 * @returns The year whose salary averages should be used
 */
export function getFrozenSalaryAveragesYear(
  modules: Record<string, unknown>,
  getModuleData: (mod: unknown) => any
): number {
  const leagueYear = getCurrentLeagueYear();
  const yearStr = String(leagueYear);

  for (const [path, mod] of Object.entries(modules)) {
    if (path.includes(yearStr)) {
      const data = getModuleData(mod);
      const meta = data?.metadata;
      if (meta && meta.week >= (meta.freezeWeek || 14)) {
        return leagueYear;
      }
    }
  }

  return leagueYear - 1;
}

/**
 * Get reference salary for franchise tag or extension calculations
 */
export function getReferenceSalary(
  position: string,
  type: 'franchise' | 'extension' | 'team-option',
  salaryAverages: any
): number {
  if (!salaryAverages?.positions?.[position]) return 0;

  const positionData = salaryAverages.positions[position];

  if (type === 'franchise') {
    // Franchise tag = average of top 3
    return positionData.top3Average || 0;
  } else if (type === 'team-option') {
    // Team option = average of top 10
    return positionData.top10Average || 0;
  } else {
    // Extension = average of top 5
    return positionData.top5Average || 0;
  }
}

/**
 * Calculate franchise tag salary for a player
 * 
 * Franchise tag salary = MAX of:
 * - Current salary × 1.20 (20% increase)
 * - Average of top 3 salaries at position
 */
export function calculateFranchiseTag(
  currentSalary: number,
  position: string,
  salaryAverages: any
): {
  newSalary: number;
  newYears: number;
  basis: '20% increase' | 'top 3 average';
} {
  const increasedSalary = currentSalary * 1.2;
  const avgSalary = getReferenceSalary(position, 'franchise', salaryAverages);
  const newSalary = Math.round(Math.max(increasedSalary, avgSalary));
  
  return {
    newSalary,
    newYears: 1,
    basis: newSalary === Math.round(increasedSalary) ? '20% increase' : 'top 3 average',
  };
}

/**
 * Calculate veteran extension salary
 * 
 * Formula: (top5 avg × extension years) / (existing years + extension years) + current salary
 * Then apply 10% annual escalation
 */
export function calculateVeteranExtension(
  contractYears: number,
  position: string,
  extensionYears: number,
  currentSalary: number,
  salaryAverages: any
): {
  newSalary: number;
  newYears: number;
  salaryBreakdown: Record<string, number>;
} {
  const existingYears = Number(contractYears) || 0;
  const extYears = Number(extensionYears) || 0;
  const avgSalary = getReferenceSalary(position, 'extension', salaryAverages);

  // Per rules: (top5 avg * extensionYears / (existing years + extensionYears)) + existing salary
  const denominator = existingYears + extYears;
  const proratedPortion = denominator > 0 ? (avgSalary * extYears) / denominator : 0;
  const baseSalary = Number(currentSalary) || 0;
  const newSalaryCurrent = Math.round(proratedPortion + baseSalary);

  const totalYears = existingYears + extYears;

  // Create salary breakdown for ALL years with 10% increases each year
  const salaryBreakdown: Record<string, number> = {};
  for (let i = 0; i < totalYears; i++) {
    salaryBreakdown[`year${i}`] = Math.round(newSalaryCurrent * Math.pow(1.1, i));
  }

  return {
    newSalary: newSalaryCurrent,
    newYears: totalYears,
    salaryBreakdown,
  };
}

/**
 * Calculate penalty for cutting a player
 * 
 * Current season: 50% of salary
 * Future seasons: 15-45% based on years remaining
 */
export function calculateCutPenalty(
  salary: number,
  contractYears: number
): {
  currentPenalty: number;
  futurePenalty: number;
  totalPenalty: number;
} {
  const currentSeasonPenalty = salary * 0.5;
  const futureSeasonPenalty = salary * (FUTURE_PERCENT_BY_YEARS[contractYears] ?? 0);

  return {
    currentPenalty: currentSeasonPenalty,
    futurePenalty: futureSeasonPenalty,
    totalPenalty: currentSeasonPenalty + futureSeasonPenalty,
  };
}
