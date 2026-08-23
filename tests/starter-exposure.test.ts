/**
 * The projected-starter bye model. Its whole job is to tell weeks apart that
 * the whole-roster count cannot, so the tests are mostly about the two ends:
 * a full roster where the model does real work, and a keeper-only roster where
 * it must degrade to exactly the old behaviour rather than inventing a lineup.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error - .mjs helper shared with the node scripts
import { compositeValueRanks, projectedStarters, starterByeExposure } from '../src/utils/starter-exposure.mjs';
// @ts-expect-error - .mjs helper shared with the node scripts
import { byeExposure, seasonShape } from '../src/utils/schedule-plan.mjs';

const STARTERS = {
  count: '9',
  position: [
    { name: 'QB', limit: '1' },
    { name: 'RB', limit: '1-4' },
    { name: 'WR', limit: '1-4' },
    { name: 'TE', limit: '1-4' },
    { name: 'PK', limit: '1' },
    { name: 'Def', limit: '1' },
  ],
};

describe('compositeValueRanks', () => {
  it('normalises by source length so lists of different sizes compare', () => {
    // Rank 50 of 100 and rank 50 of 500 are not the same statement.
    const ranks = compositeValueRanks({
      sources: [
        { players: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, rank: i + 1 })) },
        { players: Array.from({ length: 500 }, (_, i) => ({ id: `b${i}`, rank: i + 1 })) },
      ],
    });
    expect(ranks['a49']).toBeCloseTo(0.5, 5);
    expect(ranks['b49']).toBeCloseTo(0.1, 5);
    expect(ranks['b49']).toBeLessThan(ranks['a49']);
  });

  it('averages a player listed by several sources', () => {
    const ranks = compositeValueRanks({
      sources: [
        { players: [{ id: 'x', rank: 1 }, { id: 'y', rank: 2 }] },
        { players: [{ id: 'x', rank: 2 }, { id: 'y', rank: 1 }] },
      ],
    });
    expect(ranks['x']).toBeCloseTo(ranks['y'], 10);
  });
});

describe('projectedStarters', () => {
  const pos: Record<string, string> = {};
  const value: Record<string, number> = {};
  // A deep, realistic roster: plenty of WRs, exactly one kicker and defence.
  const roster: string[] = [];
  let n = 0;
  for (const [p, count] of [['QB', 3], ['RB', 6], ['WR', 10], ['TE', 3], ['PK', 1], ['Def', 1]] as const) {
    for (let i = 0; i < count; i += 1) {
      const id = `${p}${i}`;
      pos[id] = p;
      value[id] = n++; // declaration order = value order
      roster.push(id);
    }
  }

  it('fills every position minimum before spending on the best available', () => {
    const picked = projectedStarters(roster, {
      positionOf: (id: string) => pos[id],
      valueOf: (id: string) => value[id],
      starters: STARTERS,
    });
    expect(picked.size).toBe(9);
    // A lineup without a kicker is not a lineup, however many good WRs you own
    // — and PK/Def are the LAST players by value here, so a naive best-9 would
    // drop them.
    expect(picked.has('PK0')).toBe(true);
    expect(picked.has('Def0')).toBe(true);
    expect(picked.has('QB0')).toBe(true);
  });

  it('respects a position maximum', () => {
    const picked = [...projectedStarters(roster, {
      positionOf: (id: string) => pos[id],
      valueOf: (id: string) => value[id],
      starters: STARTERS,
    })];
    expect(picked.filter((id) => pos[id] === 'WR').length).toBeLessThanOrEqual(4);
  });

  it('returns the whole roster when it cannot fill the slots', () => {
    // The AFL case: keepers only, fewer players than starter slots. Every one
    // of them starts, which is the true answer, not a degenerate one.
    const small = ['QB0', 'RB0', 'WR0'];
    const picked = projectedStarters(small, {
      positionOf: (id: string) => pos[id],
      valueOf: (id: string) => value[id],
      starters: STARTERS,
    });
    expect([...picked].sort()).toEqual(small.sort());
  });
});

describe('starterByeExposure against the real 2026 feeds', () => {
  const byes = require('../data/nfl/bye-weeks.json').seasons['2026'];
  const rankingSources = require('../data/ranking-sources/2026.json');

  const load = (dir: string) => {
    const read = (f: string) => require(`../${dir}/mfl-feeds/2026/${f}.json`);
    const shape = seasonShape(read('league'));
    return {
      shape,
      roster: byeExposure(read('rosters'), read('players'), byes, shape.franchiseIds),
      starter: starterByeExposure({
        rostersJson: read('rosters'),
        playersJson: read('players'),
        rankingSourcesJson: rankingSources,
        byes,
        franchiseIds: shape.franchiseIds,
        starters: shape.meta.starters,
      }),
    };
  };

  it('is a no-op for the AFL, whose rosters are keepers only at reveal time', () => {
    const { shape, roster, starter } = load('data/afl-fantasy');
    // Fewer keepers than starter slots, so every player starts and the two
    // counts must agree exactly. This is the property that lets the model ship
    // to both leagues with no per-league branch.
    for (const id of shape.franchiseIds) {
      expect(starter.lineups[id].size).toBeLessThan(Number(shape.meta.starters.count));
      expect(starter.exposure[id], `franchise ${id}`).toEqual(roster[id]);
    }
  });

  it('cuts The League’s exposure to the starting nine, unsaturating the signal', () => {
    const { shape, roster, starter } = load('data/theleague');
    for (const id of shape.franchiseIds) {
      expect(starter.lineups[id].size).toBe(Number(shape.meta.starters.count));
    }
    const sum = (t: any) =>
      shape.franchiseIds.reduce((n: number, id: string) =>
        n + Object.values(t[id] ?? {}).reduce((a: number, b: any) => a + Number(b), 0), 0);
    // Whole-roster counting saturates: nearly every team has SOMEBODY out every
    // bye week, so the optimiser has nothing to steer by.
    expect(sum(starter.exposure)).toBeLessThan(sum(roster) / 2);
  });

  it('never reports more starters out than the lineup holds', () => {
    for (const dir of ['data/afl-fantasy', 'data/theleague']) {
      const { shape, starter } = load(dir);
      for (const id of shape.franchiseIds) {
        for (const out of Object.values(starter.exposure[id] ?? {})) {
          expect(Number(out)).toBeLessThanOrEqual(starter.lineups[id].size);
        }
      }
    }
  });
});
