/**
 * The Owners' Poll open/close passes and their chat copy
 * (scripts/lib/owners-poll-pass.mjs).
 *
 * The REST helper is mocked at scripts/lib/redis.mjs, one layer below the
 * poll's own store, so the key strings and the HGETALL parsing are exercised
 * for real rather than stubbed past.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const store = new Map<string, unknown>();
const hashes = new Map<string, Map<string, string>>();
let hasCredentials = true;

vi.mock('../scripts/lib/redis.mjs', () => ({
  getRedisConfig: () => (hasCredentials ? { url: 'https://fake', token: 't' } : null),
  redisCommand: async (_redis: unknown, args: unknown[]) => {
    const [cmd, key, ...rest] = args as [string, string, ...string[]];
    switch (cmd) {
      case 'SET':
        store.set(key, rest[0]);
        return 'OK';
      case 'GET':
        return store.get(key) ?? null;
      case 'DEL':
        store.delete(key);
        return 1;
      case 'HLEN':
        return hashes.get(key)?.size ?? 0;
      case 'HGETALL': {
        const h = hashes.get(key);
        if (!h) return null;
        // Upstash returns a FLAT array for HGETALL — the shape the parser
        // actually has to handle in production.
        return Array.from(h.entries()).flat();
      }
      default:
        throw new Error(`unmocked redis command ${cmd}`);
    }
  },
}));

const { LEAGUES } = await import('../src/config/leagues-data.mjs');
const {
  openPoll,
  closePoll,
  buildClosedPollBlock,
  SYNTHETIC_POLL_SOURCE,
  readTurnout,
  describeTurnoutFailure,
  buildRevealMessage,
  buildOpenLine,
  normalizeFranchiseIds,
} = await import('../scripts/lib/owners-poll-pass.mjs');
const { ownersPollBallotsKey, ownersPollCurrentKey } = await import(
  '../src/utils/owners-poll-ballot.mjs'
);

const LEAGUE = LEAGUES.theleague;
const FIELD = Array.from({ length: 16 }, (_, i) => String(i + 1).padStart(4, '0'));
const SLOTS = 7;
const silent = { log: () => {}, warn: () => {} };

function seedWindow(overrides: Record<string, unknown> = {}) {
  const window = {
    year: 2026,
    week: 5,
    opensAt: '2026-09-08T14:00:00.000Z',
    closesAt: '2026-09-10T01:00:00.000Z',
    slots: SLOTS,
    eligibleFranchiseIds: FIELD,
    ...overrides,
  };
  store.set(ownersPollCurrentKey(LEAGUE.navSlug), JSON.stringify(window));
  return window;
}

function seedBallots(count: number, year = 2026, week = 5) {
  const h = new Map<string, string>();
  for (let i = 0; i < count; i += 1) {
    const franchiseId = FIELD[i];
    // Everyone ranks the same seven, rotated by voter, so points spread.
    const ranking = Array.from({ length: SLOTS }, (_, k) => FIELD[(i + k) % FIELD.length]);
    h.set(franchiseId, JSON.stringify({ franchiseId, ranking, submittedAt: null, updatedAt: null }));
  }
  hashes.set(ownersPollBallotsKey(LEAGUE.navSlug, year, week), h);
  return h;
}

const composite = Object.fromEntries(FIELD.map((fid, i) => [fid, i + 1]));
const issue = (over: Record<string, unknown> = {}) => ({ year: 2026, week: 5, ...over });

beforeEach(() => {
  store.clear();
  hashes.clear();
  hasCredentials = true;
});

describe('openPoll', () => {
  it('writes the window pointer and returns the issue block', async () => {
    const block = await openPoll({
      league: LEAGUE,
      year: 2026,
      week: 5,
      eligibleFranchiseIds: FIELD,
      now: new Date('2026-09-08T14:00:00Z'),
      log: silent,
    });

    expect(block).toMatchObject({ status: 'open', slots: 7, quorum: 8, eligibleVoters: 16 });
    const stored = JSON.parse(store.get(ownersPollCurrentKey(LEAGUE.navSlug)) as string);
    expect(stored).toMatchObject({ year: 2026, week: 5, slots: 7 });
    expect(stored.eligibleFranchiseIds).toHaveLength(16);
  });

  it('degrades to no-poll rather than failing the column when Redis is absent', async () => {
    // The column is the product; the poll is a section of it. Failing the run
    // over storage trades a working column for a missing one.
    hasCredentials = false;
    const block = await openPoll({
      league: LEAGUE,
      year: 2026,
      week: 5,
      eligibleFranchiseIds: FIELD,
      log: silent,
    });
    expect(block).toBeNull();
  });

  it('refuses to open when the field is not bigger than the ballot depth', async () => {
    const block = await openPoll({
      league: LEAGUE,
      year: 2026,
      week: 5,
      eligibleFranchiseIds: FIELD.slice(0, SLOTS),
      log: silent,
    });
    expect(block).toBeNull();
    expect(store.size).toBe(0);
  });

  it('returns null for a league that does not run the poll', async () => {
    // Best Ball, not the AFL — the AFL runs the poll as of Sep 2026.
    const block = await openPoll({
      league: LEAGUES['best-ball-1'],
      year: 2026,
      week: 5,
      eligibleFranchiseIds: FIELD,
      log: silent,
    });
    expect(block).toBeNull();
  });
});

describe('closePoll', () => {
  const after = new Date('2026-09-10T02:00:00Z');

  it('tallies, publishes ballots, and clears the pointer', async () => {
    seedWindow();
    seedBallots(11);

    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });

    expect(result!.block.status).toBe('closed');
    expect(result!.block.ballotsIn).toBe(11);
    expect(result!.block.hasQuorum).toBe(true);
    expect(result!.block.ranked!.length).toBeGreaterThan(0);
    expect(result!.block.ballots).toHaveLength(11);
    // 16 franchises, 11 voted.
    expect(result!.block.nonVoterCount).toBe(5);
    // Voting is over — the pointer must be gone.
    expect(store.get(ownersPollCurrentKey(LEAGUE.navSlug))).toBeUndefined();
  });

  it('publishes a COUNT of non-voters, never their names', async () => {
    // The count-only decision is a product rule, so an issue file carrying
    // names would route straight around it.
    seedWindow();
    seedBallots(11);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    const serialized = JSON.stringify(result!.block);
    expect(result!.block.nonVoterCount).toBe(5);
    expect(serialized).not.toContain('nonVoters"');
    // The five who didn't vote are FIELD[11..15]; none may appear as a voter.
    for (const fid of FIELD.slice(11)) {
      expect(result!.block.ballots!.some((b: any) => b.franchiseId === fid)).toBe(false);
    }
  });

  it('records no consensus below quorum, and still clears the pointer', async () => {
    seedWindow();
    seedBallots(3);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result!.block.hasQuorum).toBe(false);
    expect(result!.block.ranked).toBeNull();
    expect(result!.block.unranked).toBeNull();
    expect(store.get(ownersPollCurrentKey(LEAGUE.navSlug))).toBeUndefined();
  });

  it('refuses to tally a ballot that has not closed yet', async () => {
    seedWindow();
    seedBallots(11);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: new Date('2026-09-09T12:00:00Z'), // mid-window
      log: silent,
    });
    expect(result).toBeNull();
    // Critically, the pointer survives — voting continues.
    expect(store.get(ownersPollCurrentKey(LEAGUE.navSlug))).toBeDefined();
  });

  it('refuses when the open ballot is for a different week than the issue', async () => {
    seedWindow({ week: 4 });
    await expect(
      closePoll({
        league: LEAGUE,
        issue: issue({ week: 5 }),
        compositeRankByFid: composite,
        now: after,
        log: silent,
      }),
    ).rejects.toThrow(/Week 4/);
  });

  it('treats missing Redis as FATAL, unlike the open pass', async () => {
    // Writing an empty consensus over an issue would erase real ballots.
    hasCredentials = false;
    await expect(
      closePoll({ league: LEAGUE, issue: issue(), compositeRankByFid: composite, now: after, log: silent }),
    ).rejects.toThrow(/credentials/i);
  });

  it('drops a stored ballot whose body disagrees with its hash field', async () => {
    seedWindow();
    const h = seedBallots(11);
    h.set(
      '0012',
      JSON.stringify({ franchiseId: '0003', ranking: FIELD.slice(0, SLOTS) }),
    );
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result!.dropped).toBe(1);
    expect(result!.block.ballotsIn).toBe(11);
  });

  it('is a clean no-op when no ballot is open', async () => {
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result).toBeNull();
  });
});

describe('buildClosedPollBlock — shared with the seeded example', () => {
  // The worked example in the archive (scripts/seed-example-owners-poll.mjs)
  // publishes through this same function. Its whole claim is that it is the
  // real pipeline over invented input, so a key added to a closed poll must
  // reach it too — which it does only while both callers share this builder.
  const window = {
    opensAt: '2026-09-08T14:00:00.000Z',
    closesAt: '2026-09-10T01:00:00.000Z',
    slots: SLOTS,
    eligibleFranchiseIds: FIELD,
  };
  const ballots = Array.from({ length: 10 }, (_, i) => ({
    franchiseId: FIELD[i],
    ranking: Array.from({ length: SLOTS }, (_, k) => FIELD[(i + k) % FIELD.length]),
    submittedAt: null,
    updatedAt: null,
  }));

  it('publishes exactly the keys the archive and the pages read', () => {
    const { block } = buildClosedPollBlock({
      ballots,
      window,
      quorum: 8,
      compositeRankByFid: composite,
    });

    expect(Object.keys(block).sort()).toEqual(
      [
        'ballots',
        'ballotsIn',
        'closesAt',
        'eligibleVoters',
        'hasQuorum',
        'methodology',
        'nonVoterCount',
        'opensAt',
        'quorum',
        'ranked',
        'slots',
        'status',
        'unranked',
      ].sort(),
    );
    expect(block.status).toBe('closed');
    expect(block.ballotsIn).toBe(10);
    expect(block.hasQuorum).toBe(true);
    expect(block.nonVoterCount).toBe(FIELD.length - 10);
  });

  it('is what closePoll returns, not a parallel implementation', async () => {
    seedWindow();
    seedBallots(10);
    const viaClose = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: new Date('2026-09-10T02:00:00.000Z'),
      log: silent,
    });
    const { block } = buildClosedPollBlock({
      ballots,
      window,
      quorum: LEAGUE.ownersPoll.quorum,
      compositeRankByFid: composite,
    });

    expect(viaClose?.block).toEqual(block);
  });
});

describe('the seeded example never blocks a real tally', () => {
  // A synthetic block is a PLACEHOLDER, not a finished week. The close pass
  // skips any week already reading status: "closed", so without the source
  // check that placeholder would discard ballots owners actually cast,
  // suppress the reveal, and leave the window pointer uncleared.
  const generator = readFileSync(
    new URL('../scripts/generate-pecking-order.mjs', import.meta.url),
    'utf8',
  );
  const seeder = readFileSync(
    new URL('../scripts/seed-example-owners-poll.mjs', import.meta.url),
    'utf8',
  );

  it("qualifies the generator's already-closed skip with the synthetic marker", () => {
    const skip = generator.match(/if \(issue\.ownersPoll\?\.status === 'closed'[^)]*\)/);
    expect(skip?.[0]).toContain('SYNTHETIC_POLL_SOURCE');
  });

  it('gives both sides one marker rather than two string literals', () => {
    expect(SYNTHETIC_POLL_SOURCE).toBe('synthetic');
    for (const [name, src] of [
      ['generate-pecking-order.mjs', generator],
      ['seed-example-owners-poll.mjs', seeder],
    ] as const) {
      expect(src, `${name} imports the shared marker`).toContain('SYNTHETIC_POLL_SOURCE');
      expect(src.match(/'synthetic'/g) ?? [], `${name} re-declares the literal`).toHaveLength(0);
    }
  });

  it('refuses, in the seeder, to overwrite a block that is not synthetic', () => {
    expect(seeder).toMatch(/source !== SYNTHETIC_POLL_SOURCE[\s\S]{0,200}refusing to overwrite/);
  });
});

describe('readTurnout', () => {
  it('separates "no credentials" from "no ballot open"', async () => {
    // Merging these is the recurring bug class in this repo: a cron reporting
    // a quiet week when it actually cannot reach storage hides a broken
    // deployment for as long as nobody checks by hand.
    hasCredentials = false;
    expect(await readTurnout({ league: LEAGUE })).toEqual({ ok: false, reason: 'no-credentials' });

    hasCredentials = true;
    expect(await readTurnout({ league: LEAGUE })).toEqual({ ok: false, reason: 'no-window' });

    expect(describeTurnoutFailure('no-credentials')).not.toBe(describeTurnoutFailure('no-window'));
  });

  it('reports counts for an open ballot', async () => {
    seedWindow({ closesAt: '2099-01-01T00:00:00.000Z' });
    seedBallots(4);
    const turnout = await readTurnout({ league: LEAGUE });
    expect(turnout).toMatchObject({ ok: true, week: 5, ballotsIn: 4, eligibleVoters: 16 });
    // The nag is a push now, so it has to know WHICH owners still owe a ballot.
    expect(turnout.nonVoters).toHaveLength(12);
    expect(turnout.nonVoters).not.toContain(FIELD[0]);
    expect(turnout.nonVoters).toContain(FIELD[15]);
  });

  it('reports already-closed rather than a zero count', async () => {
    seedWindow({ closesAt: '2000-01-01T00:00:00.000Z' });
    expect(await readTurnout({ league: LEAGUE })).toMatchObject({ reason: 'already-closed' });
  });
});

describe('chat copy', () => {
  const teams = new Map(FIELD.map((fid, i) => [fid, { nameMedium: `Team ${i + 1}` }]));

  it('no longer posts a nag to chat at all', async () => {
    // One GroupMe post per day, and the reveal earns it. The reminder moved to
    // push, where it can reach the owners who still need to act without
    // naming them to everyone else.
    const mod: Record<string, unknown> = await import('../scripts/lib/owners-poll-pass.mjs');
    expect(mod.buildNagMessage).toBeUndefined();
  });

  it('open line leads with the disagreement, not the chore', () => {
    const text = buildOpenLine(
      {
        ownersPoll: { status: 'open', slots: 7 },
        rankings: [{ franchiseId: '0001' }, { franchiseId: '0016' }],
      },
      teams,
      LEAGUE,
    )!;
    expect(text).toContain('Team 1');
    expect(text).toContain('Team 16');
    expect(text).toMatch(/argue with it/i);
    expect(text).toContain('/pecking-order/ballot');
  });

  it('open line is null when no ballot opened', () => {
    expect(buildOpenLine({ rankings: [{ franchiseId: '0001' }] }, teams, LEAGUE)).toBeNull();
  });

  it('reveal reports a no-quorum week honestly instead of a top 3', () => {
    const text = buildRevealMessage({
      league: LEAGUE,
      issue: {
        week: 5,
        ownersPoll: { status: 'closed', hasQuorum: false, ballotsIn: 4, eligibleVoters: 16, quorum: 8 },
      },
      teams,
    })!;
    expect(text).toContain('4 of 16');
    expect(text).toMatch(/no consensus/i);
    expect(text).not.toMatch(/^1\./m);
  });

  it('reveal leads with the top 3 and the biggest split', () => {
    const text = buildRevealMessage({
      league: LEAGUE,
      issue: {
        week: 5,
        ownersPoll: {
          status: 'closed',
          hasQuorum: true,
          ballotsIn: 11,
          eligibleVoters: 16,
          ranked: [
            { rank: 1, franchiseId: '0001', points: 60, firstPlaceVotes: 6, delta: 1 },
            { rank: 2, franchiseId: '0002', points: 50, firstPlaceVotes: 3, delta: 0 },
            { rank: 3, franchiseId: '0003', points: 40, firstPlaceVotes: 0, delta: 5 },
          ],
          ballots: [{ franchiseId: '0004', homerIndex: 6 }],
        },
      },
      teams,
    })!;
    expect(text).toContain('1. Team 1 (6) — 60 pts');
    expect(text).toContain('Biggest split');
    expect(text).toContain('Team 3');
    expect(text).toContain('Homer of the week');
  });
});

describe('normalizeFranchiseIds', () => {
  it('pads, dedupes and drops blanks', () => {
    expect(normalizeFranchiseIds(['1', '0001', '2', '', null])).toEqual(['0001', '0002']);
  });
});
