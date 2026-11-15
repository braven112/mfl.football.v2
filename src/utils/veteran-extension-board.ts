/**
 * What the Front Office planner's "Your veteran extension" card renders, for
 * the viewer's own team: every player the Constitution lets them extend,
 * each priced at every term they may pick, plus where the team's one slot
 * stands this league year.
 *
 * Priced here, on the server, from `veteran-extension-rules.ts` — the same
 * functions the declare endpoint re-runs — so the number on the button is
 * the number that is filed. No pricing math ships to the browser.
 */
import type { ContractDeclaration } from '../types/contracts';
import type { BestFinish } from './position-finishes';
import {
  veteranExtensionEligibility,
  priceVeteranExtension,
  top5AverageFor,
  isVeteranExtensionRuleActive,
  type VeteranExtensionPrice,
} from './veteran-extension-rules';

export interface VeteranExtensionBoardPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  headshot: string;
  salary: number;
  contractYears: number;
  contractInfo: string;
}

export interface VeteranExtensionBoardRow {
  player: VeteranExtensionBoardPlayer;
  /** One price per term the owner may pick (1 and/or 2 years). */
  options: VeteranExtensionPrice[];
  /** Under the salary line AND a top-10 finish at the position, ever. Shown first, highlighted. */
  likely: boolean;
  /** The best regular-season finish at the position in league history, if any. */
  bestFinish: BestFinish | null;
}

/**
 * Brandon's display rules (2026-11-14). Who the card SHOWS, not who may
 * extend — the declare endpoint still accepts any eligible player.
 * - Likely (highlighted, open by default): under $3M now AND ever top 10 at
 *   the position.
 * - Behind "Show all": under $3M OR ever top 10, but not both.
 * - Never shown: $3M or more AND never top 10.
 * Lowest salary first.
 */
export const LIKELY_SALARY_CEILING = 3_000_000;
export const LIKELY_TOP_FINISH = 10;

export type VeteranExtensionSlot =
  | { state: 'unused' }
  | { state: 'pending' | 'applied'; playerId: string; playerName: string; newYears: number; newSalary: number; currentYears: number };

export interface VeteranExtensionBoard {
  leagueYear: number;
  /** False after the Feb 15, 2028 sunset: the card says so and offers nothing. */
  ruleActive: boolean;
  slot: VeteranExtensionSlot;
  rows: VeteranExtensionBoardRow[];
}

export function slotFromDeclaration(d: ContractDeclaration | undefined | null): VeteranExtensionSlot {
  if (!d || (d.status !== 'pending' && d.status !== 'applied' && d.status !== 'approved')) return { state: 'unused' };
  return {
    state: d.status === 'pending' ? 'pending' : 'applied',
    playerId: d.playerId,
    playerName: d.playerName,
    newYears: d.requestedYears,
    newSalary: d.requestedSalary ?? d.currentSalary,
    currentYears: d.currentYears,
  };
}

export function buildVeteranExtensionBoard(input: {
  players: VeteranExtensionBoardPlayer[];
  leagueYear: number;
  salaryAverages: any;
  declaration?: ContractDeclaration | null;
  /** Best career finish by player id (position-finishes.ts). */
  bestFinishes?: Map<string, BestFinish>;
}): VeteranExtensionBoard {
  const { players, leagueYear, salaryAverages, declaration, bestFinishes } = input;
  const slot = slotFromDeclaration(declaration);
  const filedId = slot.state === 'unused' ? null : slot.playerId;
  const ruleActive = isVeteranExtensionRuleActive(leagueYear);
  const rows: VeteranExtensionBoardRow[] = [];
  if (ruleActive) {
    for (const player of players) {
      const facts = {
        contractYears: player.contractYears,
        contractInfo: player.contractInfo,
        salary: player.salary,
        position: player.position,
      };
      const eligibility = veteranExtensionEligibility(facts, leagueYear);
      if (!eligibility.eligible) continue;
      if (top5AverageFor(player.position, salaryAverages) <= 0) continue;
      const bestFinish = bestFinishes?.get(player.id) ?? null;
      const cheap = player.salary < LIKELY_SALARY_CEILING;
      const proven = !!bestFinish && bestFinish.rank <= LIKELY_TOP_FINISH;
      // The player already filed always shows, so the owner can see and change it.
      if (!cheap && !proven && player.id !== filedId) continue;
      rows.push({
        player,
        options: eligibility.yearChoices.map((add) => priceVeteranExtension(facts, add, salaryAverages)),
        likely: cheap && proven,
        bestFinish,
      });
    }
  }
  rows.sort((a, b) => a.player.salary - b.player.salary || a.player.name.localeCompare(b.player.name));
  return { leagueYear, ruleActive, slot, rows };
}
