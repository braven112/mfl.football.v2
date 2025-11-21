import { describe, it, expect } from 'vitest';

// Mirror waiver penalty rules
const futurePercentByYears: Record<number, number> = {
  1: 0,
  2: 0.15,
  3: 0.25,
  4: 0.35,
  5: 0.45,
};

const calcDeadMoney = (salary: number, yearsRemaining: number) => {
  const current = 0.5 * salary;
  const future = (futurePercentByYears[yearsRemaining] ?? 0) * salary;
  return { current, future };
};

const calcBucketCaps = ({
  active,
  practice,
  injured,
}: {
  active: Array<{ salary: number }>;
  practice: Array<{ salary: number }>;
  injured: Array<{ salary: number }>;
}) => {
  const sum = (arr: Array<{ salary: number }>) =>
    arr.reduce((s, p) => s + (p.salary ?? 0), 0);
  const activeCap = sum(active);
  const practiceCap = sum(practice) * 0.5; // 50% current
  const injuredCap = sum(injured) * 1.0; // 100% current per rule
  return { activeCap, practiceCap, injuredCap, total: activeCap + practiceCap + injuredCap };
};

describe('dead money rules', () => {
  it('applies 5-year waiver penalties (50% current, 45% next)', () => {
    const { current, future } = calcDeadMoney(1000000, 5);
    expect(current).toBe(500000);
    expect(future).toBe(450000);
  });

  it('applies 2-year waiver penalties (50% current, 15% next)', () => {
    const { current, future } = calcDeadMoney(800000, 2);
    expect(current).toBe(400000);
    expect(future).toBe(120000);
  });

  it('does not double count adjustments when multiple sources are present', () => {
    const adjustments = [
      { franchiseId: '0008', salary: 1000000, yearsRemaining: 5, yearOffset: 0 },
      { franchiseId: '0008', salary: 500000, yearsRemaining: 2, yearOffset: 0 },
    ];
    const agg = (franchiseId: string) =>
      [0, 1].map((idx) =>
        adjustments.reduce((sum, adj) => {
          if (adj.franchiseId !== franchiseId) return sum;
          const { current, future } = calcDeadMoney(adj.salary, adj.yearsRemaining);
          let total = sum;
          if (idx === adj.yearOffset) total += current;
          if (idx === adj.yearOffset + 1) total += future;
          return total;
        }, 0)
      );
    expect(agg('0008')).toEqual([500000 + 250000, 450000 + 75000]);
  });
});

describe('cap buckets', () => {
  it('uses 50% for practice and 100% for injured (current year)', () => {
    const caps = calcBucketCaps({
      active: [{ salary: 2000000 }],
      practice: [{ salary: 1000000 }],
      injured: [{ salary: 500000 }],
    });
    expect(caps.activeCap).toBe(2000000);
    expect(caps.practiceCap).toBe(500000);
    expect(caps.injuredCap).toBe(500000);
    expect(caps.total).toBe(3000000);
  });
});
