/**
 * Multi-year cap projection, with a scenario applied.
 *
 * `project(roster, scenario, years)` is pure: roster rows in, one row per
 * season out. It is the model behind the Front Office hub's cap planner —
 * tick "extend Hall, cut Misack, tag Chase" and watch three seasons move.
 *
 * TWO RULES, BOTH LOAD-BEARING
 *
 * 1. **No cap formula is defined here.** Escalation, inclusion percentages,
 *    the extension and franchise-tag prices, the cut penalty — every one
 *    comes from `salary-calculations.ts`, the same module the Trade Builder
 *    and every server-side figure read. This module only decides which rows
 *    to feed it. A number that is wrong should be wrong in one place.
 *
 * 2. **A scenario is scratch.** Nothing in here calls an API, reads a
 *    cookie or touches storage. Applying a move produces a NEW row set; the
 *    caller's roster is never mutated, so "reset" is just dropping the
 *    scenario. That separation is what lets the UI promise an owner they
 *    can explore without filing anything, and
 *    `tests/cap-scenario-boundary.test.ts` pins it.
 */
import {
  calculateCapCharges,
  calculateCutPenalty,
  calculateFranchiseTag,
  calculateVeteranExtension,
  aggregateDeadMoney,
  SALARY_CAP,
  type CapPlayer,
  type DeadMoneyAdjustment,
} from './salary-calculations';

/** A roster row as the projection needs it. Structural, so any caller's
 *  richer row satisfies it without being converted. */
export interface ProjectionPlayer extends CapPlayer {
  id: string;
  name: string;
  position: string;
  salary: number;
  contractYears: number;
  displayTag?: string;
}

/**
 * THERE IS NO "WALK" MOVE, and there was briefly — removing it is the point
 * of this comment.
 *
 * It removed a player from every season at zero cost, which models losing
 * someone and recovering 100% of their cap. Nothing in this league does
 * that: a cut leaves dead money, and a trade is the only other way out.
 *
 * The real thing it was reaching for — a contract simply running out — is
 * not a move at all. It is the BASELINE: `calculateCapCharges` counts a
 * player in season `index` only while `contractYears > index`, so a player
 * with one year left already drops off the 2027 column with nothing ticked.
 * Offering it as a lever invited an owner to plan against cap space that
 * cannot exist.
 */
export type ScenarioMove =
  | { kind: 'extend'; playerId: string; years: number }
  | { kind: 'tag'; playerId: string }
  | { kind: 'cut'; playerId: string };

export interface Scenario {
  /** Stable id, for storage and comparison. */
  id: string;
  name: string;
  moves: ScenarioMove[];
}

export const emptyScenario = (name = 'Scratch'): Scenario => ({
  id: `sc_${Date.now().toString(36)}`,
  name,
  moves: [],
});

export interface CapYear {
  year: number;
  /** Salary committed to players under contract that season. */
  committed: number;
  /** Dead money landing in that season, including any the scenario creates. */
  deadMoney: number;
  capLimit: number;
  /** capLimit − committed − deadMoney. Negative means over the cap, and is
   *  deliberately NOT clamped: an over-cap team must not read like one that
   *  is exactly at the wire. */
  space: number;
  /** How many players are still under contract that season. */
  playersUnderContract: number;
}

export interface ProjectionInput {
  roster: ProjectionPlayer[];
  /** Existing dead money, already aggregated by year offset. */
  deadMoneyByYear?: number[];
  /** Per-position averages, in MFL's nested shape, for pricing moves. */
  salaryAverages?: unknown;
  capLimit?: number;
  /** First season of the projection. */
  startYear: number;
  years?: number;
}

/**
 * Apply a scenario's moves to a roster, returning a new row set plus any
 * dead money the moves create.
 *
 * Order is deliberate: a player can only be the subject of ONE move, so the
 * last move wins for a given id rather than compounding (tagging a player
 * you already extended is a correction, not both).
 */
export function applyScenario(
  roster: ProjectionPlayer[],
  scenario: Scenario | null,
  salaryAverages?: unknown,
): { rows: ProjectionPlayer[]; addedDeadMoney: number[] } {
  const addedDeadMoney = [0, 0, 0, 0, 0];
  if (!scenario || scenario.moves.length === 0) {
    return { rows: roster.map((p) => ({ ...p })), addedDeadMoney };
  }

  const byPlayer = new Map<string, ScenarioMove>();
  for (const move of scenario.moves) byPlayer.set(move.playerId, move);

  const rows: ProjectionPlayer[] = [];
  for (const player of roster) {
    const move = byPlayer.get(player.id);
    if (!move) {
      rows.push({ ...player });
      continue;
    }

    if (move.kind === 'cut') {
      // The player leaves the books; the penalty stays on them. 50% this
      // season, then the years-remaining percentage next.
      const penalty = calculateCutPenalty(player.salary, player.contractYears);
      addedDeadMoney[0] += penalty.currentPenalty;
      addedDeadMoney[1] += penalty.futurePenalty;
      continue;
    }

    if (move.kind === 'tag') {
      const { newSalary, newYears } = calculateFranchiseTag(player.salary, player.position, salaryAverages);
      rows.push({ ...player, salary: newSalary, contractYears: newYears });
      continue;
    }

    const { newSalary, newYears } = calculateVeteranExtension(
      player.contractYears,
      player.position,
      move.years,
      player.salary,
      salaryAverages,
    );
    rows.push({ ...player, salary: newSalary, contractYears: newYears });
  }

  return { rows, addedDeadMoney };
}

/** Project cap space across `years` seasons with a scenario applied. */
export function project(input: ProjectionInput, scenario: Scenario | null = null): CapYear[] {
  const { roster, deadMoneyByYear = [], salaryAverages, capLimit = SALARY_CAP, startYear, years = 3 } = input;

  const { rows, addedDeadMoney } = applyScenario(roster, scenario, salaryAverages);
  // Escalation and inclusion percentages both live inside this call.
  const charges = calculateCapCharges(rows);

  return Array.from({ length: years }, (_, i) => {
    const committed = charges[i] ?? 0;
    const deadMoney = (deadMoneyByYear[i] ?? 0) + (addedDeadMoney[i] ?? 0);
    return {
      year: startYear + i,
      committed,
      deadMoney,
      capLimit,
      space: capLimit - committed - deadMoney,
      playersUnderContract: rows.filter((p) => Number(p.contractYears ?? 0) > i).length,
    };
  });
}

/** The delta between two projections, season by season. For comparing a
 *  saved scenario against the current books, or against another scenario. */
export function diff(base: CapYear[], other: CapYear[]): Array<{ year: number; space: number }> {
  return base.map((b, i) => ({ year: b.year, space: (other[i]?.space ?? 0) - b.space }));
}

export type { DeadMoneyAdjustment };
export { aggregateDeadMoney };
