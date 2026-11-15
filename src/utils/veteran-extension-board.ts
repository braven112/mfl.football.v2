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
}

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

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

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
}): VeteranExtensionBoard {
  const { players, leagueYear, salaryAverages, declaration } = input;
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
      rows.push({
        player,
        options: eligibility.yearChoices.map((add) => priceVeteranExtension(facts, add, salaryAverages)),
      });
    }
  }
  rows.sort((a, b) => {
    const pa = POSITION_ORDER.indexOf(String(a.player.position).toUpperCase());
    const pb = POSITION_ORDER.indexOf(String(b.player.position).toUpperCase());
    if (pa !== pb) return pa - pb;
    return b.player.salary - a.player.salary;
  });
  return { leagueYear, ruleActive, slot: slotFromDeclaration(declaration), rows };
}
