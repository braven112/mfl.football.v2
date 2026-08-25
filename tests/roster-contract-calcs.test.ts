/**
 * Guard tests for the contract math extracted out of rosters.astro's inline
 * script (`src/utils/roster-contract-calcs.ts`).
 *
 * The point of these is behavioral equivalence, not novelty: every expectation
 * below is the arithmetic the untyped inline copies produced before the
 * extraction, so a future edit that "tidies" one of these functions has to
 * break a test rather than a roster page.
 *
 * The other half of the contract is that these are NOT the same functions as
 * the same-named exports in salary-calculations.ts — those read the raw MFL
 * averages payload, these read the flattened per-season shape the page
 * serializes into #roster-config. The last describe() block pins that
 * difference so nobody "dedupes" the two into one broken helper.
 */
import { describe, it, expect } from 'vitest';
import {
  ESCALATION_RATE,
  formatSalaryCompact,
  formatCurrency,
  getReferenceSalary,
  calculateFranchiseTag,
  calculateTeamOption,
  calculateVeteranExtension,
  calculateCutPenalty,
  type SalaryAveragesBySeason,
} from '../src/utils/roster-contract-calcs';
import * as serverSalary from '../src/utils/salary-calculations';

/** The flattened shape the page puts on `config.salaryAverages`. */
const AVERAGES: SalaryAveragesBySeason = {
  '2026': {
    franchiseSalaries: { QB: 9_000_000, RB: 4_000_000 },
    extensionSalaries: { QB: 7_000_000, RB: 3_000_000 },
    teamOptionSalaries: { QB: 5_000_000, RB: 2_000_000 },
  },
};

describe('formatSalaryCompact', () => {
  it('renders millions to two decimals and thousands whole', () => {
    expect(formatSalaryCompact(12_340_000)).toBe('$12.34M');
    expect(formatSalaryCompact(1_000_000)).toBe('$1.00M');
    expect(formatSalaryCompact(450_000)).toBe('$450K');
    expect(formatSalaryCompact(1_000)).toBe('$1K');
  });

  it('renders sub-thousand values with separators', () => {
    expect(formatSalaryCompact(999)).toBe('$999');
  });

  it('collapses zero and every non-numeric input to $0', () => {
    // The inline original ran everything through Number() first, so a numeric
    // string is a salary and anything else is zero.
    expect(formatSalaryCompact(0)).toBe('$0');
    expect(formatSalaryCompact(null)).toBe('$0');
    expect(formatSalaryCompact(undefined)).toBe('$0');
    expect(formatSalaryCompact('not a number')).toBe('$0');
    expect(formatSalaryCompact('2500000')).toBe('$2.50M');
  });
});

describe('formatCurrency', () => {
  it('rounds to whole dollars', () => {
    expect(formatCurrency(1_234_567.89)).toBe('$1,234,568');
    expect(formatCurrency(0)).toBe('$0');
  });

  it('guards non-finite input, which formatters.ts#formatCurrency does not', () => {
    // This guard is the entire reason this function is not the shared one:
    // Intl would render "$NaN" into a roster cell.
    expect(formatCurrency(NaN)).toBe('$0');
    expect(formatCurrency(Infinity)).toBe('$0');
  });
});

describe('getReferenceSalary', () => {
  it('reads the right bucket per action type', () => {
    expect(getReferenceSalary('QB', 'franchise', '2026', AVERAGES)).toBe(9_000_000);
    expect(getReferenceSalary('QB', 'team-option', '2026', AVERAGES)).toBe(5_000_000);
    expect(getReferenceSalary('QB', 'extension', '2026', AVERAGES)).toBe(7_000_000);
  });

  it('returns 0 for an unknown season, position, or missing averages', () => {
    expect(getReferenceSalary('QB', 'franchise', '2099', AVERAGES)).toBe(0);
    expect(getReferenceSalary('TE', 'franchise', '2026', AVERAGES)).toBe(0);
    expect(getReferenceSalary('QB', 'franchise', '2026', undefined)).toBe(0);
  });
});

describe('calculateFranchiseTag', () => {
  it('takes the 20% raise when it beats the top-3 average', () => {
    // 10M * 1.2 = 12M > 9M positional average
    expect(calculateFranchiseTag(10_000_000, 'QB', '2026', AVERAGES)).toEqual({
      newSalary: 12_000_000,
      newYears: 1,
    });
  });

  it('takes the positional average when the raise falls short', () => {
    // 5M * 1.2 = 6M < 9M positional average
    expect(calculateFranchiseTag(5_000_000, 'QB', '2026', AVERAGES)).toEqual({
      newSalary: 9_000_000,
      newYears: 1,
    });
  });

  it('is always a one-year deal', () => {
    expect(calculateFranchiseTag(1, 'RB', '2026', AVERAGES).newYears).toBe(1);
  });
});

