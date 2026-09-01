import { describe, it, expect } from 'vitest';
import {
  getCapPercent,
  normalizeBucket,
  calculateCapChargesWithActions,
  calculateBucketCaps,
  calculatePositionCaps,
  calculateCapEfficiency,
  calculateContractYearsMeta,
  ANNUAL_ESCALATION,
  type CapInclusionTable,
} from '../src/utils/salary-calculations';

/**
 * These numbers used to be unreachable without booting a browser — they were
 * closures inside a 7k-line inline script. Every case below is a rule from the
 * league constitution that previously had no test at all.
 */

// Mirrors the real shape: reduced current-year hit for practice/IR, full hit
// in future years.
const CAP_INCLUSION: CapInclusionTable = {
  ACTIVE: { current: 1, future: 1 },
  PRACTICE: { current: 0.5, future: 1 },
  INJURED: { current: 0.5, future: 1 },
};

const years = [0, 1, 2, 3];

function player(over: Record<string, unknown> = {}) {
  return { id: '1', position: 'QB', salary: 1000, contractYears: 3, displayTag: 'active', ...over };
}

describe('getCapPercent', () => {
  it('defaults to full inclusion for an unknown bucket', () => {
    expect(getCapPercent('SOMETHING', true, CAP_INCLUSION)).toBe(1);
    expect(getCapPercent('SOMETHING', false, CAP_INCLUSION)).toBe(1);
  });

  it('distinguishes current from future years', () => {
    expect(getCapPercent('PRACTICE', true, CAP_INCLUSION)).toBe(0.5);
    expect(getCapPercent('PRACTICE', false, CAP_INCLUSION)).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(getCapPercent('practice', true, CAP_INCLUSION)).toBe(0.5);
  });
});

describe('normalizeBucket', () => {
  it.each([
    ['PRACTICE SQUAD', 'PRACTICE'],
    ['practice', 'PRACTICE'],
    ['Injured Reserve', 'INJURED'],
    ['IR', 'INJURED'],
    ['ACTIVE', 'ACTIVE'],
    ['', 'ACTIVE'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeBucket({ displayTag: raw })).toBe(expected);
  });

  it('falls back to status when displayTag is absent', () => {
    expect(normalizeBucket({ status: 'PRACTICE SQUAD' })).toBe('PRACTICE');
  });

  it('prefers displayTag over status', () => {
    expect(normalizeBucket({ displayTag: 'active', status: 'IR' })).toBe('ACTIVE');
  });
});

describe('calculateCapCharges', () => {
  const ctx = { salaryYears: years, capInclusion: CAP_INCLUSION };

  it('escalates 10% a year and stops when the contract ends', () => {
    const charges = calculateCapChargesWithActions([player({ salary: 1000, contractYears: 3 })], ctx);
    expect(charges[0]).toBeCloseTo(1000, 6);
    expect(charges[1]).toBeCloseTo(1000 * ANNUAL_ESCALATION, 6);
    expect(charges[2]).toBeCloseTo(1000 * ANNUAL_ESCALATION ** 2, 6);
    expect(charges[3]).toBe(0); // contract is over
  });

  it('applies the reduced current-year percentage to practice squad only', () => {
    const rows = [player({ displayTag: 'practice', salary: 1000, contractYears: 2 })];
    const charges = calculateCapChargesWithActions(rows, ctx);
    expect(charges[0]).toBeCloseTo(500, 6); // 50% this year
    expect(charges[1]).toBeCloseTo(1000 * ANNUAL_ESCALATION, 6); // 100% next
  });

  it('excludes cut and traded players entirely', () => {
    const rows = [player({ id: 'a' }), player({ id: 'b' })];
    for (const type of ['cut', 'trade']) {
      const charges = calculateCapChargesWithActions(rows, {
        ...ctx,
        contractActions: { b: { type } },
      });
      expect(charges[0]).toBeCloseTo(1000, 6);
    }
  });

  it('lets a declaration override the player contract length', () => {
    const rows = [player({ id: 'a', contractYears: 1 })];
    const charges = calculateCapChargesWithActions(rows, {
      ...ctx,
      declarationsByPlayer: { a: { years: 3 } },
    });
    expect(charges[2]).toBeGreaterThan(0); // year 3 now covered
  });

  it('prefers an optimistic local declaration over the saved one', () => {
    const rows = [player({ id: 'a', contractYears: 1 })];
    const charges = calculateCapChargesWithActions(rows, {
      ...ctx,
      declarationsByPlayer: { a: { years: 4 } },
      localDeclarations: { a: { years: 1 } },
    });
    expect(charges[1]).toBe(0); // local says 1 year, so year 2 is empty
  });

  it('accepts requestedYears as the declaration alias', () => {
    const rows = [player({ id: 'a', contractYears: 1 })];
    const charges = calculateCapChargesWithActions(rows, {
      ...ctx,
      declarationsByPlayer: { a: { requestedYears: 2 } },
    });
    expect(charges[1]).toBeGreaterThan(0);
  });

  it("uses an extension's explicit breakdown instead of escalating", () => {
    const rows = [player({ id: 'a', salary: 1000, contractYears: 3 })];
    const charges = calculateCapChargesWithActions(rows, {
      ...ctx,
      contractActions: {
        a: { type: 'extension', salaryBreakdown: { year0: 500, year1: 600, year2: 700 } },
      },
    });
    expect(charges[0]).toBeCloseTo(500, 6);
    expect(charges[1]).toBeCloseTo(600, 6);
    expect(charges[2]).toBeCloseTo(700, 6);
  });

  it('adds franchise tags and team options at their UFA year, unescalated', () => {
    for (const type of ['franchise', 'team-option']) {
      const charges = calculateCapChargesWithActions([], {
        ...ctx,
        contractActions: { a: { type, ufaYearIndex: 2, newSalary: 9000 } },
      });
      expect(charges).toEqual([0, 0, 9000, 0]);
    }
  });

  it('returns one entry per configured salary year', () => {
    expect(calculateCapChargesWithActions([player()], { salaryYears: [0, 1] })).toHaveLength(2);
    expect(calculateCapChargesWithActions([player()], { salaryYears: years })).toHaveLength(4);
  });

  it('is empty-safe', () => {
    expect(calculateCapChargesWithActions([], ctx)).toEqual([0, 0, 0, 0]);
  });
});

