/**
 * Ask the History: the engine computes every answer from league-history.json,
 * and the model loop only ever shows rows the engine produced.
 */
import { describe, expect, it } from 'vitest';
import theleague from '../data/theleague/derived/league-history.json';
import afl from '../data/afl-fantasy/derived/league-history.json';
import theleaguePlayers from '../data/theleague/derived/league-history-players.json';
import aflPlayers from '../data/afl-fantasy/derived/league-history-players.json';
import theleagueMoves from '../data/theleague/derived/league-history-moves.json';
import aflMoves from '../data/afl-fantasy/derived/league-history-moves.json';
import { QueryError, dataAsOf, describeAsOf, runQuery, normalizeQuery } from '../src/utils/league-history/ask-query.mjs';
import { askHistory } from '../src/utils/league-history/ask';
import { recordBook } from '../src/utils/league-history/records.mjs';
import { describeMissingWeeks } from '../src/utils/league-history/ask-players.mjs';
import { gapChart, historyChart } from '../src/utils/league-history/record-charts.mjs';

const TL = { history: theleague, players: theleaguePlayers, moves: theleagueMoves };
const AFL = { history: afl, players: aflPlayers, moves: aflMoves };

const nineOne = {
  unit: 'seasons',
  throughGames: 10,
  where: [
    { field: 'w', op: 'eq', value: 9 },
    { field: 'l', op: 'eq', value: 1 },
  ],
  sort: [{ field: 'pf', dir: 'asc' }],
};

describe('runQuery', () => {
  it.each([
    ['theleague', theleague],
    ['afl-fantasy', afl],
  ])('answers "started 9-1 with the fewest points" from the first ten games (%s)', (_slug, ds) => {
    const r = runQuery(ds, nineOne);
    expect(r.total).toBeGreaterThan(0);
    const pfCol = r.columns.findIndex((c) => c.key === 'pf');
    const pfs = r.rows.map((row) => row.cells[pfCol] as number);
    expect(pfs).toEqual([...pfs].sort((a, b) => a - b));
    for (const row of r.rows) {
      expect(row.cells[r.columns.findIndex((c) => c.key === 'w')]).toBe(9);
      expect(row.cells[r.columns.findIndex((c) => c.key === 'l')]).toBe(1);
    }
    expect(r.description).toContain('first 10 regular-season games');
  });

  it('counts a full season the same as the official standings row', () => {
    const r = runQuery(theleague, { unit: 'seasons', where: [{ field: 'complete', op: 'eq', value: true }], columns: ['w', 'l', 't', 'finalW', 'finalL', 'finalT'], limit: 25 });
    for (const row of r.rows) expect(row.cells.slice(0, 3)).toEqual(row.cells.slice(3));
  });

  it('agrees with the Record Book on titles', () => {
    const r = runQuery(theleague, { unit: 'owners', summarize: ['titles'] });
    expect(r.summary.titles!.sum).toBe(theleague.seasons.filter((s: { done: number }) => s.done).length);
    expect(recordBook(theleague).facts().seasons).toBeGreaterThan(0);
  });

  it('leaves consolation games out unless asked for by kind', () => {
    const all = runQuery(afl, { unit: 'games', limit: 1 });
    const consolation = runQuery(afl, { unit: 'games', where: [{ field: 'kind', op: 'eq', value: 'consolation' }], limit: 1 });
    expect(consolation.total).toBeGreaterThan(0);
    const kinds = runQuery(afl, { unit: 'games', limit: 25, columns: ['kind'], sort: [{ field: 'kind', dir: 'asc' }] });
    expect(kinds.rows.every((row) => row.cells[0] !== 'consolation')).toBe(true);
    expect(all.description).toContain('consolation games excluded');
  });

  it('rejects a field the unit does not have, with a message the model can act on', () => {
    expect(() => normalizeQuery({ unit: 'games', where: [{ field: 'titles', op: 'gt', value: 1 }] })).toThrow(QueryError);
    expect(() => normalizeQuery({ unit: 'nope' })).toThrow(/unit must be/);
  });

  it('caps rows but keeps the full total', () => {
    const r = runQuery(theleague, { unit: 'games', limit: 500 });
    expect(r.rows.length).toBe(25);
    expect(r.total).toBeGreaterThan(1000);
  });
});

describe('dataAsOf', () => {
  it('names the last final week of a season still being played, and nothing once it is complete', () => {
    const ds = {
      seasons: [{ y: 2025, done: 1, teams: {} }, { y: 2026, done: 0, teams: {} }],
      games: [[2025, 14, 'a', 1, 'b', 0, 0], [2026, 5, 'a', 1, 'b', 0, 0], [2026, 6, 'a', 1, 'b', 0, 0]],
    };
    expect(dataAsOf(ds)).toEqual({ year: 2026, week: 6, inProgress: true });
    expect(describeAsOf(dataAsOf(ds))).toContain('2026 Week 6');
    expect(describeAsOf(dataAsOf({ ...ds, seasons: [{ y: 2025, done: 1, teams: {} }] }))).toBe('');
  });

  it('keeps an in-progress team out of a "first N games" window until N games are final', () => {
    const latest = theleague.seasons.at(-1)!;
    const r = runQuery(theleague, { unit: 'seasons', throughGames: 30, where: [{ field: 'year', op: 'eq', value: latest.y }] });
    if (!latest.done) expect(r.total).toBe(0);
  });
});

