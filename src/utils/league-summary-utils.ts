/**
 * League Summary Utilities
 *
 * Computes multi-year projections for all teams across cap, roster,
 * and contract metrics. Reuses salary-calculations.ts functions to
 * guarantee numbers match the roster page exactly.
 */

import {
  SALARY_YEARS,
  SALARY_CAP,
  RESERVE_FOR_ROOKIES,
  TARGET_ACTIVE_COUNT,
  calculateCapCharges,
  aggregateDeadMoney,
  normalizeStatus,
  type CapPlayer,
  type DeadMoneyAdjustment,
} from './salary-calculations';
import { parseNumber } from './formatters';
import {
  getDraftCapitalSummary,
  type FutureDraftPicksData,
} from './future-draft-picks-utils';

// ---------------------------------------------------------------------------
// League Summary shows 5 future years starting from the current league year.
// SALARY_YEARS = [2025, 2026, 2027, 2028, 2029] (indices 0-4).
// SUMMARY_YEARS = [2026, 2027, 2028, 2029, 2030] — shift forward by 1.
// For years 2026-2029 we reuse calculateCapCharges() indices 1-4.
// For year 2030 (index 5) no existing contracts can reach that far
// (max contract = 5 years, which expires at index 5) so cap charges = 0.
// ---------------------------------------------------------------------------
export const SUMMARY_YEARS = [
  ...SALARY_YEARS.slice(1),
  SALARY_YEARS[SALARY_YEARS.length - 1] + 1,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SalaryPlayer {
  id: string;
  name: string;
  position: string;
  salary: number;
  franchiseId: string;
  status: string;
  contractYear: string;
  points: number;
  birthdate: number;
}

export type ValueDirection = 'asc' | 'desc';
export type FormatType = 'currency' | 'compactCurrency' | 'number' | 'decimal' | 'percentage' | 'age';

export interface CategoryDefinition {
  id: string;
  name: string;
  description: string;
  milestone: 1 | 2;
  format: FormatType;
  direction: ValueDirection;
  subCategories?: { id: string; name: string }[];
}

export interface TeamSummary {
  franchiseId: string;
  teamName: string;
  teamIcon: string;
  division: string;
  /** categoryId → [value per SALARY_YEAR] */
  metrics: Record<string, number[]>;
  /** Per year, position → count of players still under contract */
  positionalDepth: Record<string, number>[];
  /** Per year, position → % of cap spent */
  positionalSpend: Record<string, number>[];
}

export interface TeamConfig {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  icon?: string;
  division?: string;
}

interface RawSalaryAdjustment {
  franchise_id?: string;
  franchiseId?: string;
  amount?: string | number;
  description?: string;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Category Definitions
// ---------------------------------------------------------------------------

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'] as const;

export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  // Milestone 1 — Core Metrics
  {
    id: 'capSpace',
    name: 'Projected Cap Space',
    description: 'Available cap space after committed salaries and dead money',
    milestone: 1,
    format: 'compactCurrency',
    direction: 'asc',
  },
  {
    id: 'deadMoney',
    name: 'Dead Money',
    description: 'Cap charges from released players',
    milestone: 1,
    format: 'compactCurrency',
    direction: 'desc',
  },
  {
    id: 'effectiveCapSpace',
    name: 'Effective Cap Space',
    description: 'Cap space minus $5M rookie reserve',
    milestone: 1,
    format: 'compactCurrency',
    direction: 'asc',
  },
  {
    id: 'avgAge',
    name: 'Average Age',
    description: 'Average age of players still under contract',
    milestone: 1,
    format: 'decimal',
    direction: 'desc',
  },
  {
    id: 'playersUnderContract',
    name: 'Players Under Contract',
    description: 'Number of players still signed',
    milestone: 1,
    format: 'number',
    direction: 'asc',
  },
  // Milestone 2 — High Value Additions
  {
    id: 'expiringContracts',
    name: 'Expiring Contracts',
    description: 'Players whose contracts end that year',
    milestone: 2,
    format: 'number',
    direction: 'desc',
  },
  {
    id: 'positionalDepth',
    name: 'Positional Depth',
    description: 'Players under contract by position',
    milestone: 2,
    format: 'number',
    direction: 'asc',
    subCategories: POSITIONS.map((p) => ({ id: p, name: p })),
  },
  {
    id: 'avgContractLength',
    name: 'Avg Contract Length',
    description: 'Average years remaining on contracts',
    milestone: 2,
    format: 'decimal',
    direction: 'asc',
  },
  {
    id: 'committedSalaryPct',
    name: 'Committed Salary %',
    description: 'Percentage of cap committed to salaries',
    milestone: 2,
    format: 'percentage',
    direction: 'desc',
  },
  {
    id: 'rosterHoles',
    name: 'Roster Holes',
    description: 'Spots needed to reach 22 active players',
    milestone: 2,
    format: 'number',
    direction: 'desc',
  },
  {
    id: 'topPlayerRetention',
    name: 'Top Player Retention',
    description: 'How many of the current top-10 scorers are still under contract',
    milestone: 2,
    format: 'number',
    direction: 'asc',
  },
  {
    id: 'weightedAge',
    name: 'Salary-Weighted Age',
    description: 'Average age weighted by salary (expensive + old = trouble)',
    milestone: 2,
    format: 'decimal',
    direction: 'desc',
  },
  {
    id: 'positionalSpend',
    name: 'Positional Spend %',
    description: 'Percentage of cap spent by position',
    milestone: 2,
    format: 'percentage',
    direction: 'asc',
    subCategories: POSITIONS.filter((p) => !['PK', 'DEF'].includes(p)).map((p) => ({
      id: p,
      name: p,
    })),
  },
  {
    id: 'draftCapital',
    name: 'Draft Capital',
    description: 'Number of draft picks owned',
    milestone: 2,
    format: 'number',
    direction: 'asc',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw salary adjustment description to extract dead money metadata.
 * Mirrors the parseAdjustmentMeta function used on the roster page.
 */
export function parseSalaryAdjustment(adj: RawSalaryAdjustment): DeadMoneyAdjustment {
  const description = adj.description ?? '';
  const franchiseId = adj.franchise_id ?? adj.franchiseId ?? '';
  const amount = parseNumber(adj.amount);

  let salary: number | undefined;
  let yearsRemaining: number | undefined;

  const salaryMatch = description.match(/Salary:\s*\$?([\d,\.]+)/i);
  if (salaryMatch) {
    salary = Number(salaryMatch[1].replace(/,/g, '')) || undefined;
  }

  const yearsMatch = description.match(/Years:\s*(\d+)/i);
  if (yearsMatch) {
    yearsRemaining = parseInt(yearsMatch[1], 10);
  }

  return {
    franchiseId,
    amount,
    salary: salary ?? amount,
    yearsRemaining,
    yearOffset: 0,
  };
}

/** Normalise position string to standard codes */
function normalizePosition(pos?: string): string {
  if (!pos) return 'FLEX';
  const upper = pos.toUpperCase();
  if (['DEF', 'DST', 'D/ST', 'DEFENSE', 'DEF/ST'].includes(upper)) return 'DEF';
  if (upper === 'K') return 'PK';
  if (['QB', 'RB', 'WR', 'TE', 'PK'].includes(upper)) return upper;
  return 'FLEX';
}

/** Calculate a player's age as of a reference date */
function ageAsOf(birthdateUnixSeconds: number, referenceDate: Date): number {
  if (!birthdateUnixSeconds || birthdateUnixSeconds <= 0) return 0;
  const birthMs = birthdateUnixSeconds * 1000;
  return (referenceDate.getTime() - birthMs) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Map a SalaryPlayer to the CapPlayer shape expected by calculateCapCharges()
 */
function toCapPlayer(player: SalaryPlayer): CapPlayer {
  return {
    salary: player.salary,
    contractYears: parseNumber(player.contractYear),
    displayTag: normalizeStatus(player.status),
  };
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

export function computeLeagueSummary(
  players: SalaryPlayer[],
  rawAdjustments: RawSalaryAdjustment[],
  futureDraftPicksData: FutureDraftPicksData | null,
  teamConfigs: TeamConfig[],
): TeamSummary[] {
  // Group players by franchise
  const playersByFranchise = new Map<string, SalaryPlayer[]>();
  for (const team of teamConfigs) {
    playersByFranchise.set(team.franchiseId, []);
  }
  for (const player of players) {
    const list = playersByFranchise.get(player.franchiseId);
    if (list) list.push(player);
  }

  // Parse adjustments
  const adjustments = rawAdjustments.map(parseSalaryAdjustment);

  // Draft capital for year 1 of SUMMARY_YEARS (e.g., 2026)
  const draftYear = SUMMARY_YEARS[0]; // e.g., 2026
  const draftCapitalMap = futureDraftPicksData
    ? getDraftCapitalSummary(futureDraftPicksData, draftYear)
    : new Map<string, { total: number; byRound: Map<number, number> }>();

  const results: TeamSummary[] = [];

  for (const team of teamConfigs) {
    const teamPlayers = playersByFranchise.get(team.franchiseId) ?? [];
    const capPlayers = teamPlayers.map(toCapPlayer);

    // --- Cap charges (reuse exact same function as roster page) ---
    // Returns 5 elements for SALARY_YEARS indices 0-4.
    // SUMMARY_YEARS maps to original indices 1-5. Index 5 is beyond
    // the max contract length so cap charges are always 0 there.
    const capChargesBase = calculateCapCharges(capPlayers);

    // --- Dead money ---
    // Same structure: 5 elements for indices 0-4. Index 5 = 0.
    const deadMoneyBase = aggregateDeadMoney(adjustments, team.franchiseId);

    // --- Per-year metrics ---
    const capSpaceArr: number[] = [];
    const effectiveCapSpaceArr: number[] = [];
    const deadMoneyArr: number[] = [];
    const avgAgeArr: number[] = [];
    const playersUnderContractArr: number[] = [];
    const expiringContractsArr: number[] = [];
    const avgContractLengthArr: number[] = [];
    const committedSalaryPctArr: number[] = [];
    const rosterHolesArr: number[] = [];
    const topPlayerRetentionArr: number[] = [];
    const weightedAgeArr: number[] = [];
    const draftCapitalArr: number[] = [];
    const positionalDepthArr: Record<string, number>[] = [];
    const positionalSpendArr: Record<string, number>[] = [];

    // Sort players by points descending for top player retention
    const sortedByPoints = [...teamPlayers].sort((a, b) => b.points - a.points);
    const top10Players = sortedByPoints.slice(0, 10);

    for (let si = 0; si < SUMMARY_YEARS.length; si++) {
      const year = SUMMARY_YEARS[si];
      // `oi` is the original SALARY_YEARS index: SUMMARY_YEARS[0]=2026 → oi=1
      const oi = si + 1;
      const refDate = new Date(Date.UTC(year, 6, 1)); // July 1 of the projection year

      // Cap charges and dead money: use base arrays for indices 1-4, 0 for index 5
      const capCharge = oi < capChargesBase.length ? capChargesBase[oi] : 0;
      const deadMoneyCharge = oi < deadMoneyBase.length ? (deadMoneyBase[oi] ?? 0) : 0;

      // Players still under contract in this year (original index perspective)
      const underContract = teamPlayers.filter(
        (p) => parseNumber(p.contractYear) > oi
      );
      const underContractCount = underContract.length;

      // 1. Cap space = cap - charges - dead money
      const cs = SALARY_CAP - capCharge - deadMoneyCharge;
      capSpaceArr.push(cs);

      // 2. Dead money
      deadMoneyArr.push(deadMoneyCharge);

      // 3. Effective cap space
      effectiveCapSpaceArr.push(cs - RESERVE_FOR_ROOKIES);

      // 4. Average age of players still under contract
      const ages = underContract
        .map((p) => ageAsOf(p.birthdate, refDate))
        .filter((a) => a > 0);
      avgAgeArr.push(ages.length > 0 ? ages.reduce((s, a) => s + a, 0) / ages.length : 0);

      // 5. Players under contract
      playersUnderContractArr.push(underContractCount);

      // 6. Expiring contracts (contract ends this year → contractYear === oi + 1)
      const expiringCount = teamPlayers.filter(
        (p) => parseNumber(p.contractYear) === oi + 1
      ).length;
      expiringContractsArr.push(expiringCount);

      // 7. Positional depth
      const posDepth: Record<string, number> = {};
      for (const pos of POSITIONS) posDepth[pos] = 0;
      for (const p of underContract) {
        const pos = normalizePosition(p.position);
        if (pos in posDepth) posDepth[pos]++;
      }
      positionalDepthArr.push(posDepth);

      // 8. Average contract length remaining
      if (underContractCount > 0) {
        const totalYearsLeft = underContract.reduce(
          (sum, p) => sum + (parseNumber(p.contractYear) - oi),
          0
        );
        avgContractLengthArr.push(totalYearsLeft / underContractCount);
      } else {
        avgContractLengthArr.push(0);
      }

      // 9. Committed salary % of cap
      committedSalaryPctArr.push(
        SALARY_CAP > 0 ? (capCharge / SALARY_CAP) * 100 : 0
      );

      // 10. Roster holes
      rosterHolesArr.push(Math.max(0, TARGET_ACTIVE_COUNT - underContractCount));

      // 11. Top player retention
      const retainedTop = top10Players.filter(
        (p) => parseNumber(p.contractYear) > oi
      ).length;
      topPlayerRetentionArr.push(retainedTop);

      // 12. Salary-weighted age
      let weightedAgeSum = 0;
      let weightedSalarySum = 0;
      for (const p of underContract) {
        const age = ageAsOf(p.birthdate, refDate);
        if (age <= 0) continue;
        const escalatedSalary = p.salary * Math.pow(1.10, oi);
        weightedAgeSum += age * escalatedSalary;
        weightedSalarySum += escalatedSalary;
      }
      weightedAgeArr.push(
        weightedSalarySum > 0 ? weightedAgeSum / weightedSalarySum : 0
      );

      // 13. Positional spend %
      const posSpend: Record<string, number> = {};
      for (const pos of POSITIONS) posSpend[pos] = 0;
      for (const p of underContract) {
        const pos = normalizePosition(p.position);
        if (!(pos in posSpend)) continue;
        // All summary years are future years — no taxi-squad 50% discount
        posSpend[pos] += p.salary * Math.pow(1.10, oi);
      }
      // Convert to % of cap
      const totalCapCharge = capCharge || 1; // avoid div by 0
      for (const pos of POSITIONS) {
        posSpend[pos] = (posSpend[pos] / totalCapCharge) * 100;
      }
      positionalSpendArr.push(posSpend);

      // 14. Draft capital
      if (si === 0) {
        // First summary year (e.g., 2026) — use actual futureDraftPicks data
        const teamDraftCapital = draftCapitalMap.get(team.franchiseId);
        draftCapitalArr.push(teamDraftCapital?.total ?? 3);
      } else {
        // Years 2-5: standard allocation of 3 picks
        draftCapitalArr.push(3);
      }
    }

    results.push({
      franchiseId: team.franchiseId,
      teamName: team.name,
      teamIcon: team.icon ?? '',
      division: team.division ?? '',
      metrics: {
        capSpace: capSpaceArr,
        deadMoney: deadMoneyArr,
        effectiveCapSpace: effectiveCapSpaceArr,
        avgAge: avgAgeArr,
        playersUnderContract: playersUnderContractArr,
        expiringContracts: expiringContractsArr,
        avgContractLength: avgContractLengthArr,
        committedSalaryPct: committedSalaryPctArr,
        rosterHoles: rosterHolesArr,
        topPlayerRetention: topPlayerRetentionArr,
        weightedAge: weightedAgeArr,
        draftCapital: draftCapitalArr,
      },
      positionalDepth: positionalDepthArr,
      positionalSpend: positionalSpendArr,
    });
  }

  return results;
}
