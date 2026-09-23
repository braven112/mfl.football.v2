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
      case 'HSET': {
        if (!hashes.has(key)) hashes.set(key, new Map());
        hashes.get(key)!.set(rest[0], rest[1]);
        return 1;
      }
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
const { buildNagPushes } = await import('../scripts/lib/owners-poll-posts.mjs');
const { ownersPollStandingKey, ownersPollCurrentKey, ownersPollBallotsKey } = await import(
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
  // Standing ballots live on the SEASON key now, not the week key.
  hashes.set(ownersPollStandingKey(LEAGUE.navSlug, year), h);
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

    expect(block).toMatchObject({ status: 'open', slots: 7, eligibleVoters: 16 });
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

  it('publishes a light week rather than suppressing it — no quorum', async () => {
    seedWindow();
    seedBallots(3);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result!.block.ballotsIn).toBe(3);
    expect(result!.block.ranked).not.toBeNull();
    expect(result!.block.ranked!.length).toBeGreaterThan(0);
    expect(result!.block).not.toHaveProperty('hasQuorum');
    expect(store.get(ownersPollCurrentKey(LEAGUE.navSlug))).toBeUndefined();
  });

  it('records NO consensus when nobody voted, and still clears the pointer', async () => {
    seedWindow();
    seedBallots(0);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result!.block.ballotsIn).toBe(0);
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

  it('no longer walks away when no pointer was stamped', async () => {
    // This USED to be "a clean no-op when no ballot is open", and that was
    // right while a ballot only existed if the Tuesday pass had opened one.
    // Voting is always open now, so no pointer means the open run was dropped
    // — not that nobody could vote — and walking away loses a real week of
    // ballots. See the dedicated describe below.
    seedBallots(2);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result).not.toBeNull();
    expect(result!.block.ballotsIn).toBe(2);
  });
});

