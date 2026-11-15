/**
 * TheLeague's Veteran Extension rule, written once from the Constitution.
 *
 * Source: src/data/league-constitution.ts § VETERAN EXTENSIONS. Every surface
 * that offers, prices or accepts a veteran extension reads THIS module — the
 * Front Office planner, the Rosters page's contract modal, the eligibility
 * engine and the declare endpoint — so the page and the server cannot
 * disagree about who is eligible or what the extension costs.
 *
 * The rule, as written:
 * - Each team may extend ONE veteran player per season, until Feb 15, 2028.
 * - The contract after the extension may not exceed 6 years in total.
 * - The price uses the Rookie Extension formula (top-5 positional average,
 *   prorated over the new term, added to current salary, +10% per year).
 * - Rookie contracts are not eligible (they have their own Rookie Extension).
 * - The player must have at least 2 years remaining.
 *
 * Decisions Brandon made where the Constitution is silent (2026-11-14):
 * - The owner picks how many years to add: 1 or 2, inside the 6-year cap.
 * - "Per season" is the LEAGUE year (Feb 15 → Feb 14 8:45pm PT), never the
 *   calendar year — a November and a February extension are the same season.
 * - Open all year; in practice owners file after the regular season and
 *   before the Feb 14 8:45pm PT rollover. No separate window is enforced.
 * - "Rookie contract" means any RC or TO (1st-round team option) contract.
 * - The veteran slot is its own limit; rookie extensions and 5th-year options
 *   do not use it.
 *
 * Pure: no I/O, safe to import from client scripts.
 */
import { calculateVeteranExtension } from './salary-calculations';
import { getCurrentLeagueYear } from './league-year';

export const VETERAN_EXTENSION_MAX_TOTAL_YEARS = 6;
/** The roster designation an extended contract carries on MFL ('E'), as every
 *  other extension path writes it (contract-actions-client.ts). */
export const VETERAN_EXTENSION_CONTRACT_INFO = 'E';
export const VETERAN_EXTENSION_MIN_YEARS_REMAINING = 2;
/** The owner's choice of term (Brandon, 2026-11-14). */
export const VETERAN_EXTENSION_YEAR_CHOICES = [1, 2] as const;
/**
 * "From now until February 15, 2028" — Feb 15, 2028 is the first day of
 * league year 2028, so league year 2027 is the last one the rule covers.
 */
export const VETERAN_EXTENSION_LAST_LEAGUE_YEAR = 2027;

/** RC and TO are both rookie contracts; they extend under the Rookie rules. */
export function isRookieContract(contractInfo: string | null | undefined): boolean {
  const info = String(contractInfo ?? '').trim().toUpperCase();
  return info === 'RC' || info === 'TO';
}

export function isVeteranExtensionRuleActive(leagueYear: number): boolean {
  return leagueYear <= VETERAN_EXTENSION_LAST_LEAGUE_YEAR;
}

/** The league year a declaration belongs to, from its submittedAt stamp. */
export function leagueYearOfTimestamp(iso: string): number {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? NaN : getCurrentLeagueYear(at);
}

export interface VeteranExtensionPlayer {
  /** Years remaining on the current contract. */
  contractYears: number;
  contractInfo: string;
  salary: number;
  position: string;
}

export type VeteranExtensionIneligibleReason =
  | 'rule-expired'
  | 'rookie-contract'
  | 'too-few-years'
  | 'at-year-cap';

export interface VeteranExtensionEligibility {
  eligible: boolean;
  reason?: VeteranExtensionIneligibleReason;
  /** One-line, owner-facing reason when not eligible. */
  message?: string;
  /** Years the owner may add (subset of 1 and 2), empty when not eligible. */
  yearChoices: number[];
}

/**
 * The key a position is stored under in MFL's averages shape. MFL spells
 * defense "Def" in the averages feed while rosters and the player map say DEF.
 */
function averagesKey(position: string, salaryAverages: any): string {
  const pos = String(position || '').toUpperCase();
  const positions = salaryAverages?.positions ?? {};
  if (positions[pos]) return pos;
  if (pos === 'DEF' && positions.Def) return 'Def';
  return pos;
}

