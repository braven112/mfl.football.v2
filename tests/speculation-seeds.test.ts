/**
 * Speculation seeds — expired proposals as an availability signal.
 *
 * The rule this file exists to make mechanical: **only the proposer's half of a
 * proposal is signal.** The proposer offered their own players and asked for
 * their own needs. The franchise they asked never said anything — treating
 * their player as "available" would publish a willingness its owner never
 * expressed, which is the exact failure the trade-offer redactor exists to
 * prevent, arriving through a different lane.
 *
 * The second rule: a seed must never let speculation land back on the real
 * proposal. The two franchises that actually talked are excluded from being
 * paired, so a "hypothetical" cannot quietly republish a private deal.
 */
import { describe, it, expect } from 'vitest';
import {
  SEED_TTL_MS,
  buildSeedFromProposal,
  pairKey,
  readActiveSeeds,
  seedSignals,
  speculationSeedsKey,
} from '../scripts/lib/speculation-seeds.mjs';
import { buildHaves, findTwoTeamCandidates } from '../scripts/lib/speculation-matching.mjs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { readFileSync } from 'node:fs';
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);

interface Seed {
  offerId: string;
  proposerFid: string;
  excludedCounterpartyFid: string | null;
  offeredPlayerIds: string[];
  askedPositions: string[];
  expiredAtMs: number;
}
interface Have { id: string; position: string; wasOffered?: boolean; onTradeBait?: boolean }
interface Candidate { seller: string; buyer: string; marquee: Have; score: number }

/**
 * The modules under test are JSDoc-typed `.mjs`, so their inferred option
 * shapes reject the stubs a test legitimately wants to pass (a two-method
 * fake Redis, a roster literal). These shims put the cast in ONE place and
 * give the assertions a real type, instead of `as any` at every call site
 * where it would also hide a genuine shape change.
 */
const readSeeds = (args: { redis: unknown; navSlug: string; nowMs?: number }): Promise<Seed[]> =>
  (readActiveSeeds as unknown as (a: unknown) => Promise<Seed[]>)(args);
const makeHaves = (args: {
  franchisePlayers: unknown[];
  tradeBaitIds: string[];
  adpRankById: Map<string, number>;
  seededIds?: Set<string>;
}): Have[] => (buildHaves as unknown as (a: unknown) => Have[])(args);
const findCandidates = (args: unknown): Candidate[] =>
  (findTwoTeamCandidates as unknown as (a: unknown) => Candidate[])(args);

const playerMap = new Map([
  ['13116', { name: "Ja'Marr Chase", position: 'WR' }],
  ['14833', { name: 'Breece Hall', position: 'RB' }],
  ['15255', { name: 'Dylan Laube', position: 'RB' }],
  ['16610', { name: 'Some Tight End', position: 'TE' }],
]);

/** 0001 offers Chase + a pick, asking for 0003's Laube (RB). */
const proposal = {
  id: '1078',
  franchise: '0001',
  franchise2: '0003',
  offeredto: '0003',
  franchise1_gave_up: '13116,FP_0001_2027_3',
  franchise2_gave_up: '15255',
};