describe('player units', () => {
  const qbPlayoff = {
    unit: 'playerWeeks',
    where: [
      { field: 'kind', op: 'eq', value: 'playoffs' },
      { field: 'position', op: 'eq', value: 'QB' },
    ],
    sort: [{ field: 'score', dir: 'desc' }],
  };

  it('answers player questions only when given the player data', () => {
    expect(() => runQuery(theleague, qbPlayoff)).toThrow(QueryError);
    const r = runQuery(theleague, qbPlayoff, { players: theleaguePlayers });
    expect(r.total).toBeGreaterThan(0);
    expect(r.description).toContain('starters only');
  });

  it('counts starters in regular and playoff weeks by default, like the team record', () => {
    const r = runQuery(afl, { unit: 'playerWeeks', columns: ['started', 'kind'], limit: 25, sort: [{ field: 'kind', dir: 'asc' }] }, { players: aflPlayers });
    for (const row of r.rows) {
      expect(row.cells[0]).toBe(true);
      expect(['regular', 'playoffs']).toContain(row.cells[1]);
    }
    const bench = runQuery(afl, { unit: 'playerWeeks', where: [{ field: 'started', op: 'eq', value: false }], limit: 1 }, { players: aflPlayers });
    expect(bench.total).toBeGreaterThan(0);
  });

  it("a player-season's points add up from his starting weeks", () => {
    const top = runQuery(theleague, { unit: 'playerSeasons', sort: [{ field: 'points', dir: 'desc' }], limit: 1, columns: ['year', 'player', 'team', 'points', 'starts'] }, { players: theleaguePlayers });
    const [year, player, team, points, starts] = top.rows[0].cells as [number, string, string, number, number];
    const weeks = runQuery(
      theleague,
      {
        unit: 'playerWeeks',
        years: { from: year, to: year },
        where: [{ field: 'player', op: 'eq', value: player }, { field: 'team', op: 'eq', value: team }, { field: 'kind', op: 'eq', value: 'regular' }],
        summarize: ['score'],
      },
      { players: theleaguePlayers },
    );
    expect(weeks.total).toBe(starts);
    expect(weeks.summary.score!.sum).toBeCloseTo(points, 1);
  });

  it("says which of the AFL's weeks have no player scores", () => {
    expect(describeMissingWeeks(aflPlayers.missingWeeks)).toMatch(/^Player scores are missing for 2007/);
    expect(describeMissingWeeks({})).toBe('');
    expect(describeMissingWeeks({ 2010: [1, 2, 3, 5], 2011: [1, 2, 3, 5] })).toBe('Player scores are missing for 2010-2011 Weeks 1-3, 5');
  });
});

describe('move units', () => {
  it('shows each trade from both sides, the net mirrored', () => {
    const r = runQuery(theleague, { unit: 'trades', sort: [{ field: 'pointsNet', dir: 'desc' }], limit: 1, columns: ['date', 'team', 'partner', 'pointsNet'] }, TL);
    expect(r.total).toBe(theleagueMoves.trades.length * 2);
    const [date, team, partner, net] = r.rows[0].cells as [string, string, string, number];
    const other = runQuery(
      theleague,
      { unit: 'trades', where: [{ field: 'date', op: 'eq', value: date }, { field: 'team', op: 'eq', value: partner }, { field: 'partner', op: 'eq', value: team }], columns: ['pointsNet'] },
      TL,
    );
    expect(other.rows.map((row) => row.cells[0])).toContain(-net);
  });

  it("counts a pickup's points only from the week he was added", () => {
    const r = runQuery(afl, { unit: 'pickups', where: [{ field: 'week', op: 'gte', value: 5 }], sort: [{ field: 'pointsAfter', dir: 'desc' }], limit: 1, columns: ['year', 'week', 'player', 'team', 'pointsAfter'] }, AFL);
    const [year, week, player, team, after] = r.rows[0].cells as [number, number, string, string, number];
    const weeks = runQuery(
      afl,
      { unit: 'playerWeeks', years: { from: year, to: year }, where: [{ field: 'player', op: 'eq', value: player }, { field: 'team', op: 'eq', value: team }, { field: 'week', op: 'gte', value: week }], summarize: ['score'] },
      AFL,
    );
    expect(weeks.summary.score!.sum).toBeCloseTo(after, 1);
  });

  it('numbers draft picks by the picks actually made, and names TheLeague auction salaries in dollars', () => {
    const first = runQuery(theleague, { unit: 'draftPicks', where: [{ field: 'round', op: 'eq', value: 2 }, { field: 'pick', op: 'eq', value: 1 }], columns: ['year', 'overall'], limit: 25 }, TL);
    const roundOne = (year: number) => theleagueMoves.drafts.filter((d: unknown[]) => d[0] === year && d[2] === 1).length;
    for (const row of first.rows) expect(row.cells[1]).toBe(roundOne(row.cells[0] as number) + 1);
    const auction = runQuery(theleague, { unit: 'auctions', sort: [{ field: 'salary', dir: 'desc' }], limit: 1, columns: ['salary'] }, TL);
    expect(auction.rows[0].cells[0]).toBeGreaterThan(1_000_000);
    expect(() => runQuery(theleague, { unit: 'trades' })).toThrow(QueryError);
  });
});