describe('buildClosedPollBlock — shared with the seeded example', () => {
  // The worked example in the archive (scripts/seed-example-owners-poll.mjs)
  // publishes through this same function. Its whole claim is that it is the
  // real pipeline over invented input, so a key added to a closed poll must
  // reach it too — which it does only while both callers share this builder.
  // The close schedule rides in from the REGISTRY, not from the stored
  // pointer — `writeWindow` has never persisted it — so both callers of the
  // shared builder augment their window the same way: closePoll from
  // `league.ownersPoll`, the seeder from `poll`. This fixture stands in for
  // that, which is what keeps the parity test below an honest comparison.
  const window = {
    opensAt: '2026-09-08T14:00:00.000Z',
    closesAt: '2026-09-10T01:00:00.000Z',
    slots: SLOTS,
    eligibleFranchiseIds: FIELD,
    closeWeekday: LEAGUE.ownersPoll.closeWeekday,
    closeHourPT: LEAGUE.ownersPoll.closeHourPT,
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
      compositeRankByFid: composite,
    });

    expect(Object.keys(block).sort()).toEqual(
      [
        'ballots',
        'ballotsIn',
        'closeHourPT',
        'closeWeekday',
        'closesAt',
        'eligibleVoters',
        'methodology',
        'nonVoterCount',
        'opensAt',
        'ranked',
        'slots',
        'status',
        'unranked',
      ].sort(),
    );
    expect(block.status).toBe('closed');
    expect(block.ballotsIn).toBe(10);
    expect(block.nonVoterCount).toBe(FIELD.length - 10);
    // Not merely present — carrying the league's real schedule. Null here is
    // what made the column's "the count is taken every X at Y" line fall back
    // to the component's hardcoded Thursday/4pm for every closed week.
    expect(block.closeWeekday).toBe(LEAGUE.ownersPoll.closeWeekday);
    expect(block.closeHourPT).toBe(LEAGUE.ownersPoll.closeHourPT);
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

  it('open line leads with the disagreement and STATES when the result lands', () => {
    // "I don't understand when a poll starts or ends" was the complaint that
    // started this. Every surface now names the result time.
    const text = buildOpenLine(
      {
        ownersPoll: { status: 'open', slots: 7, closesAt: '2026-09-10T23:00:00.000Z' },
        rankings: [{ franchiseId: '0001' }, { franchiseId: '0016' }],
      },
      teams,
      LEAGUE,
    )!;
    expect(text).toContain('Team 1');
    expect(text).toContain('Team 16');
    expect(text).toMatch(/always open/i);
    expect(text).toMatch(/stands until you change it/i);
    expect(text).toMatch(/Thursday/);
    expect(text).toContain('/pecking-order/ballot');
  });

  it('open line is null when no ballot opened', () => {
    expect(buildOpenLine({ rankings: [{ franchiseId: '0001' }] }, teams, LEAGUE)).toBeNull();
  });

  it('posts NOTHING for a week nobody voted in', () => {
    // "There is no point of posting about no poll." The chat gets one
    // automated message a day; a null here lets that slot fall through to a
    // kind with something to say.
    expect(
      buildRevealMessage({
        league: LEAGUE,
        issue: {
          week: 5,
          ownersPoll: { status: 'closed', ballotsIn: 0, eligibleVoters: 16, ranked: null },
        },
        teams,
      }),
    ).toBeNull();
  });

  it('reveals a light week normally — a poll of four is still a poll', () => {
    const text = buildRevealMessage({
      league: LEAGUE,
      issue: {
        week: 5,
        ownersPoll: {
          status: 'closed',
          ballotsIn: 4,
          eligibleVoters: 16,
          ranked: [
            { rank: 1, franchiseId: '0001', points: 28, firstPlaceVotes: 4, delta: 0 },
            { rank: 2, franchiseId: '0002', points: 20, firstPlaceVotes: 0, delta: 1 },
            { rank: 3, franchiseId: '0003', points: 12, firstPlaceVotes: 0, delta: -1 },
          ],
          ballots: [],
        },
      },
      teams,
    })!;
    expect(text).toContain('4/16');
    expect(text).toMatch(/^1\./m);
    expect(text).not.toMatch(/quorum|no consensus/i);
  });

  it('reveal leads with the top 3 and the biggest split', () => {
    const text = buildRevealMessage({
      league: LEAGUE,
      issue: {
        week: 5,
        ownersPoll: {
          status: 'closed',
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

// ---------------------------------------------------------------------------

describe('readTurnout feeds the push builder', () => {
  it('returns standing state for EVERY eligible franchise, not just non-voters', async () => {
    // The generator spreads this straight into buildNagPushes. When that
    // builder moved from `nonVoters` to `standing`, the call site kept
    // compiling and the cron silently sent nothing — it even logged "all
    // ballots are already in". Contract change, no error, dead feature.
    seedWindow({ closesAt: new Date(Date.now() + 86400_000).toISOString() });
    seedBallots(3);
    const turnout: any = await readTurnout({ league: LEAGUE });
    expect(turnout.ok).toBe(true);
    expect(Array.isArray(turnout.standing)).toBe(true);
    expect(turnout.standing).toHaveLength(FIELD.length);
    for (const row of turnout.standing) {
      expect(row).toHaveProperty('franchiseId');
      expect(row).toHaveProperty('updatedAt');
      expect(row).toHaveProperty('stale');
    }
    // The three who voted have a record; the rest have nothing on file.
    expect(turnout.standing.filter((r: any) => r.updatedAt !== null)).toHaveLength(0);
    expect(turnout.ballotsIn).toBe(3);
  });

  it('its shape is what buildNagPushes actually consumes', async () => {
    seedWindow({ closesAt: new Date(Date.now() + 86400_000).toISOString() });
    seedBallots(2);
    const turnout: any = await readTurnout({ league: LEAGUE });
    const pushes = buildNagPushes({
      week: turnout.week,
      closesAt: turnout.closesAt,
      standing: turnout.standing,
    });
    // Nobody has an updatedAt in the seeded fixtures, so everyone reads as
    // "no ballot on file" — the point is that it produces SOMETHING rather
    // than silently returning [].
    expect(pushes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('the close pass does not depend on its own opener', () => {
  const after = new Date('2026-09-10T02:00:00Z');

  // Voting is always open, so owners can fill the standing hash all week
  // whether or not the Tuesday pass stamped a window pointer. GitHub drops
  // this repo's scheduled events in bulk (CLAUDE.md, "GitHub's `schedule` is
  // not a cadence"), so "the open run did not happen" is a real Tuesday, not a
  // hypothetical — and it used to mean the close pass walked away from a week
  // of genuine ballots logging "no open ballot to close".

  it('derives a window and still tallies when no pointer was stamped', async () => {
    // No seedWindow() — this is the dropped-open-run case.
    seedBallots(5);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result, 'a dropped open run must not lose the week').not.toBeNull();
    expect(result!.block.ballotsIn).toBe(5);
    expect(result!.block.ranked).not.toBeNull();
  });

  it('still returns null when there is no field to derive one from', async () => {
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: {},
      now: after,
      log: silent,
    });
    expect(result).toBeNull();
  });

  it('prefers the stamped pointer when it exists', async () => {
    // The pointer records the field and depth the poll actually opened on, so
    // it still wins — the derivation is a fallback, not a replacement.
    seedWindow({ slots: 7 });
    seedBallots(4);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result!.block.slots).toBe(7);
    expect(result!.block.ballotsIn).toBe(4);
  });
});

describe('the standing-vote cut-over runs inside the passes', () => {
  // Standing votes shipped mid-week: the Tuesday pass had already opened the
  // week-scoped hash on the old code, and owners voted into it until the
  // promotion. The passes adopt those ballots themselves, so the cut-over does
  // not hinge on someone running the one-shot with credentials before Thursday.
  const after = new Date('2026-09-10T02:00:00Z');
  const ballot = (fid: string, offset: number, updatedAt: string | null) =>
    JSON.stringify({
      franchiseId: fid,
      ranking: Array.from({ length: SLOTS }, (_, k) => FIELD[(offset + k) % FIELD.length]),
      submittedAt: updatedAt,
      updatedAt,
    });
  function seedLegacy(entries: Array<[string, string]>, week = 5) {
    hashes.set(ownersPollBallotsKey(LEAGUE.navSlug, 2026, week), new Map(entries));
  }

  it('tallies ballots that were cast into the legacy week hash', async () => {
    seedWindow();
    seedLegacy([
      [FIELD[0], ballot(FIELD[0], 0, '2026-09-08T15:00:00.000Z')],
      [FIELD[1], ballot(FIELD[1], 1, '2026-09-08T16:00:00.000Z')],
    ]);
    const result = await closePoll({
      league: LEAGUE,
      issue: issue(),
      compositeRankByFid: composite,
      now: after,
      log: silent,
    });
    expect(result!.block.ballotsIn).toBe(2);
    expect(hashes.get(ownersPollStandingKey(LEAGUE.navSlug, 2026))?.size).toBe(2);
  });

  it('never overwrites a NEWER standing ballot with the legacy one', async () => {
    seedWindow();
    const newer = ballot(FIELD[0], 3, '2026-09-09T12:00:00.000Z');
    hashes.set(ownersPollStandingKey(LEAGUE.navSlug, 2026), new Map([[FIELD[0], newer]]));
    seedLegacy([[FIELD[0], ballot(FIELD[0], 0, '2026-09-08T15:00:00.000Z')]]);
    await closePoll({ league: LEAGUE, issue: issue(), compositeRankByFid: composite, now: after, log: silent });
    const kept = JSON.parse(hashes.get(ownersPollStandingKey(LEAGUE.navSlug, 2026))!.get(FIELD[0])!);
    expect(kept.updatedAt).toBe('2026-09-09T12:00:00.000Z');
    expect(kept.ranking[0]).toBe(FIELD[3]);
  });

  it('replaces an OLDER standing ballot, and is idempotent on a second run', async () => {
    seedWindow({ closesAt: '2099-01-01T00:00:00.000Z' });
    hashes.set(
      ownersPollStandingKey(LEAGUE.navSlug, 2026),
      new Map([[FIELD[0], ballot(FIELD[0], 3, '2026-09-01T00:00:00.000Z')]]),
    );
    seedLegacy([[FIELD[0], ballot(FIELD[0], 0, '2026-09-08T15:00:00.000Z')]]);
    await readTurnout({ league: LEAGUE });
    const first = hashes.get(ownersPollStandingKey(LEAGUE.navSlug, 2026))!.get(FIELD[0]);
    await readTurnout({ league: LEAGUE });
    const second = hashes.get(ownersPollStandingKey(LEAGUE.navSlug, 2026))!.get(FIELD[0]);
    expect(JSON.parse(first!).updatedAt).toBe('2026-09-08T15:00:00.000Z');
    expect(second).toBe(first);
  });

  it('does not nag an owner whose vote is still in the legacy hash', async () => {
    seedWindow({ closesAt: '2099-01-01T00:00:00.000Z' });
    seedLegacy([[FIELD[2], ballot(FIELD[2], 2, '2026-09-08T15:00:00.000Z')]]);
    const turnout = await readTurnout({ league: LEAGUE });
    expect(turnout).toMatchObject({ ok: true, ballotsIn: 1 });
    expect(turnout.nonVoters).not.toContain(FIELD[2]);
  });
});