describe('speculationSeedsKey — both lanes must agree', () => {
  it('keeps TheLeague on its legacy unprefixed form and namespaces the rest', () => {
    expect(speculationSeedsKey('theleague')).toBe('schefter:trade_offers:seeds');
    expect(speculationSeedsKey('afl')).toBe('schefter:afl:trade_offers:seeds');
  });

  it('is keyed on navSlug, and the registry slug is not a substitute', () => {
    // The writer (schefter-rumor-scan.mjs) keys on navSlug. The reader passes
    // a league identifier of its own, and for TheLeague slug === navSlug, so a
    // reader passing the SLUG works today and splits the store the moment this
    // lane is pointed at a league where they differ.
    const afl = getLeagueBySlug('afl-fantasy');
    expect(afl!.navSlug).not.toBe(afl!.slug);
    expect(() => speculationSeedsKey(afl!.slug)).toThrow();
  });

  it('the speculation lane resolves navSlug through the registry', () => {
    const source = readFileSync('scripts/schefter-trade-speculation.mjs', 'utf8');
    expect(source).toMatch(/readActiveSeeds\(\{[^}]*navSlug:\s*seedNavSlug/);
    expect(source).toMatch(/seedNavSlug\s*=\s*getLeagueBySlug\(LEAGUE_SLUG\)\?\.navSlug/);
  });
});

describe('buildSeedFromProposal — only the proposer speaks', () => {
  const seed = buildSeedFromProposal({
    rawOffer: proposal,
    offeringFid: '0001',
    playerMap,
    expiredAtMs: NOW,
  });

  it('marks the proposer\'s own offered players available', () => {
    expect(seed!.proposerFid).toBe('0001');
    expect(seed!.offeredPlayerIds).toEqual(['13116']);
  });

  it('never marks the asked-about player available', () => {
    // Laube is 0003's player. 0001 asking about him says nothing about whether
    // 0003 will move him, and publishing otherwise invents a willingness.
    expect(seed!.offeredPlayerIds).not.toContain('15255');
    expect(JSON.stringify(seed)).not.toContain('15255');
  });

  it('keeps the asked-for POSITION as the proposer\'s stated need', () => {
    expect(seed!.askedPositions).toEqual(['RB']);
  });

  it('records the recipient only so it can be excluded', () => {
    expect(seed!.excludedCounterpartyFid).toBe('0003');
  });

  it('reads the sides correctly when the proposer is franchise2', () => {
    // MFL's owner-view rows put the reporting owner on either side; the
    // proposer is resolved upstream and passed in. Getting this backwards
    // would invert the whole rule.
    const flipped = buildSeedFromProposal({
      rawOffer: proposal,
      offeringFid: '0003',
      playerMap,
      expiredAtMs: NOW,
    });
    expect(flipped!.offeredPlayerIds).toEqual(['15255']);
    expect(flipped!.askedPositions).toEqual(['WR']);
  });

  it('drops a proposal with no players on either side', () => {
    expect(buildSeedFromProposal({
      rawOffer: { id: '9', franchise: '0001', franchise2: '0003', franchise1_gave_up: 'FP_0001_2027_3', franchise2_gave_up: 'DP_2_10' },
      offeringFid: '0001',
      playerMap,
      expiredAtMs: NOW,
    })).toBeNull();
  });
});

describe('seedSignals — availability and wants attach to the proposer only', () => {
  const signals = seedSignals([
    buildSeedFromProposal({ rawOffer: proposal, offeringFid: '0001', playerMap, expiredAtMs: NOW }),
  ]);

  it('gives the proposer the availability and the want', () => {
    expect([...signals.availableByFid.get('0001')!]).toEqual(['13116']);
    expect([...signals.wantsByFid.get('0001')!]).toEqual(['RB']);
  });

  it('gives the franchise that was asked nothing at all', () => {
    expect(signals.availableByFid.has('0003')).toBe(false);
    expect(signals.wantsByFid.has('0003')).toBe(false);
  });

  it('excludes the pair that actually talked', () => {
    expect(signals.excludedPairs.has(pairKey('0001', '0003'))).toBe(true);
    expect(signals.excludedPairs.has(pairKey('0001', '0004'))).toBe(false);
  });
});

describe('readActiveSeeds', () => {
  const fakeRedis = (rows: Record<string, unknown>) => ({
    hgetall: async () => rows,
  });

  it('drops seeds older than the TTL', async () => {
    const fresh = { offerId: 'a', proposerFid: '0001', offeredPlayerIds: [], askedPositions: [], expiredAtMs: NOW - 1000 };
    const stale = { offerId: 'b', proposerFid: '0002', offeredPlayerIds: [], askedPositions: [], expiredAtMs: NOW - SEED_TTL_MS - 1000 };
    const seeds = await readSeeds({
      redis: fakeRedis({ a: JSON.stringify(fresh), b: JSON.stringify(stale) }),
      navSlug: 'theleague',
      nowMs: NOW,
    });
    expect(seeds.map((s: any) => s.offerId)).toEqual(['a']);
  });

  it('survives a malformed row and a missing client', async () => {
    expect(await readSeeds({ redis: null, navSlug: 'theleague', nowMs: NOW })).toEqual([]);
    const seeds = await readSeeds({
      redis: fakeRedis({ bad: '{not json' }),
      navSlug: 'theleague',
      nowMs: NOW,
    });
    expect(seeds).toEqual([]);
  });
});

describe('buildHaves — a seeded player is available like a listed one', () => {
  const roster = [
    { id: '13116', name: "Ja'Marr Chase", position: 'WR', status: 'ROSTER', salary: 9_000_000, age: 26 },
    { id: '14833', name: 'Breece Hall', position: 'RB', status: 'ROSTER', salary: 5_000_000, age: 26 },
  ];

  it('admits a player his owner offered, even off the block and not surplus', () => {
    const without = makeHaves({ franchisePlayers: roster, tradeBaitIds: [], adpRankById: new Map() });
    const withSeed = makeHaves({
      franchisePlayers: roster,
      tradeBaitIds: [],
      adpRankById: new Map(),
      seededIds: new Set(['13116']),
    });
    expect(without.map((h) => h.id)).not.toContain('13116');
    expect(withSeed.map((h) => h.id)).toContain('13116');
    expect(withSeed.find((h) => h.id === '13116')?.wasOffered).toBe(true);
  });
});

describe('findTwoTeamCandidates — the real pair is never speculated about', () => {
  const teams = new Map([
    ['0001', { division: 'East', nameMedium: 'Pigskins' }],
    ['0003', { division: 'East', nameMedium: 'Maverick' }],
    ['0004', { division: 'West', nameMedium: 'Cowboy Up' }],
    ['0005', { division: 'West', nameMedium: 'Filler One' }],
    ['0006', { division: 'East', nameMedium: 'Filler Two' }],
  ]);
  const roster = (rows: Array<[string, string, number]>) =>
    rows.map(([id, position, salary]) => ({
      id, name: `Player ${id}`, position, salary, status: 'ROSTER', age: 25,
    }));

  // Shaped so 0001 has ONE tradeable WR that is neither listed nor surplus —
  // it becomes a candidate marquee only through the seed — while 0003 and 0004
  // both want a receiver and both hold a listed back to send back.
  const playersByFranchise = new Map([
    ['0001', roster([['13116', 'WR', 9_000_000], ['a-qb', 'QB', 5_000_000], ['a-te', 'TE', 5_000_000]])],
    ['0003', roster([['b-rb1', 'RB', 9_000_000], ['b-rb2', 'RB', 5_000_000], ['b-qb', 'QB', 5_000_000], ['b-te', 'TE', 5_000_000]])],
    ['0004', roster([['c-rb1', 'RB', 9_000_000], ['c-rb2', 'RB', 5_000_000], ['c-qb', 'QB', 5_000_000], ['c-te', 'TE', 5_000_000]])],
    ['0005', roster([['d-wr1', 'WR', 5_000_000], ['d-wr2', 'WR', 5_000_000], ['d-rb1', 'RB', 5_000_000], ['d-rb2', 'RB', 5_000_000]])],
    ['0006', roster([['e-wr1', 'WR', 5_000_000], ['e-wr2', 'WR', 5_000_000], ['e-rb1', 'RB', 5_000_000], ['e-rb2', 'RB', 5_000_000]])],
  ]);
  const tradeBaitByFranchise = new Map<string, string[]>([
    ['0001', []],
    ['0003', ['b-rb1']],
    ['0004', ['c-rb1']],
    ['0005', []],
    ['0006', []],
  ]);
  const run = (signals: unknown) => findCandidates({
    playersByFranchise,
    tradeBaitByFranchise,
    adpRankById: new Map(),
    teams,
    limit: 50,
    seedSignals: signals,
  });

  const signals = seedSignals([
    buildSeedFromProposal({ rawOffer: proposal, offeringFid: '0001', playerMap, expiredAtMs: NOW }),
  ]);

  it('the seed is what puts the proposer in the pool at all', () => {
    // Unlisted, not surplus: without the seed 0001 has nothing to offer, so
    // this fixture proves the exclusion below is not vacuous.
    expect(run(null)).toHaveLength(0);
    expect(run(signals).length).toBeGreaterThan(0);
  });

  it('never pairs the two franchises that actually talked', () => {
    const pairs = run(signals).map((c) => pairKey(c.seller, c.buyer));
    expect(pairs).not.toContain(pairKey('0001', '0003'));
  });

  it('leaves every other franchise a legitimate partner', () => {
    const pairs = run(signals).map((c) => pairKey(c.seller, c.buyer));
    expect(pairs).toContain(pairKey('0001', '0004'));
  });

  it('scores a shopped player above a merely-listed one', () => {
    const seeded = run(signals).find((c) => c.marquee.id === '13116');
    expect(seeded?.marquee.wasOffered).toBe(true);
  });
});