describe('calculateTeamOption', () => {
  it('prices purely off the top-10 average, ignoring current salary', () => {
    expect(calculateTeamOption('QB', '2026', AVERAGES)).toEqual({
      newSalary: 5_000_000,
      newYears: 1,
    });
    expect(calculateTeamOption('RB', '2026', AVERAGES)).toEqual({
      newSalary: 2_000_000,
      newYears: 1,
    });
  });

  it('is 0 when the season has no averages', () => {
    expect(calculateTeamOption('QB', '2099', AVERAGES).newSalary).toBe(0);
  });
});

describe('calculateVeteranExtension', () => {
  it('prorates the top-5 average over the whole new contract', () => {
    // (7M * 2) / (2 + 2) = 3.5M, + 4M current = 7.5M
    const result = calculateVeteranExtension(2, 'QB', '2026', 2, 4_000_000, AVERAGES);
    expect(result.newSalary).toBe(7_500_000);
    expect(result.newYears).toBe(4);
  });

  it('escalates every contract year by 10% off the new base', () => {
    const { salaryBreakdown } = calculateVeteranExtension(2, 'QB', '2026', 2, 4_000_000, AVERAGES);
    expect(Object.keys(salaryBreakdown)).toEqual(['year0', 'year1', 'year2', 'year3']);
    expect(salaryBreakdown.year0).toBe(7_500_000);
    expect(salaryBreakdown.year1).toBe(Math.round(7_500_000 * ESCALATION_RATE));
    expect(salaryBreakdown.year3).toBe(Math.round(7_500_000 * ESCALATION_RATE ** 3));
  });

  it('coerces string and nullish inputs the way the inline copy did', () => {
    // The page reads these off dataset attributes, so they arrive as strings.
    const fromStrings = calculateVeteranExtension('2', 'QB', '2026', '2', '4000000', AVERAGES);
    expect(fromStrings).toEqual(calculateVeteranExtension(2, 'QB', '2026', 2, 4_000_000, AVERAGES));

    const empty = calculateVeteranExtension(null, 'QB', '2026', null, null, AVERAGES);
    expect(empty).toEqual({ newSalary: 0, newYears: 0, salaryBreakdown: {} });
  });

  it('avoids dividing by zero when there are no years at all', () => {
    const result = calculateVeteranExtension(0, 'QB', '2026', 0, 1_000_000, AVERAGES);
    expect(result.newSalary).toBe(1_000_000);
    expect(result.salaryBreakdown).toEqual({});
  });
});

describe('calculateCutPenalty', () => {
  it('charges half the salary in the current season', () => {
    expect(calculateCutPenalty(1_000_000, 1)).toEqual({
      currentPenalty: 500_000,
      futurePenalty: 0,
      totalPenalty: 500_000,
    });
  });

  it('adds the years-remaining tail for multi-year deals', () => {
    expect(calculateCutPenalty(1_000_000, 2).futurePenalty).toBe(150_000);
    expect(calculateCutPenalty(1_000_000, 3).futurePenalty).toBe(250_000);
    expect(calculateCutPenalty(1_000_000, 4).futurePenalty).toBe(350_000);
    expect(calculateCutPenalty(1_000_000, 5).futurePenalty).toBe(450_000);
  });

  it('has no tail beyond the tabulated years', () => {
    expect(calculateCutPenalty(1_000_000, 6).futurePenalty).toBe(0);
  });

  it('matches the server-side calculator for every tabulated year', () => {
    for (let years = 1; years <= 5; years++) {
      expect(calculateCutPenalty(3_300_000, years)).toEqual(
        serverSalary.calculateCutPenalty(3_300_000, years),
      );
    }
  });
});

describe('these are deliberately not salary-calculations.ts', () => {
  it('reads the flattened averages shape, not the raw MFL positions payload', () => {
    // Same numbers, two shapes. The server has the raw payload; the client
    // only ever receives the flattened one. Feeding either helper the other's
    // shape yields 0, which is why the two must not be merged.
    const rawShape = { positions: { QB: { top3Average: 9_000_000 } } };

    expect(getReferenceSalary('QB', 'franchise', '2026', AVERAGES)).toBe(9_000_000);
    expect(serverSalary.getReferenceSalary('QB', 'franchise', rawShape)).toBe(9_000_000);

    expect(getReferenceSalary('QB', 'franchise', '2026', rawShape as never)).toBe(0);
    expect(serverSalary.getReferenceSalary('QB', 'franchise', AVERAGES['2026'])).toBe(0);
  });

  it('omits the server helper’s `basis` field, which no client call site reads', () => {
    expect(calculateFranchiseTag(10_000_000, 'QB', '2026', AVERAGES)).not.toHaveProperty('basis');
  });
});
