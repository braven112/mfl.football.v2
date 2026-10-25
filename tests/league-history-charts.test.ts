import { describe, it, expect } from 'vitest';
import { formatterFor, gapChart, historyChart, spreadChart, ticks } from '../src/utils/league-history/record-charts.mjs';

/**
 * Record Book charts — the record's history line, the population each chart
 * reads, and the sentence under each chart (which states a number, so it has
 * to be the right one).
 */

const row = (rank: number, value: number, year: number | null, name = `Team ${rank}`) => ({
  rank, value, display: value.toFixed(2), name, owner: null, context: `${year}`, year,
});

const board = (opts: { asc?: boolean; rows: ReturnType<typeof row>[]; population: Array<Array<number | string | null>> }) =>
  ({ asc: false, ...opts });

describe('Record Book charts', () => {
  it('formats axes the way the board formats its values', () => {
    expect(formatterFor('.700')(0.65)).toBe('.650');
    expect(formatterFor('1,234.5')(10)).toBe('10.0');
    expect(formatterFor('+12.34')(3)).toBe('3.00');
    expect(formatterFor('16')(1500)).toBe('1,500');
    expect(ticks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('counts each time the record moved, in the order games were played', () => {
    // 2020: 100 then 120 (week 2), 2021: 110 (no), 2022: 130.
    const b = board({
      rows: [row(1, 130, 2022), row(2, 120, 2020), row(3, 110, 2021)],
      population: [[120, 2020, 2, null], [100, 2020, 1, null], [110, 2021, 1, null], [130, 2022, 3, null], [90, 2022, 1, null]],
    });
    const out = historyChart(b, 400)!;
    expect(out.take).toMatch(/raised 2 times since 2020 and has stood since 2022/);
  });

  it('runs the record downward on a fewest-is-best board', () => {
    const b = board({
      asc: true,
      rows: [row(1, 50, 2021), row(2, 60, 2020)],
      population: [[60, 2020, 1, null], [80, 2020, 2, null], [50, 2021, 1, null]],
    });
    expect(historyChart(b, 400)!.take).toMatch(/lowered 1 time since 2020/);
    expect(gapChart(b, 400)!.take).toMatch(/clear of #2|Tight at the top/);
  });

  it('plots a board with no seasons as one dot per entity', () => {
    const b = board({
      rows: [row(1, 3, null, 'Ann'), row(2, 2, null, 'Bea')],
      population: [[3, null, null, 'Ann'], [2, null, null, 'Bea'], [1, null, null, 'Cy']],
    });
    const out = historyChart(b, 400)!;
    expect(out.svg.match(/<circle/g)).toHaveLength(3);
    expect(out.take).toMatch(/^3 on this board/);
  });

  it('says how rare the top ten is against everything ranked', () => {
    const population = Array.from({ length: 1000 }, (_, i) => [i / 10, 2020, 1, null]);
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, 99.9 - i / 10, 2020));
    const out = spreadChart(board({ rows, population }), 400)!;
    expect(out.take).toMatch(/best 1\.0% of 1,000 results/);
  });

  it('escapes names in the drawing', () => {
    const b = board({ rows: [row(1, 2, 2020, '<b>&Co'), row(2, 1, 2020)], population: [[2, 2020, 1, null], [1, 2020, 1, null]] });
    expect(gapChart(b, 400)!.svg).toContain('&lt;b&gt;&amp;Co');
  });
});
