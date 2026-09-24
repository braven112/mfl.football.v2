/**
 * The phone sim surfaces' numbers (src/utils/rosters/sim-summary.ts): the
 * sim bar, the cap card and the Cap by year sheet.
 *
 * What matters here is that they are the SAME numbers the roster table
 * shows. `applySimActionsToRows` / `addSimDeadMoney` are the rules
 * `updateView` used inline, and it now calls them; the per-move effect is
 * priced by the page's own `calculateCapChargesWithActions`.
 */
import { describe, it, expect } from 'vitest';
import {
  addSimDeadMoney,
  applySimActionsToRows,
  buildCapByYear,
  formatSignedMoney,
  summarizeSimMoves,
  withoutSimRemoved,
  type SimActions,
  type SimRow,
} from '../src/utils/rosters/sim-summary';
import { calculateCapChargesWithActions } from '../src/utils/salary-calculations';

const YEARS = [2026, 2027, 2028, 2029, 2030];
const rows = [
  { id: '1', salary: 5_000_000, contractYears: 3, displayTag: 'active' },
  { id: '2', salary: 2_000_000, contractYears: 1, displayTag: 'active' },
];

const chargesFor = (r: SimRow[], acts: SimActions) =>
  calculateCapChargesWithActions(r, { salaryYears: YEARS, contractActions: acts });

describe('applySimActionsToRows', () => {
  it('keeps a cut or traded player (the table greys him out) and leaves a tag alone', () => {
    const out = applySimActionsToRows(rows, {
      '1': { type: 'cut' },
      '2': { type: 'franchise', newSalary: 9_000_000 },
    });
    expect(out).toEqual(rows);
  });

  it('rewrites salary and years for an extension', () => {
    const out = applySimActionsToRows(rows, { '2': { type: 'extension', newSalary: 3_000_000, newYears: 3 } });
    expect(out[1]).toMatchObject({ salary: 3_000_000, contractYears: 3 });
    expect(out[0]).toBe(rows[0]);
  });
});

describe('withoutSimRemoved', () => {
  it('drops simulated cuts and trades, keeps everyone else (the cap bar counts what stays)', () => {
    expect(withoutSimRemoved(rows, { '1': { type: 'cut' } }).map((r) => r.id)).toEqual(['2']);
    expect(withoutSimRemoved(rows, { '2': { type: 'extension' } })).toHaveLength(2);
  });
});

describe('addSimDeadMoney', () => {
  it('adds each simulated cut: 50% now, the rest next year', () => {
    expect(addSimDeadMoney([100, 0, 0], {
      a: { type: 'cut', currentPenalty: 50, futurePenalty: 20 },
      b: { type: 'trade' },
    })).toEqual([150, 20, 0]);
  });

  it('does not mutate the baseline it was given', () => {
    const base = [0, 0];
    addSimDeadMoney(base, { a: { type: 'cut', currentPenalty: 5 } });
    expect(base).toEqual([0, 0]);
  });

  it("charges only the viewed club's cuts when given its roster ids", () => {
    // contractActions survives a team switch; another club's cut is not ours.
    expect(addSimDeadMoney([0, 0], {
      mine: { type: 'cut', currentPenalty: 10, futurePenalty: 4 },
      theirs: { type: 'cut', currentPenalty: 99, futurePenalty: 99 },
    }, new Set(['mine']))).toEqual([10, 4]);
  });
});

describe('buildCapByYear', () => {
  it('reports space and its change against the unsimulated baseline, per year', () => {
    const years = buildCapByYear({
      years: [2026, 2027],
      capLimit: 45_000_000,
      charges: [40_000_000, 30_000_000],
      dead: [2_500_000, 1_000_000],
      baseCharges: [45_000_000, 35_000_000],
      baseDead: [0, 0],
    });
    expect(years[0]).toMatchObject({ year: '2026', space: 2_500_000, change: 2_500_000 });
    expect(years[1]).toMatchObject({ year: '2027', space: 14_000_000, change: 4_000_000 });
  });
});

describe('summarizeSimMoves', () => {
  it('prices a simulated cut as salary saved minus the dead money it creates', () => {
    const [move] = summarizeSimMoves({
      actions: {
        '1': { type: 'cut', playerName: 'Jackson, Lamar', playerPosition: 'QB', currentPenalty: 2_500_000, futurePenalty: 750_000 },
      },
      baseRows: rows,
      baseDead: [0, 0, 0, 0, 0],
      years: YEARS,
      chargesFor,
    });
    expect(move).toMatchObject({
      playerId: '1',
      label: 'Simulated cut',
      onRoster: true,
      effectYear: '2026',
      effect: 2_500_000,
    });
  });

  it('quotes a franchise tag in the year it is priced, not the current one', () => {
    const [move] = summarizeSimMoves({
      actions: { '2': { type: 'franchise', newSalary: 9_000_000, ufaYearIndex: 1 } },
      baseRows: rows,
      baseDead: [0, 0, 0, 0, 0],
      years: YEARS,
      chargesFor,
    });
    expect(move).toMatchObject({ effectYear: '2027', effect: -9_000_000 });
  });

  it('flags a move on a player who is not on the roster being viewed', () => {
    const [move] = summarizeSimMoves({
      actions: { '99': { type: 'trade', playerName: 'Elsewhere' } },
      baseRows: rows,
      baseDead: [0, 0, 0, 0, 0],
      years: YEARS,
      chargesFor,
    });
    expect(move.onRoster).toBe(false);
  });
});

describe('formatSignedMoney', () => {
  it('always carries the sign of a change', () => {
    expect(formatSignedMoney(847_000)).toBe('+$847,000');
    expect(formatSignedMoney(-120_000)).toBe('−$120,000');
    expect(formatSignedMoney(0.2)).toBe('$0');
  });
});
