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

/**
 * The shapes the `.mjs` helpers actually return, named once.
 *
 * `seasonShape`, `byeExposure` and `starterByeExposure` are imported through
 * `@ts-expect-error` (they are `.mjs`, shared with the node scripts), so TS
 * infers `{}` for their results and every `table[id]` lookup below becomes an
 * implicit-any index error. Casting once at each boundary keeps roughly a dozen
 * of those out of the type baseline instead of scattering casts through the
 * assertions.
 */
type ByeTable = Record<string, Record<string, number>>;
interface StarterResult {
  exposure: ByeTable;
  lineups: Record<string, Set<string>>;
}

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

describe('starterByeExposure degrades to the roster count on a short roster', () => {
  /**
   * The property that lets this model ship to both leagues with no per-league
   * branch, pinned on a FIXTURE rather than on a feed.
   *
   * It used to be exercised only by the live AFL rosters, on the reasoning that
   * they are keepers-only at reveal time. That reasoning expired the moment the
   * American League drafted (#662) and took the only coverage of this clause
   * with it — the model could have started inventing lineups for short rosters
   * and nothing deterministic would have said so. A fixture cannot drift into
   * the wrong shape halfway through a season.
   */
  const byes = { KCC: 6, BUF: 7, SFO: 9 };
  const playersJson = {
    players: {
      player: [
        { id: 'p1', position: 'QB', team: 'KCC' },
        { id: 'p2', position: 'RB', team: 'BUF' },
        { id: 'p3', position: 'WR', team: 'SFO' },
        { id: 'p4', position: 'TE', team: 'KCC' },
      ],
    },
  };
  const rankingSourcesJson = {
    sources: [{ players: [{ id: 'p1', rank: 1 }, { id: 'p2', rank: 2 }] }],
  };
  const run = (playerIds: string[]): StarterResult =>
    starterByeExposure({
      rostersJson: {
        rosters: {
          franchise: [{ id: '0001', player: playerIds.map((id) => ({ id, salary: '1' })) }],
        },
      },
      playersJson,
      rankingSourcesJson,
      byes,
      franchiseIds: ['0001'],
      starters: STARTERS,
    }) as StarterResult;

  it('starts every player when the roster cannot fill the nine slots', () => {
    // Four players, nine slots. Two of them are unranked by the single source,
    // which is the realistic case for a deep keeper — they must still start.
    const { lineups, exposure } = run(['p1', 'p2', 'p3', 'p4']);
    expect([...lineups['0001']].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    // Two on the KCC bye in week 6, one each in 7 and 9 — i.e. exactly the
    // whole-roster count, which is what "degrades to the old behaviour" means.
    expect(exposure['0001']).toEqual({ 6: 2, 7: 1, 9: 1 });
  });

  it('starts a short roster even when it overflows a position maximum', () => {
    // THE case the short-circuit actually exists for, and the one the previous
    // fixture missed. Six receivers, nine slots, and `WR` is capped at 4 — so
    // walking the normal slot-filling path would seat four of them and silently
    // drop two players who are, in reality, certain starters.
    //
    // Not hypothetical: deleting `if (byValue.length <= total) return ...` from
    // projectedStarters leaves every other fixture here green and fails only on
    // live AFL franchise 0014, which happens to hold 8 players that fit into 6
    // slots. That franchise stops being short the moment the National League
    // drafts, and then nothing deterministic covers this at all.
    const wrs = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
    const { lineups } = starterByeExposure({
      rostersJson: {
        rosters: { franchise: [{ id: '0001', player: wrs.map((id) => ({ id, salary: '1' })) }] },
      },
      playersJson: {
        players: { player: wrs.map((id) => ({ id, position: 'WR', team: 'KCC' })) },
      },
      rankingSourcesJson: { sources: [] },
      byes,
      franchiseIds: ['0001'],
      starters: STARTERS,
    }) as StarterResult;
    expect([...lineups['0001']].sort()).toEqual(wrs);
  });

  it('is unaffected by value ordering while the roster is short', () => {
    // No player can be cut, so the ranking sources cannot change the answer.
    // This is what makes the degenerate case safe to rely on: it does not
    // depend on the ranking feed being present or sane.
    const withSources = run(['p1', 'p2', 'p3', 'p4']).exposure['0001'];
    const withoutSources = (starterByeExposure({
      rostersJson: {
        rosters: {
          franchise: [
            { id: '0001', player: ['p1', 'p2', 'p3', 'p4'].map((id) => ({ id, salary: '1' })) },
          ],
        },
      },
      playersJson,
      rankingSourcesJson: { sources: [] },
      byes,
      franchiseIds: ['0001'],
      starters: STARTERS,
    } ) as StarterResult).exposure['0001'];
    expect(withoutSources).toEqual(withSources);
  });

  it('stops being a no-op the moment the roster outgrows the slots', () => {
    // The boundary the AFL crossed mid-season. Ten players, nine slots: one has
    // to be left out, so the count can no longer equal the whole roster.
    const many = Array.from({ length: 10 }, (_, i) => `q${i}`);
    const bigPlayers = {
      players: {
        player: many.map((id, i) => ({
          id,
          position: ['QB', 'RB', 'WR', 'TE', 'PK', 'Def'][i % 6],
          team: 'KCC',
        })),
      },
    };
    const { lineups } = starterByeExposure({
      rostersJson: {
        rosters: { franchise: [{ id: '0001', player: many.map((id) => ({ id, salary: '1' })) }] },
      },
      playersJson: bigPlayers,
      rankingSourcesJson,
      byes,
      franchiseIds: ['0001'],
      starters: STARTERS,
    }) as StarterResult;
    expect(lineups['0001'].size).toBe(9);
  });
});

describe('starterByeExposure against the real 2026 feeds', () => {
  const byes = require('../data/nfl/bye-weeks.json').seasons['2026'];
  const rankingSources = require('../data/ranking-sources/2026.json');

  /**
   * Typed at the boundary, once. `seasonShape` / `byeExposure` /
   * `starterByeExposure` are `.mjs` helpers imported through `@ts-expect-error`,
   * so everything they return lands here as `any` and every `table[id]` below
   * becomes an implicit-any index error. Naming the shapes in one place keeps
   * those out of the type baseline instead of scattering casts through the
   * assertions — `seasonShape` is nullable, hence the explicit throw.
   */
  interface Loaded {
    shape: { franchiseIds: string[]; meta: { starters: { count: string } } };
    rosterSize: Record<string, number>;
    roster: ByeTable;
    starter: StarterResult;
  }

  const load = (dir: string): Loaded => {
    const read = (f: string) => require(`../${dir}/mfl-feeds/2026/${f}.json`);
    const shape = seasonShape(read('league')) as Loaded['shape'] | null;
    if (!shape) throw new Error(`${dir}: seasonShape returned null`);
    const rosterSize: Record<string, number> = {};
    for (const f of read('rosters').rosters.franchise as { id: string; player?: unknown }[]) {
      rosterSize[f.id] = Array.isArray(f.player) ? f.player.length : f.player ? 1 : 0;
    }
    return {
      shape,
      rosterSize,
      roster: byeExposure(read('rosters'), read('players'), byes, shape.franchiseIds) as ByeTable,
      starter: starterByeExposure({
        rostersJson: read('rosters'),
        playersJson: read('players'),
        rankingSourcesJson: rankingSources,
        byes,
        franchiseIds: shape.franchiseIds,
        starters: shape.meta.starters,
      }) as StarterResult,
    };
  };

  /**
   * This replaces a test that asserted "the AFL is a no-op, because its rosters
   * are keepers only at reveal time" (skipped 2026-08-30, #662).
   *
   * That was a calendar fact asserted against a LIVE feed, and the calendar
   * moved. The AFL drafts by conference, and the split when it broke was exact:
   * all 12 American League franchises at a full 16, all 12 National League
   * franchises still at 7-8, against `starters.count = "9"`. So half the league
   * saturated its lineup and the "no-op" claim stopped being true — not because
   * anything regressed, but because the American League had drafted.
   *
   * Restoring the old assertion would just re-arm the bomb: it would pass again
   * only in the window before each year's drafts and fail for the rest of the
   * season. The degeneracy was never a property of the AFL — it is a property
   * of any roster too small to fill a lineup, which the AFL merely HAPPENS to
   * have at reveal time. So it is stated that way here, as a law that holds
   * pre-draft, mid-draft and post-draft, and checked against both leagues.
   *
   * Verified across the mid-draft split at the time of writing: 24/24 AFL
   * franchises and 16/16 League franchises satisfy both clauses, with the AFL
   * sitting on both sides of the cap simultaneously.
   */
  it.each(['data/afl-fantasy', 'data/theleague'])(
    '%s: the projected lineup is the roster, capped at the starter slots',
    (dir) => {
      const { shape, rosterSize, roster, starter } = load(dir);
      const count = Number(shape.meta.starters.count);

      for (const id of shape.franchiseIds) {
        const size = rosterSize[id];

        // The cap, from both sides: a full roster fills exactly the slots, and
        // a roster too small to fill them contributes every player it has.
        expect(starter.lineups[id].size, `franchise ${id} (roster ${size})`).toBe(
          Math.min(size, count)
        );

        // And the model is a no-op exactly when the lineup covers the whole
        // roster — never merely when the league is the AFL. This is the clause
        // that lets `starterByeExposure` ship to both leagues with no
        // per-league branch, so it is the one worth pinning.
        const isNoOp = starter.lineups[id].size === size;
        const exposure = expect(starter.exposure[id], `franchise ${id} (roster ${size})`);
        if (isNoOp) exposure.toEqual(roster[id]);
        else exposure.not.toEqual(roster[id]);
      }
    }
  );

  it('cuts The League’s exposure to the starting nine, unsaturating the signal', () => {
    // The per-franchise lineup size used to be asserted here too. It is covered
    // by the cap law above now, for both leagues at once — and stating it only
    // for The League carried the same latent calendar dependency that took the
    // AFL case down (#662): it reads as "these rosters are full", which is a
    // fact about a feed, not about the model. What is left is this test's own
    // point, which no other test makes.
    const { shape, roster, starter } = load('data/theleague');
    const sum = (t: ByeTable) =>
      shape.franchiseIds.reduce(
        (n, id) => n + Object.values(t[id] ?? {}).reduce((a, b) => a + Number(b), 0),
        0
      );
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