describe('charts', () => {
  it('turns a ranked query into a board the Record Book charts can draw', () => {
    const r = runQuery(theleague, { ...nineOne, chart: 'pf' });
    expect(r.chart!.asc).toBe(true);
    expect(r.chart!.rows[0].value).toBe(r.rows[0].cells[r.columns.findIndex((c) => c.key === 'pf')]);
    expect(r.chart!.population).toHaveLength(r.total);
    expect(gapChart(r.chart, 400)!.svg).toContain('<svg');
    expect(historyChart(r.chart, 400)!.take).toMatch(/lowered/);
  });

  it('thins a huge population but keeps the top ten and the record progression', () => {
    const r = runQuery(theleague, { unit: 'playerWeeks', sort: [{ field: 'score', dir: 'desc' }], chart: 'score' }, { players: theleaguePlayers });
    expect(r.total).toBeGreaterThan(10000);
    expect(r.chart!.population.length).toBeLessThanOrEqual(1600);
    const values = r.chart!.population.map((p) => p[0]);
    expect(Math.max(...(values as number[]))).toBe(r.chart!.rows[0].value);
  });

  it('refuses to chart a field that is not a number', () => {
    expect(() => normalizeQuery({ unit: 'seasons', chart: 'team' })).toThrow(QueryError);
  });
});

describe('askHistory', () => {
  /** A scripted model: one query, then an answer pointing at it. */
  function scripted(turns: Array<Array<Record<string, unknown>>>) {
    const seen: any[] = [];
    let i = 0;
    return {
      seen,
      client: {
        messages: {
          create: async (body: any) => {
            seen.push(body);
            return { content: turns[i++] ?? [] };
          },
        },
      },
    };
  }

  it('shows the rows our engine computed, not the model', async () => {
    const { client, seen } = scripted([
      [{ type: 'tool_use', id: 't1', name: 'run_query', input: nineOne }],
      [{ type: 'tool_use', id: 't2', name: 'answer', input: { answer: 'Yes.', show: 0 } }],
    ]);
    const res = await askHistory('theleague', TL, 'started 9-1 with fewer points?', { client });
    expect(res.answer).toBe('Yes.');
    expect(res.table).toEqual(expect.objectContaining({ total: runQuery(theleague, nineOne).total }));
    expect(res.steps).toHaveLength(1);
    // The tool result handed back to the model is the engine's output.
    const toolResult = seen[1].messages.at(-1).content[0];
    expect(JSON.parse(toolResult.content).total).toBe(res.table!.total);
  });

  it('hands a bad query back to the model as an error instead of failing', async () => {
    const { client, seen } = scripted([
      [{ type: 'tool_use', id: 't1', name: 'run_query', input: { unit: 'games', where: [{ field: 'titles', op: 'gt', value: 1 }] } }],
      [{ type: 'tool_use', id: 't2', name: 'answer', input: { answer: 'Cannot tell.', show: -1 } }],
    ]);
    const res = await askHistory('afl-fantasy', AFL, 'q', { client });
    expect(seen[1].messages.at(-1).content[0].is_error).toBe(true);
    expect(res.table).toBeNull();
  });

  it('reads the Record Book and links only boards that exist', async () => {
    const board = recordBook(theleague).category('season')[0];
    const { client, seen } = scripted([
      [
        { type: 'tool_use', id: 't1', name: 'record_book', input: { category: 'season' } },
        { type: 'tool_use', id: 't2', name: 'calc', input: { op: 'divide', a: 10, b: 4 } },
      ],
      [
        {
          type: 'tool_use',
          id: 't3',
          name: 'answer',
          input: { answer: 'It is the record.', show: -1, records: [{ category: 'season', board: board.id }, { category: 'season', board: 'made-up' }] },
        },
      ],
    ]);
    const res = await askHistory('theleague', TL, 'q', { client });
    const [book, calc] = seen[1].messages.at(-1).content;
    expect(JSON.parse(book.content)[0]).toEqual(expect.objectContaining({ board: board.id, title: board.title }));
    expect(JSON.parse(calc.content)).toEqual({ result: 2.5 });
    expect(res.records).toEqual([expect.objectContaining({ title: board.title, query: `cat=season&board=${board.id}` })]);
  });

  it('throws rather than guessing when the model never answers', async () => {
    const { client } = scripted([]);
    await expect(askHistory('theleague', TL, 'q', { client })).rejects.toThrow();
  });
});