describe('calculateBucketCaps', () => {
  it('splits salary and headcount across the three buckets', () => {
    const rows = [
      player({ id: '1', displayTag: 'active', salary: 100 }),
      player({ id: '2', displayTag: 'active', salary: 200 }),
      player({ id: '3', displayTag: 'practice', salary: 400 }),
      player({ id: '4', displayTag: 'injured', salary: 800 }),
    ];
    const caps = calculateBucketCaps(rows, CAP_INCLUSION);
    expect(caps.active).toBe(300);
    expect(caps.practice).toBe(200); // 400 at 50%
    expect(caps.injured).toBe(400); // 800 at 50%
    expect(caps.counts).toEqual({ active: 2, practice: 1, injured: 1 });
  });

  it('treats an unrecognized tag as active', () => {
    const caps = calculateBucketCaps([player({ displayTag: 'taxi', salary: 100 })], CAP_INCLUSION);
    expect(caps.counts.active).toBe(1);
  });

  it('is empty-safe', () => {
    expect(calculateBucketCaps([], CAP_INCLUSION)).toEqual({
      active: 0,
      practice: 0,
      injured: 0,
      counts: { active: 0, practice: 0, injured: 0 },
    });
  });
});

describe('calculatePositionCaps', () => {
  it('totals current-year spend per position', () => {
    const rows = [
      player({ position: 'QB', salary: 100 }),
      player({ position: 'qb', salary: 50 }), // case-insensitive
      player({ position: 'RB', salary: 25 }),
    ];
    expect(calculatePositionCaps(rows, CAP_INCLUSION)).toEqual({ QB: 150, RB: 25 });
  });

  it('excludes expired contracts', () => {
    const rows = [player({ position: 'QB', salary: 100, contractYears: 0 })];
    expect(calculatePositionCaps(rows, CAP_INCLUSION)).toEqual({});
  });

  it('applies the bucket percentage', () => {
    const rows = [player({ position: 'QB', salary: 100, displayTag: 'practice' })];
    expect(calculatePositionCaps(rows, CAP_INCLUSION)).toEqual({ QB: 50 });
  });

  it('buckets a missing position under UNK', () => {
    expect(calculatePositionCaps([player({ position: null, salary: 10 })], CAP_INCLUSION))
      .toEqual({ UNK: 10 });
  });
});

describe('calculateCapEfficiency', () => {
  it('reports dollars per point per position', () => {
    const rows = [
      player({ position: 'QB', salary: 100, points: 10 }),
      player({ position: 'QB', salary: 100, points: 10 }),
      player({ position: 'RB', salary: 90, points: 3 }),
    ];
    expect(calculateCapEfficiency(rows)).toEqual({ QB: 10, RB: 30 });
  });

  it('skips scoreless players rather than counting them as infinite cost', () => {
    const rows = [
      player({ position: 'QB', salary: 100, points: 10 }),
      player({ position: 'QB', salary: 500, points: 0 }),
    ];
    expect(calculateCapEfficiency(rows)).toEqual({ QB: 10 });
  });

  it('skips expired contracts', () => {
    expect(calculateCapEfficiency([player({ salary: 1, points: 1, contractYears: 0 })])).toEqual({});
  });
});

describe('calculateContractYearsMeta', () => {
  it('sums years and finds the longest contract', () => {
    const rows = [
      player({ contractYears: 1 }),
      player({ contractYears: 4 }),
      player({ contractYears: 2 }),
    ];
    expect(calculateContractYearsMeta(rows)).toEqual({
      contractYearsTotal: 7,
      longestContract: 4,
    });
  });

  it('never lets a negative contract subtract from the total', () => {
    const rows = [player({ contractYears: 3 }), player({ contractYears: -5 })];
    expect(calculateContractYearsMeta(rows).contractYearsTotal).toBe(3);
  });

  it('is empty-safe', () => {
    expect(calculateContractYearsMeta([])).toEqual({
      contractYearsTotal: 0,
      longestContract: 0,
    });
  });
});