/** The top-5 positional average the price is built on, 0 when unknown. */
export function top5AverageFor(position: string, salaryAverages: any): number {
  const row = salaryAverages?.positions?.[averagesKey(position, salaryAverages)];
  return Number(row?.top5Average) || 0;
}

/**
 * Is this player eligible, and which terms may the owner pick? A rule fact
 * only — whether the extension can be PRICED is checked separately by
 * `checkVeteranExtensionRequest`, so a page without the averages loaded
 * still shows the player as eligible.
 */
export function veteranExtensionEligibility(
  player: VeteranExtensionPlayer,
  leagueYear: number,
): VeteranExtensionEligibility {
  const no = (reason: VeteranExtensionIneligibleReason, message: string): VeteranExtensionEligibility => ({
    eligible: false,
    reason,
    message,
    yearChoices: [],
  });

  if (!isVeteranExtensionRuleActive(leagueYear)) {
    return no('rule-expired', 'Veteran extensions ended on Feb 15, 2028.');
  }
  if (isRookieContract(player.contractInfo)) {
    return no('rookie-contract', 'Rookie contracts can only use a Rookie Extension.');
  }
  const years = Math.trunc(Number(player.contractYears) || 0);
  if (years < VETERAN_EXTENSION_MIN_YEARS_REMAINING) {
    return no('too-few-years', 'Needs at least 2 years left on the contract.');
  }
  const yearChoices = VETERAN_EXTENSION_YEAR_CHOICES.filter(
    (add) => years + add <= VETERAN_EXTENSION_MAX_TOTAL_YEARS,
  ) as number[];
  if (yearChoices.length === 0) {
    return no('at-year-cap', 'Already at the 6-year contract limit.');
  }
  return { eligible: true, yearChoices };
}

export interface VeteranExtensionPrice {
  addedYears: number;
  /** Total years on the new contract. */
  newYears: number;
  /** First-year salary of the new contract. */
  newSalary: number;
  /** Salary for every year of the new contract, 10% raise per year. */
  salaryByYear: number[];
}

export function priceVeteranExtension(
  player: VeteranExtensionPlayer,
  addedYears: number,
  salaryAverages: any,
): VeteranExtensionPrice {
  const { newSalary, newYears, salaryBreakdown } = calculateVeteranExtension(
    player.contractYears,
    averagesKey(player.position, salaryAverages),
    addedYears,
    player.salary,
    salaryAverages,
  );
  const salaryByYear = Array.from({ length: newYears }, (_, i) => salaryBreakdown[`year${i}`] ?? 0);
  return { addedYears, newYears, newSalary, salaryByYear };
}

export type VeteranExtensionRequestResult =
  | { ok: true; price: VeteranExtensionPrice }
  | { ok: false; error: string };

/**
 * The whole server-side decision for one request. `teamAlreadyUsed` is the
 * team's live (not rejected/expired) veteran extension this league year for a
 * DIFFERENT player, if any — re-filing the same player is a change, not a
 * second extension.
 */
export function checkVeteranExtensionRequest(input: {
  player: VeteranExtensionPlayer;
  addedYears: number;
  leagueYear: number;
  salaryAverages: any;
  teamAlreadyUsed?: { playerName?: string } | null;
}): VeteranExtensionRequestResult {
  const { player, addedYears, leagueYear, salaryAverages, teamAlreadyUsed } = input;
  const eligibility = veteranExtensionEligibility(player, leagueYear);
  if (!eligibility.eligible) return { ok: false, error: eligibility.message ?? 'Not eligible' };
  if (top5AverageFor(player.position, salaryAverages) <= 0) {
    return { ok: false, error: `No ${player.position || 'position'} salary average to price the extension from.` };
  }
  if (!eligibility.yearChoices.includes(addedYears)) {
    return {
      ok: false,
      error:
        eligibility.yearChoices.length === 1
          ? `This player can add ${eligibility.yearChoices[0]} year at most (6-year limit).`
          : 'Pick 1 or 2 years to add.',
    };
  }
  if (teamAlreadyUsed) {
    const who = teamAlreadyUsed.playerName ? ` (${teamAlreadyUsed.playerName})` : '';
    return { ok: false, error: `Your team already used its veteran extension this season${who}.` };
  }
  return { ok: true, price: priceVeteranExtension(player, addedYears, salaryAverages) };
}
