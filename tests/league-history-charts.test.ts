import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatterFor, gapChart, historyChart, paceChart, spreadChart, ticks } from '../src/utils/league-history/record-charts.mjs';
import { paceSeries, recordBook } from '../src/utils/league-history/records.mjs';

/**
 * Record Book charts — the record's history line, the population each chart
 * reads, and the sentence under each chart (which states a number, so it has
 * to be the right one).
 */

const row = (rank: number, value: number, year: number | null, name = `Team ${rank}`, key = `own-${rank}`) => ({
  rank, value, display: value.toFixed(2), name, owner: null, context: `${year}`, year, entity: { key },
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

  it('never prints the same tick twice on a count axis', () => {
    expect(ticks(14.9, 16.1, 3, formatterFor('16').step)).toEqual([15, 16]);
  });

  it("draws the viewer's own results in their color and links every dot", () => {
    const b = board({
      rows: [row(1, 130, 2022, 'Team 1', 'own-a'), row(2, 120, 2020, 'Team 2', 'own-b')],
      population: [
        [130, 2022, 1, null, 'own-a'], [120, 2020, 1, null, 'own-b'], [90, 2021, 1, null, 'own-b'],
        [80, 2021, 2, null, 'own-c'], [70, 2022, 2, null, 'own-c'],
      ],
    });
    const opts = { mine: (k: string) => k === 'own-b', href: (r: { rank: number }) => `/x/${r.rank}` };
    const gap = gapChart(b, 400, opts)!.svg;
    expect(gap).toContain('<a href="/x/1">');
    expect(gap.match(/class="rbc-mine"/g)).toHaveLength(1);
    const hist = historyChart(b, 400, opts)!.svg;
    expect(hist).toContain('rbc-mine-cloud');
    expect(spreadChart(b, 400, opts)!.svg).toContain('Your best 120.00');
  });

  it("marks a season in progress where it is on pace to finish", () => {
    const b = board({
      rows: [row(1, 130, 2022), row(2, 120, 2020)],
      population: [[130, 2022, 1, null], [120, 2020, 1, null]],
    });
    const watch = [{ name: 'Pace Setters', year: 2023, projected: 140, display: '140.00' }];
    const svg = historyChart(b, 400, { watch })!.svg;
    expect(svg).toContain('class="rbc-watch"');
    expect(svg).toContain('Pace Setters · on pace for 140.00');
  });
});

describe('On pace chart', () => {
  const pace = {
    by: 'game' as const,
    full: 14,
    real: [[1, 1], [2, 2], [3, 2], [4, 3]],
    projected: [[4, 3], [14, 11]],
    record: [[1, 1], [14, 12]],
    name: 'Pacific <Pigskins>',
    display: '11 wins',
    recordValue: 12,
    recordDisplay: '12',
    recordLabel: 'Bring The Pain, 2010',
    color: 'var(--team-accent-0001)',
  };

  it('draws real solid, projected dashed, and names both numbers', () => {
    const c = paceChart(pace, 400)!;
    expect(c.svg).toContain('rbc-pace-real');
    expect(c.svg).toContain('rbc-pace-proj');
    expect(c.svg).toContain('Projected');
    expect(c.svg).toContain('Pace 11 wins');
    expect(c.svg).toContain('Record 12');
    expect(c.svg).toContain('Pacific &lt;Pigskins&gt;');
    expect(c.take).toBe('Pacific <Pigskins> has 3 after 4 games and is on pace for 11 wins; the record is 12 (Bring The Pain, 2010).');
  });

  it("leaves out a record holder's path that does not add up to the record", () => {
    expect(paceChart(pace, 400)!.svg).toContain('rbc-pace-record');
    expect(paceChart({ ...pace, record: [[1, 1], [13, 9]] }, 400)!.svg).not.toContain('rbc-pace-record');
  });

  it('builds the season so far from the game record (a live season)', () => {
    const ds = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'theleague', 'derived', 'league-history.json'), 'utf8'));
    const book = recordBook(ds);
    for (const [id, watches] of Object.entries(book.watch() as Record<string, any[]>)) {
      const s = paceSeries(book.ix, id, watches[0])!;
      expect(s.real.length).toBeGreaterThan(0);
      expect(s.projected[0]).toEqual(s.real.at(-1));
      expect(s.projected[1][1]).toBe(watches[0].projected);
    }
  });
});
