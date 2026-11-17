/**
 * Ask the History's career and pickup-impact units (ask-careers.mjs) and the
 * career timeline chart (record-charts.mjs careerChart). Synthetic cases pin
 * the drawing; the committed data pins the numbers in both leagues, including
 * the AFL's two conferences rostering the same player independently, and
 * re-checks every "win swung" against the game record itself.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import theleague from '../data/theleague/derived/league-history.json';
import afl from '../data/afl-fantasy/derived/league-history.json';
import theleaguePlayers from '../data/theleague/derived/league-history-players.json';
import aflPlayers from '../data/afl-fantasy/derived/league-history-players.json';
import theleagueMoves from '../data/theleague/derived/league-history-moves.json';
import aflMoves from '../data/afl-fantasy/derived/league-history-moves.json';
import aflKeepers from '../data/afl-fantasy/derived/keeper-history.json';
import aflPickTrades from '../data/afl-fantasy/derived/pick-trades.json';
import { runQuery, describeQuery, normalizeQuery, querySchema } from '../src/utils/league-history/ask-query.mjs';
import { compactSalaries } from '../src/utils/league-history/ask-careers.mjs';
import { careerChart } from '../src/utils/league-history/record-charts.mjs';
import { answerCharts } from '../src/utils/league-history/ask-format.mjs';

const salaryFiles = readdirSync('data/theleague').filter((f) => /^mfl-player-salaries-\d{4}\.json$/.test(f));
const salaries = compactSalaries(salaryFiles.map((f) => [f.slice(20, 24), JSON.parse(readFileSync(`data/theleague/${f}`, 'utf8'))]));

const TL = { players: theleaguePlayers, moves: theleagueMoves, salaries, league: 'theleague' };
const AFL = { players: aflPlayers, moves: aflMoves, keepers: aflKeepers, pickTrades: aflPickTrades, league: 'afl-fantasy' };
const LEAGUES = [
  ['theleague', theleague, TL],
  ['afl-fantasy', afl, AFL],
] as const;

const cell = (r: any, key: string, row = 0) => r.rows[row].cells[r.columns.findIndex((c: any) => c.key === key)];

describe('the career and pickup-impact units', () => {
  it('are in the model-facing schema, with a plain description', () => {
    const units = (querySchema().properties.unit as any).enum;
    expect(units).toContain('careers');
    expect(units).toContain('pickupImpact');
    expect(describeQuery(normalizeQuery({ unit: 'pickupImpact', sort: [{ field: 'winsSwung', dir: 'desc' }] }))).toMatch(/whole stint.*Wins swung \(highest first\)/);
  });

  it.each(LEAGUES)('add up a career from its stints, and its titles from the champions’ rosters (%s)', (_slug, ds, extra) => {
    const careers = runQuery(ds, { unit: 'careers', sort: [{ field: 'titles', dir: 'desc' }], limit: 5, columns: ['player', 'points', 'titles', 'stints'] }, extra);
    expect(careers.total).toBeGreaterThan(1000);
    for (const row of careers.rows) {
      const player = row.cells[0] as string;
      const stints = runQuery(ds, { unit: 'stints', where: [{ field: 'player', op: 'eq', value: player }], summarize: ['points'], limit: 1 }, extra);
      const titles = runQuery(ds, { unit: 'titleRosters', where: [{ field: 'player', op: 'eq', value: player }], limit: 1 }, extra);
      expect(stints.total).toBe(row.cells[3]);
      expect(stints.summary.points!.sum).toBeCloseTo(row.cells[1] as number, 1);
      expect(titles.total).toBe(row.cells[2]);
    }
  });

  it("follows Travis Kelce through TheLeague: drafted by Bring The Pain, five titles, his auction salaries", () => {
    const r = runQuery(theleague, { unit: 'careers', where: [{ field: 'player', op: 'eq', value: 'Travis Kelce' }], columns: ['path', 'arrivals', 'titleYears', 'salaries', 'salaryHigh'] }, TL);
    expect(r.total).toBe(1);
    expect(cell(r, 'path')).toMatch(/^Bring The Pain 2014-2015 \(draft → traded to Devil Dogs\) · Devil Dogs 2016-2017 \(trade → traded to Bring The Pain\)/);
    for (const y of ['2014 (Bring The Pain)', '2019 (Bring The Pain)', '2020 (Bring The Pain)', '2023 (Fire Ready Aim)', '2025 (Computer Jocks)']) expect(cell(r, 'titleYears')).toContain(y);
    // The bid wins in the season it was made; the season file covers the rest.
    expect(cell(r, 'salaries')).toContain('2022 Pacific Pigskins $13,500,000 (auction bid)');
    expect(cell(r, 'salaries')).toContain('2018 Bring The Pain $10,000,000');
    expect(cell(r, 'salaryHigh')).toBe(15525000);
  });

  it('keeps the AFL’s two conferences apart: one player, two teams at once', () => {
    const r = runQuery(afl, { unit: 'stints', where: [{ field: 'player', op: 'eq', value: 'Travis Kelce' }, { field: 'year', op: 'eq', value: 2014 }], columns: ['team', 'lastYear', 'acquired'], limit: 5 }, AFL);
    const teams = r.rows.map((row) => row.cells[0]);
    expect(teams).toEqual(expect.arrayContaining(['Titsburgh Feelers', 'Smokane FC']));
    const career = runQuery(afl, { unit: 'careers', where: [{ field: 'player', op: 'eq', value: 'Travis Kelce' }], columns: ['teams', 'salaries'] }, AFL);
    expect(cell(career, 'teams')).toBeGreaterThanOrEqual(4);
    // No contract league, no salaries.
    expect(cell(career, 'salaries')).toBeNull();
  });

  it.each(LEAGUES)('values a pickup over the whole stint, never less than its first season (%s)', (_slug, ds, extra) => {
    const r = runQuery(ds, { unit: 'pickupImpact', sort: [{ field: 'points', dir: 'desc' }], limit: 25, columns: ['points', 'pointsSeason', 'seasons', 'how', 'winsSwung', 'playoffWinsSwung'] }, extra);
    expect(r.total).toBeGreaterThan(1000);
    for (const row of r.rows) {
      expect(row.cells[0] as number).toBeGreaterThanOrEqual(row.cells[1] as number);
      expect(['waiver', 'free agent']).toContain(row.cells[3]);
      expect(row.cells[4] as number).toBeGreaterThanOrEqual(row.cells[5] as number);
    }
    // The top of the list stayed for more than the season he was added in.
    expect(r.rows[0].cells[2] as number).toBeGreaterThan(1);
  });

  it('pins the finished stints at the top of each league’s list', () => {
    const tl = runQuery(theleague, { unit: 'pickupImpact', where: [{ field: 'player', op: 'eq', value: 'Seattle Seahawks' }, { field: 'year', op: 'eq', value: 2011 }], columns: ['team', 'lastYear', 'points', 'winsSwung'] }, TL);
    expect(tl.rows[0].cells).toEqual(['Vitside Mafia', 2017, 872.05, 12]);
    const a = runQuery(afl, { unit: 'pickupImpact', where: [{ field: 'player', op: 'eq', value: 'Antonio Brown' }, { field: 'team', op: 'eq', value: 'Delirium Tremens' }], columns: ['year', 'lastYear', 'points', 'titleYears'] }, AFL);
    expect(a.rows[0].cells).toEqual([2011, 2019, 2084.7, '2011']);
  });

  it.each(LEAGUES)('swings only a win his points were bigger than, as the game record shows it (%s)', (_slug, ds, extra) => {
    const r = runQuery(ds, { unit: 'pickupImpact', sort: [{ field: 'winsSwung', dir: 'desc' }], limit: 3, columns: ['team', 'winsSwung', 'swungGames'] }, extra);
    for (const row of r.rows) {
      const games = String(row.cells[2]).split('; ');
      expect(games).toHaveLength(row.cells[1] as number);
      for (const g of games) {
        const m = /^(\d{4}) Wk (\d+)(?: \(playoffs\))?: won by ([\d.]+), he scored ([\d.]+)$/.exec(g)!;
        expect(m).toBeTruthy();
        const [year, week, margin, score] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
        expect(score).toBeGreaterThan(margin);
        const won = runQuery(ds, { unit: 'games', years: { from: year, to: year }, where: [{ field: 'week', op: 'eq', value: week }, { field: 'team', op: 'eq', value: row.cells[0] }, { field: 'result', op: 'eq', value: 'W' }], columns: ['margin'], limit: 5 }, extra);
        expect(won.rows.map((x) => (x.cells[0] as number).toFixed(2))).toContain(margin.toFixed(2));
      }
    }
  });
});

describe('the career timeline', () => {
  it.each(LEAGUES)('draws for a one-player answer and not for a ranking (%s)', (_slug, ds, extra) => {
    const one = runQuery(ds, { unit: 'stints', where: [{ field: 'player', op: 'eq', value: 'Travis Kelce' }] }, extra);
    expect(one.chart).toMatchObject({ kind: 'career', player: 'Travis Kelce' });
    const charts = answerCharts(one.chart, '/x');
    expect(charts).toHaveLength(1);
    expect(charts[0].title).toBe("Travis Kelce's path through the league");
    // Team colors come from the accent token (legible in both themes), set as a style.
    expect(charts[0].wide).toMatch(/style="fill:var\(--team-accent-\d{4}, var\(--history-gold\)\)"/);
    expect(charts[0].take).toMatch(/^Travis Kelce was rostered by \d+ teams over \d+ seasons here/);
    const many = runQuery(ds, { unit: 'careers', sort: [{ field: 'points', dir: 'desc' }], chart: 'points' }, extra);
    expect(many.chart).not.toHaveProperty('kind');
    expect(many.chart?.rows).toHaveLength(10);
  });

  it('draws one lane per team, segments in the team color, and escapes names', () => {
    const chart = {
      kind: 'career',
      player: 'A <B>',
      position: 'RB',
      first: 2019,
      last: 2021,
      lanes: [
        { team: 'Team <One>', owner: 'O', franchiseId: '0001', segments: [{ from: 2019, to: 2020.5, how: 'draft', ended: 'traded', years: '2019-2020', points: 300, starts: 20 }] },
        { team: 'Two', owner: 'P', franchiseId: 'bad id"', segments: [{ from: 2020.5, to: 2022, how: 'trade', ended: 'still rostered', years: '2020-2021', points: 200, starts: 14 }] },
      ],
      seasons: [
        { year: 2019, points: 150, playoffPoints: 0, parts: [{ lane: 0, points: 150 }], title: null },
        { year: 2020, points: 250, playoffPoints: 20, parts: [{ lane: 0, points: 150 }, { lane: 1, points: 100 }], title: 'Two' },
        { year: 2021, points: 100, playoffPoints: 0, parts: [{ lane: 1, points: 100 }], title: null },
      ],
      summary: { teams: 2, seasons: 3, points: 500, playoffPoints: 20, titles: 1, titleYears: '2020 (Two)' },
    };
    const out = careerChart(chart, 400)!;
    expect(out.svg).not.toContain('<B>');
    expect(out.svg).toContain('Team &lt;One&gt;');
    expect(out.svg.match(/class="rbc-seg"/g)).toHaveLength(2 + 4);
    expect(out.svg).toContain('var(--team-accent-0001');
    // An id unsafe in a CSS name falls back to the class color, never into the markup.
    expect(out.svg).not.toContain('bad id');
    expect(out.svg.match(/class="rbc-lead"/g)).toHaveLength(1);
    expect(out.take).toBe('A <B> was rostered by 2 teams over 3 seasons here and scored 500 starter points for them (20 in the playoffs); he started for 1 champion: 2020 (Two).');
    expect(careerChart({ ...chart, lanes: [] }, 400)).toBeNull();
  });
});
