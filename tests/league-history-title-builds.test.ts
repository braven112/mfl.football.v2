/**
 * Ask the History's title-build layer (title-builds.mjs, ask-title-builds.mjs):
 * the trades that put starters on a champion, the acquisition mix of every
 * roster, and every trade followed forward over all seasons. Synthetic cases
 * pin the rules; the committed data pins the real 2019 answers in both
 * leagues, so a change to the stint or pick-chain layers that loses one of
 * them fails here.
 */
import { describe, expect, it } from 'vitest';
import theleague from '../data/theleague/derived/league-history.json';
import afl from '../data/afl-fantasy/derived/league-history.json';
import theleaguePlayers from '../data/theleague/derived/league-history-players.json';
import aflPlayers from '../data/afl-fantasy/derived/league-history-players.json';
import theleagueMoves from '../data/theleague/derived/league-history-moves.json';
import aflMoves from '../data/afl-fantasy/derived/league-history-moves.json';
import aflKeepers from '../data/afl-fantasy/derived/keeper-history.json';
import aflPickTrades from '../data/afl-fantasy/derived/pick-trades.json';
import { HOW, buildStints } from '../src/utils/league-history/stints.mjs';
import { buildPickChains } from '../src/utils/league-history/pick-chains.mjs';
import { MIX, buildMix, chainsByUse, starterIndex, titleTrades, tradeIndex, tradeOutcomes } from '../src/utils/league-history/title-builds.mjs';
import { runQuery } from '../src/utils/league-history/ask-query.mjs';
import { answerCharts } from '../src/utils/league-history/ask-format.mjs';
import { stackChart } from '../src/utils/league-history/title-build-charts.mjs';

const TL = { players: theleaguePlayers, moves: theleagueMoves, league: 'theleague' };
const AFL = { players: aflPlayers, moves: aflMoves, keepers: aflKeepers, pickTrades: aflPickTrades, league: 'afl-fantasy' };

const week = (year: number, w: number, franchiseId: string, pid: string, score = 10, playoff = false) => ({
  year,
  week: w,
  franchiseId,
  pid,
  started: true,
  counted: true,
  playoff,
  score,
});

describe('title-builds over a synthetic league', () => {
  // 0001 trades player 100 and a future 2020 2nd to 0002 for player 200;
  // 0002 drafts 300 with that pick and wins 2020 with 100 and 300 starting.
  const moves = {
    drafts: [
      [2019, 'LEAGUE', 1, 1, 1, '0001', '100', '2019-08-01', 0, null],
      [2019, 'LEAGUE', 1, 2, 2, '0002', '200', '2019-08-01', 0, null],
      [2020, 'LEAGUE', 2, 1, 3, '0002', '300', '2020-08-01', 0, '0001'],
      [2020, 'LEAGUE', 2, 2, 4, '0002', '400', '2020-08-01', 0, null],
    ],
    trades: [[2019, '2019-10-01', 5, '0001', '0002', '100,FP_0001_2020_2', '200']],
  };
  const presence = [
    week(2019, 6, '0002', '100', 20),
    week(2019, 6, '0001', '200', 5),
    week(2020, 1, '0002', '100', 30),
    week(2020, 15, '0002', '100', 12, true),
    week(2020, 1, '0002', '300', 8),
    week(2020, 1, '0002', '400', 6),
  ];
  const stints = buildStints({ presence, moves });
  const chains = buildPickChains(moves);
  const trades = tradeIndex(moves.trades);
  const starters = starterIndex(stints);

  it('links a starter to the trade that brought him and to the trade that brought his pick', () => {
    const rows = titleTrades([{ year: 2020, franchiseId: '0002' }], starters, chainsByUse(chains), trades);
    expect(rows).toHaveLength(1);
    const r: any = rows[0];
    expect(r.tradeId).toBe('2019-10-01:0001-0002');
    expect(r.players.map((p: any) => [p.pid, p.via]).sort()).toEqual([
      ['100', 'player'],
      ['300', 'pick'],
    ]);
    expect(r.points).toBe(50);
    expect(r.playoffPoints).toBe(12);
    expect(r.gave).toEqual(['200']);
    expect(r.rank).toBe(1);
  });

  it('sums a roster by how each starter arrived, carried-over players counted apart', () => {
    const mix = buildMix(starters.get('2020|0002'));
    expect(mix.starters).toBe(3);
    expect(mix.byHow[HOW.trade]).toEqual({ count: 1, points: 42 });
    expect(mix.byHow[HOW.draft]).toEqual({ count: 2, points: 14 });
    expect(mix.carried).toEqual({ count: 1, points: 42 });
    expect(Object.keys(mix.byHow)).toEqual(MIX);
  });

  it('follows every piece of a trade over all seasons, picks through to the player', () => {
    const finish = (y: number, f: string) => (y === 2020 && f === '0002' ? 'C' : null);
    const out = tradeOutcomes(stints, chains, trades, finish);
    const two = out.find((r: any) => r.franchiseId === '0002')!;
    const one = out.find((r: any) => r.franchiseId === '0001')!;
    expect(two.points).toBe(70); // 20 + 30 + 12 for 100, 8 for 300 (drafted with the pick)
    expect(two.titleYears).toEqual([2020]);
    expect(two.pieces.find((p: any) => p.kind === 'pick')?.status).toBe('used');
    expect(one.points).toBe(5);
    expect(two.net).toBe(65);
    expect(two.result).toBe('won');
    expect(one.result).toBe('lost');
  });
});

