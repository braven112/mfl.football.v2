/**
 * Ask the History: the engine computes every answer from league-history.json,
 * and the model loop only ever shows rows the engine produced.
 */
import { describe, expect, it } from 'vitest';
import theleague from '../data/theleague/derived/league-history.json';
import afl from '../data/afl-fantasy/derived/league-history.json';
import { QueryError, dataAsOf, describeAsOf, runQuery, normalizeQuery } from '../src/utils/league-history/ask-query.mjs';
import { askHistory } from '../src/utils/league-history/ask';
import { recordBook } from '../src/utils/league-history/records.mjs';

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
    const res = await askHistory('theleague', theleague, 'started 9-1 with fewer points?', { client });
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
    const res = await askHistory('afl-fantasy', afl, 'q', { client });
    expect(seen[1].messages.at(-1).content[0].is_error).toBe(true);
    expect(res.table).toBeNull();
  });

  it('throws rather than guessing when the model never answers', async () => {
    const { client } = scripted([]);
    await expect(askHistory('theleague', theleague, 'q', { client })).rejects.toThrow();
  });
});
