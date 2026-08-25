/**
 * Client-side contract math for the TheLeague rosters page.
 *
 * Extracted verbatim from the inline `<script>` in
 * `src/pages/theleague/rosters.astro`, which carried untyped copies of every
 * function below. They are NOT the same functions as the same-named exports in
 * `salary-calculations.ts`: those read the RAW MFL averages payload
 * (`positions[pos].top3Average`), while these read the FLATTENED per-season
 * shape the page serializes into `#roster-config`
 * (`salaryAverages[season].franchiseSalaries[pos]`). The flattening happens in
 * the page frontmatter — see `salaryAveragesBySeason` there. Keep both: the
 * server side has the raw payload, the client only ever gets the flat one.
 *
 * Behavior is preserved exactly as it was inline; the only change is that the
 * types are now declared instead of inferred as `any`.
 */

import type { SalaryAverages } from './contract-eligibility';

/** `config.salaryAverages` — flattened averages keyed by season (a year string). */
export type SalaryAveragesBySeason = Record<string, SalaryAverages | undefined>;

/** Which positional average a calculation draws from. */
export type ReferenceSalaryType = 'franchise' | 'team-option' | 'extension';

/** Annual salary escalation applied to every contract year after the first. */
export const ESCALATION_RATE = 1.1;

/**
 * Future-season cut penalty as a fraction of salary, by contract years
 * remaining. Mirrors `FUTURE_PERCENT_BY_YEARS` in `salary-calculations.ts`.
 */
const FUTURE_PERCENT_BY_YEARS: Record<number, number> = {
  1: 0,
  2: 0.15,
  3: 0.25,
  4: 0.35,
  5: 0.45,
};

/** Format a salary as compact currency ($1.23M / $450K / $999). */
export function formatSalaryCompact(val: unknown): string {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

/**
 * Whole-dollar currency, with a non-finite guard.
 *
 * Deliberately not `formatters.ts#formatCurrency`: that one has no NaN guard
 * and would render "$NaN" where this renders "$0".
 */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return formatter.format(Math.round(value));
}

/** Look up the positional average a tag/option/extension is priced against. */
export function getReferenceSalary(
  position: string,
  type: ReferenceSalaryType,
  season: string,
  salaryAverages: SalaryAveragesBySeason | undefined,
): number {
  const averages = salaryAverages?.[season];
  if (!averages) return 0;

  if (type === 'franchise') return averages.franchiseSalaries?.[position] ?? 0;
  if (type === 'team-option') return averages.teamOptionSalaries?.[position] ?? 0;
  return averages.extensionSalaries?.[position] ?? 0;
}

/** Result of a one-year contract action (franchise tag / team option). */
export interface OneYearContractResult {
  newSalary: number;
  newYears: number;
  /**
   * Which contract year the player becomes a UFA in.
   *
   * Not computed here — `applyContractAction` in rosters.astro stamps it onto
   * the returned object, because only the caller knows the player's current
   * year index. Declared so that mutation is typed rather than an error.
   */
  ufaYearIndex?: number;
}

/** Franchise tag: the greater of a 20% raise and the top-3 positional average. */
export function calculateFranchiseTag(
  salary: number,
  position: string,
  season: string,
  salaryAverages: SalaryAveragesBySeason | undefined,
): OneYearContractResult {
  const increasedSalary = salary * 1.2;
  const avgSalary = getReferenceSalary(position, 'franchise', season, salaryAverages);
  return {
    newSalary: Math.round(Math.max(increasedSalary, avgSalary)),
    newYears: 1,
  };
}

/** 1st-round team option: the top-10 positional average, for one year. */
export function calculateTeamOption(
  position: string,
  season: string,
  salaryAverages: SalaryAveragesBySeason | undefined,
): OneYearContractResult {
  const avgSalary = getReferenceSalary(position, 'team-option', season, salaryAverages);
  return {
    newSalary: Math.round(avgSalary),
    newYears: 1,
  };
}

/** Result of a veteran extension, including its year-by-year escalation. */
export interface VeteranExtensionResult {
  newSalary: number;
  newYears: number;
  /** `year0` … `year{n-1}` → escalated salary for that contract year. */
  salaryBreakdown: Record<string, number>;
}

/**
 * Veteran extension.
 *
 * Per the constitution: `(top5 avg × extensionYears) / (existingYears +
 * extensionYears) + currentSalary`, then escalated 10% per year across the
 * whole new contract.
 */
export function calculateVeteranExtension(
  contractYears: number | string | null | undefined,
  position: string,
  season: string,
  extensionYears: number | string | null | undefined,
  currentSalary: number | string | null | undefined,
  salaryAverages: SalaryAveragesBySeason | undefined,
): VeteranExtensionResult {
  const existingYears = Number(contractYears ?? 0) || 0;
  const extYears = Number(extensionYears ?? 0) || 0;
  const avgSalary = getReferenceSalary(position, 'extension', season, salaryAverages);

  const denominator = existingYears + extYears;
  const proratedPortion = denominator > 0 ? (avgSalary * extYears) / denominator : 0;
  const baseSalary = Number(currentSalary ?? 0);
  const newSalaryCurrent = Math.round(proratedPortion + baseSalary);

  const totalYears = existingYears + extYears;

  const salaryBreakdown: Record<string, number> = {};
  for (let i = 0; i < totalYears; i++) {
    salaryBreakdown[`year${i}`] = Math.round(newSalaryCurrent * Math.pow(ESCALATION_RATE, i));
  }

  return {
    newSalary: newSalaryCurrent,
    newYears: totalYears,
    salaryBreakdown,
  };
}

/** Dead-money split from cutting a player mid-contract. */
export interface CutPenaltyResult {
  currentPenalty: number;
  futurePenalty: number;
  totalPenalty: number;
}

/** Cut penalty: 50% of salary this season, plus a years-remaining tail. */
export function calculateCutPenalty(salary: number, contractYears: number): CutPenaltyResult {
  const currentSeasonPenalty = salary * 0.5;
  let futureSeasonPenalty = 0;

  if (contractYears > 1) {
    futureSeasonPenalty = salary * (FUTURE_PERCENT_BY_YEARS[contractYears] ?? 0);
  }

  return {
    currentPenalty: currentSeasonPenalty,
    futurePenalty: futureSeasonPenalty,
    totalPenalty: currentSeasonPenalty + futureSeasonPenalty,
  };
}

/** Every contract action an owner can stage on the rosters page. */
export type ContractActionType =
  | 'franchise'
  | 'team-option'
  | 'extension'
  | 'rookie-extension'
  | 'cut'
  | 'trade';

/**
 * One staged, unsubmitted contract action, as `applyContractAction` records it
 * in the page's `contractActions` map.
 *
 * The calculator result is spread in on top of the common fields, so which of
 * the optional fields are present depends on `type`: a tag or option carries
 * newSalary/newYears/ufaYearIndex, an extension adds salaryBreakdown, a cut
 * carries the three penalty figures, and a trade only sets `removed`.
 */
export interface ContractAction {
  type: ContractActionType;
  playerId: string;
  playerName?: string;
  playerPosition?: string;
  originalSalary?: number;
  originalYears?: number;

  /** Tag / option / extension. */
  newSalary?: number;
  newYears?: number;
  ufaYearIndex?: number;
  salaryBreakdown?: Record<string, number>;

  /** Cut. */
  currentPenalty?: number;
  futurePenalty?: number;
  totalPenalty?: number;

  /** Trade. */
  removed?: boolean;
}