describe('the 2019 title trades in the committed data', () => {
  it("names every trade behind TheLeague's 2019 champion, Bring The Pain", () => {
    const r = runQuery(theleague, { unit: 'titleTrades', years: { from: 2019, to: 2019 }, columns: ['team', 'starters', 'gave', 'points', 'playoffPoints', 'rank', 'via'], limit: 25 }, TL);
    expect(new Set(r.rows.map((x) => x.cells[0]))).toEqual(new Set(['Bring The Pain']));
    const starters = r.rows.map((x) => String(x.cells[1])).join(' | ');
    for (const name of ['Travis Kelce', 'Zach Ertz', 'Melvin Gordon', 'Dede Westbrook', 'Duke Johnson']) expect(starters).toContain(name);
    // Ranked by title-season points, every row with what was given up.
    const pts = r.rows.map((x) => x.cells[3] as number);
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
    expect(r.rows.map((x) => x.cells[5])).toEqual(r.rows.map((_, i) => i + 1));
    for (const x of r.rows) expect(x.cells[2]).toBeTruthy();
    // Picks that came by trade count too: a drafted starter linked through his pick.
    expect(r.rows.some((x) => x.cells[6] === 'pick')).toBe(true);
    const kelce = r.rows.find((x) => String(x.cells[1]).startsWith('Travis Kelce'))!;
    expect(kelce.cells[3]).toBe(248.9);
    expect(kelce.cells[4]).toBe(46.6);
  });

  it("names Julio Jones's trade behind the AFL's 2019 champion, Computer Jocks", () => {
    const r = runQuery(afl, { unit: 'titleTrades', years: { from: 2019, to: 2019 }, columns: ['team', 'starters', 'tradeDate', 'partner'], limit: 25 }, AFL);
    expect(r.total).toBeGreaterThan(0);
    const julio = r.rows.find((x) => String(x.cells[1]).includes('Julio Jones'))!;
    expect(julio.cells[0]).toBe('Computer Jocks');
    expect(julio.cells[2]).toBe('2015-07-29');
    expect(julio.cells[3]).toBe('Avenging Amish');
  });

  it('draws the trades as a stacked bar, regular season and playoffs', () => {
    const r = runQuery(theleague, { unit: 'titleTrades', years: { from: 2019, to: 2019 } }, TL);
    const chart: any = r.chart;
    expect(chart.kind).toBe('stack');
    expect(chart.series.map((s: any) => s.label)).toEqual(['Regular season', 'Playoffs']);
    for (const b of chart.bars) expect(b.values[0] + b.values[1]).toBeCloseTo(Number(b.display.replace(/,/g, '')), 1);
    const [drawn] = answerCharts(chart, '/theleague');
    expect(drawn.wide).toContain('rbc-s1');
    expect(drawn.take).toMatch(/Bring The Pain/);
  });
});

describe('roster builds', () => {
  it.each([
    ['theleague', theleague, TL],
    ['afl-fantasy', afl, AFL],
  ])("splits every champion's starter points across the methods, unknown included (%s)", (_slug, ds, extra) => {
    const r = runQuery(ds, { unit: 'rosterBuilds', where: [{ field: 'champion', op: 'eq', value: true }], columns: ['year', 'points', ...['draft', 'trade', 'waiver', 'freeAgent', 'auction', 'commissioner', 'inherited', 'unknown'].map((k) => `${k}Points`)], limit: 25 }, extra);
    const champions = ds.seasons.filter((s: any) => s.done && Object.values(s.teams).some((t: any) => t.r === 'C')).length;
    expect(r.total).toBe(champions);
    for (const row of r.rows) {
      const parts = (row.cells.slice(2) as number[]).reduce((a, b) => a + b, 0);
      expect(parts).toBeCloseTo(row.cells[1] as number, 1);
    }
  });

  it('adds the average champion to a chart of contenders', () => {
    const r = runQuery(theleague, { unit: 'rosterBuilds', years: { from: 2019, to: 2019 }, sort: [{ field: 'rank', dir: 'asc' }], limit: 4 }, TL);
    const chart: any = r.chart;
    expect(chart.percent).toBe(true);
    expect(chart.bars.at(-1).name).toMatch(/^Avg\. champion/);
    expect(chart.series.at(-1).label).toBe('Unknown');
    expect(chart.series.at(-1).tone).toBe(0);
  });
});

describe('trade outcomes over every season', () => {
  it("credits Bring The Pain's 2018 Kelce trade with both of his titles there", () => {
    const r = runQuery(theleague, { unit: 'tradeOutcomes', where: [{ field: 'tradeId', op: 'eq', value: '2018-03-08:0014-0008' }, { field: 'team', op: 'eq', value: 'Bring The Pain' }], columns: ['got', 'points', 'titles', 'titleYears', 'result'] }, TL);
    expect(r.rows).toHaveLength(1);
    const [got, points, titles, years, result] = r.rows[0].cells;
    expect(got).toBe('Travis Kelce');
    expect(points as number).toBeGreaterThan(248.9);
    expect(titles).toBe(2);
    expect(years).toBe('2019, 2020');
    expect(result).toBe('won');
  });

  it('gives both sides of every trade, with nets that cancel', () => {
    const r = runQuery(afl, { unit: 'tradeOutcomes', groupBy: ['tradeId'], summarize: ['net'], limit: 25 }, AFL);
    expect(r.total).toBe(aflMoves.trades.length);
    for (const row of r.rows) expect(Math.abs(row.cells[2] as number)).toBeLessThan(0.02);
  });

  it('draws a valid stacked bar with escaped names', () => {
    const drawn = stackChart({ label: 'x', percent: false, series: [{ label: 'A', tone: 1 }, { label: 'B', tone: 2 }], bars: [{ name: '<b>', context: '', values: [3, 4], display: '7' }] }, 400);
    expect(drawn!.svg).toContain('&lt;b&gt;');
    expect(drawn!.svg).not.toContain('<b>');
  });
});
