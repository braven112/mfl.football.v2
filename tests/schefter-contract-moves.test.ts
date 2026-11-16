import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildAppliedPosts,
  trackPendingTags,
  nextTagPost,
  dueRumors,
  tagCandidates,
  watchList,
  buildWatchPost,
  buildRumorPost,
  settleState,
  emptyState,
  normalizeState,
  leagueMoves,
  tagWindowGate,
  rumorReadyAt,
  APPLIED_MAX_AGE_MS,
} from '../scripts/lib/schefter-contract-moves.mjs';

const LEAGUE = '13522';
const players = new Map([
  ['100', { name: 'Samuel, Deebo', position: 'WR' }],
  ['101', { name: 'Hill, Tyreek', position: 'WR' }],
  ['102', { name: 'Kelce, Travis', position: 'TE' }],
  ['103', { name: 'Henry, Derrick', position: 'RB' }],
  ['104', { name: 'Adams, Davante', position: 'WR' }],
]);
const names: Record<string, string> = { '0001': 'Pigskins', '0002': 'Magicians' };
const teamName = (fid: string) => names[fid] ?? null;

const decl = (over: Record<string, unknown>) => ({
  id: 'DECL_1',
  type: 'veteran-extension',
  playerId: '100',
  playerName: 'Samuel, Deebo',
  franchiseId: '0001',
  franchiseName: 'Pacific Pigskins',
  leagueId: LEAGUE,
  currentYears: 1,
  currentSalary: 2_100_000,
  currentContractInfo: '',
  requestedYears: 3,
  requestedSalary: 4_500_000,
  requestedContractInfo: 'E',
  status: 'applied',
  submittedAt: '2026-11-15T10:00:00Z',
  mflSynced: true,
  mflSyncedAt: '2026-11-15T10:00:05Z',
  ...over,
});

const rosters = {
  rosters: {
    franchise: [
      {
        id: '0001',
        player: [
          { id: '100', contractYear: '1', contractInfo: '', salary: '9000000', status: 'ROSTER' },
          { id: '101', contractYear: '1', contractInfo: '', salary: '7000000', status: 'ROSTER' },
          { id: '102', contractYear: '1', contractInfo: 'RC', salary: '8000000', status: 'ROSTER' },
          { id: '103', contractYear: '2', contractInfo: '', salary: '6000000', status: 'ROSTER' },
        ],
      },
      {
        id: '0002',
        player: [{ id: '104', contractYear: '1', contractInfo: '', salary: '5000000', status: 'ROSTER' }],
      },
    ],
  },
};

describe('applied contract moves', () => {
  const now = new Date('2026-11-15T12:00:00Z');

  it('posts an extension with the old and new terms, without MFL designation letters', () => {
    const { posts, reportedIds } = buildAppliedPosts({
      declarations: [decl({})], state: emptyState(), players, teamName, now, leagueSlug: 'theleague',
    });
    expect(reportedIds).toEqual(['DECL_1']);
    expect(posts).toHaveLength(1);
    expect(posts[0].transactionSubType).toBe('CONTRACT');
    expect(posts[0].headline).toBe('Pigskins extend WR, Deebo Samuel');
    expect(posts[0].body).toContain('Was: $2.10M · 1 yr\nNow: $4.50M · 3 yrs');
    expect(posts[0].body).not.toMatch(/· E\b/);
  });

  it('skips moves already reported, still pending, or too old to be news', () => {
    const old = new Date(now.getTime() - APPLIED_MAX_AGE_MS - 1000).toISOString();
    const { posts } = buildAppliedPosts({
      declarations: [
        decl({ id: 'A' }),
        decl({ id: 'B', status: 'pending' }),
        decl({ id: 'C', mflSyncedAt: old }),
      ],
      state: { ...emptyState(), reported: { A: now.toISOString() } },
      players, teamName, now, leagueSlug: 'theleague',
    });
    expect(posts).toHaveLength(0);
  });

  it('reads only this league and only the four reported types', () => {
    const moves = leagueMoves([
      decl({ id: 'A' }),
      decl({ id: 'B', leagueId: '99999' }),
      decl({ id: 'C', type: 'new-acquisition' }),
      decl({ id: 'D', type: 'team-option' }),
    ], LEAGUE);
    expect(moves.map((d) => d.id)).toEqual(['A', 'D']);
  });

  it('folds the tags a run finds applied into one "official" list', () => {
    const { posts } = buildAppliedPosts({
      declarations: [
        decl({ id: 'T1', type: 'franchise-tag', requestedYears: 1, requestedSalary: 9_100_000 }),
        decl({ id: 'T2', type: 'franchise-tag', playerId: '104', franchiseId: '0002', requestedYears: 1, requestedSalary: 7_000_000 }),
      ],
      state: emptyState(), players, teamName, now, leagueSlug: 'theleague',
    });
    expect(posts).toHaveLength(1);
    expect(posts[0].headline).toBe('Franchise tags are official: 2 players tagged');
    expect(posts[0].body).toContain('🏷️ Pigskins: WR, Deebo Samuel ($9.10M, 1 yr)');
    expect(posts[0].body).toContain('🏷️ Magicians: WR, Davante Adams ($7.00M, 1 yr)');
  });
});

describe('tag candidates', () => {
  it('are one-year contracts that are not tagged, rookie or option deals, highest salary first', () => {
    const c = tagCandidates(rosters, players);
    expect(c.map((x) => x.playerId)).toEqual(['100', '101', '104']);
  });

  it('the watch list caps how many names one team gets', () => {
    expect(watchList(tagCandidates(rosters, players), 6, 1).map((x) => x.playerId)).toEqual(['100', '104']);
  });
});

describe('pending franchise tags', () => {
  const feb3 = new Date('2027-02-03T18:00:00Z');
  const pending = (over = {}) => decl({ id: 'T1', type: 'franchise-tag', status: 'pending', mflSynced: false, submittedAt: '2027-02-03T17:00:00Z', ...over });

  it('tracks a new pending tag with its team and position', () => {
    const s = trackPendingTags(emptyState(), [pending()], players, feb3);
    expect(s.tags.T1).toMatchObject({ franchiseId: '0001', position: 'WR', status: 'pending' });
  });

  it('marks a tag that vanished as cancelled, one that reached MFL as applied, one re-filed as superseded', () => {
    let s = trackPendingTags(emptyState(), [pending(), pending({ id: 'T2', playerId: '104', franchiseId: '0002' }), pending({ id: 'T3', playerId: '101' })], players, feb3);
    s = trackPendingTags(s, [pending({ id: 'T2', playerId: '104', franchiseId: '0002', status: 'applied' }), pending({ id: 'T4', playerId: '101' })], players, feb3);
    expect(s.tags.T1.status).toBe('cancelled');
    expect(s.tags.T2.status).toBe('applied');
    expect(s.tags.T3.status).toBe('superseded');
  });

  it('posts nothing outside the window or in its last 24 hours', () => {
    const s = trackPendingTags(emptyState(), [pending()], players, feb3);
    expect(nextTagPost({ state: s, now: new Date('2027-01-31T12:00:00Z') })).toBeNull();
    expect(nextTagPost({ state: { ...s, watchYear: null }, now: new Date('2027-02-14T06:00:00Z') })).toBeNull();
    expect(tagWindowGate(new Date('2027-02-13T12:00:00Z')).open).toBe(true);
  });

  it('opens the window with the tag watch, then holds a day before anything else', () => {
    const feb1 = new Date('2027-02-01T16:00:00Z');
    expect(nextTagPost({ state: emptyState(), now: feb1 })).toEqual({ kind: 'watch' });
    const after = settleState(emptyState(), { tagPost: {}, tagItem: { kind: 'watch' }, now: feb1 });
    expect(after.watchYear).toBe(2027);
    expect(nextTagPost({ state: after, now: new Date('2027-02-01T20:00:00Z') })).toBeNull();
  });

  it('a rumor waits at least a day after the filing', () => {
    const s = { ...trackPendingTags(emptyState(), [pending()], players, feb3), watchYear: 2027 };
    expect(dueRumors(s, new Date('2027-02-04T16:00:00Z'), 2027)).toEqual([]);
    const ready = rumorReadyAt('T1', '2027-02-03T18:00:00.000Z', 'leak');
    expect(ready - Date.parse('2027-02-03T18:00:00Z')).toBeGreaterThanOrEqual(24 * 3600e3);
    expect(dueRumors(s, new Date(ready), 2027)).toEqual([{ kind: 'leak', id: 'T1' }]);
  });

  it('a cancelled tag and a pending one are drawn from the same pool', () => {
    let s = trackPendingTags(emptyState(), [pending(), pending({ id: 'T2', playerId: '104', franchiseId: '0002' })], players, feb3);
    s = trackPendingTags(s, [pending({ id: 'T2', playerId: '104', franchiseId: '0002' })], players, feb3);
    s = { ...s, watchYear: 2027 };
    const later = new Date('2027-02-07T00:00:00Z');
    const due = dueRumors(s, later, 2027);
    expect(due).toEqual([{ kind: 'changed', id: 'T1' }, { kind: 'leak', id: 'T2' }]);
    expect(nextTagPost({ state: s, now: later, rng: () => 0 })).toEqual({ kind: 'changed', id: 'T1' });
    expect(nextTagPost({ state: s, now: later, rng: () => 0.99 })).toEqual({ kind: 'leak', id: 'T2' });
  });

  it('a rumor names the team and the position, never the player alone or the value', () => {
    const tag = { franchiseId: '0002', playerId: '104', position: 'WR', firstSeenAt: feb3.toISOString(), submittedAt: feb3.toISOString(), status: 'pending' };
    const post = buildRumorPost({ item: { kind: 'leak', id: 'T9' }, tag, candidates: tagCandidates(rosters, players), teamName, now: feb3, leagueSlug: 'theleague' });
    expect(post.body).toContain('Magicians');
    expect(post.body).toContain('receiver');
    expect(post.body).not.toContain('Adams');
    expect(post.body).not.toMatch(/\$/);
    expect(post).not.toHaveProperty('playerIds');
    expect(JSON.stringify(post)).not.toContain('104');
    expect(JSON.stringify(post)).not.toContain('T9');
  });

  it('with two eligible players at the position, both are "in the mix"', () => {
    const tag = { franchiseId: '0001', playerId: '101', position: 'WR', firstSeenAt: feb3.toISOString(), submittedAt: feb3.toISOString(), status: 'pending' };
    const post = buildRumorPost({ item: { kind: 'leak', id: 'T1' }, tag, candidates: tagCandidates(rosters, players), teamName, now: feb3, leagueSlug: 'theleague' });
    expect(post.body).toContain('Names in the mix: Deebo Samuel and Tyreek Hill.');
    expect(post.tagRumorKind).toBe('leak');
  });

  it('"plans have changed" reads as a correction when the tag had leaked', () => {
    const tag = { franchiseId: '0001', playerId: '100', position: 'WR', firstSeenAt: feb3.toISOString(), status: 'cancelled', leakedAt: feb3.toISOString() };
    const post = buildRumorPost({ item: { kind: 'changed', id: 'T1' }, tag, candidates: [], teamName, now: feb3, leagueSlug: 'theleague' });
    expect(post.body).toMatch(/[Pp]lans have changed/);
    expect(post.tagRumorKind).toBe('changed');
  });

  it('the watch post primes the audience with names and teams', () => {
    const post = buildWatchPost({ shortlist: watchList(tagCandidates(rosters, players)), teamName, now: new Date('2027-02-01T16:00:00Z'), year: 2027, leagueSlug: 'theleague' });
    expect(post.id).toBe('sf_tagwatch_2027');
    expect(post.body).toContain('🏷️ WR, Deebo Samuel (Pigskins)');
    expect(post.body).toContain('🏷️ WR, Davante Adams (Magicians)');
  });

  it('settling stamps the posted rumor and prunes an earlier window', () => {
    let s = trackPendingTags(emptyState(), [pending()], players, feb3);
    s = { ...s, tags: { ...s.tags, OLD: { ...s.tags.T1, firstSeenAt: '2026-02-03T00:00:00Z' } } };
    const out = settleState(s, { tagPost: {}, tagItem: { kind: 'leak', id: 'T1' }, reportedIds: ['A'], now: feb3 });
    expect(out.tags.T1.leakedAt).toBe(feb3.toISOString());
    expect(out.tags.OLD).toBeUndefined();
    expect(out.reported.A).toBe(feb3.toISOString());
    expect(out.lastRumorAt).toBe(feb3.toISOString());
  });

  it('normalizes whatever Redis held', () => {
    expect(normalizeState(null)).toEqual(emptyState());
    expect(normalizeState({ watchYear: 2027, tags: { a: {} } }).watchYear).toBe(2027);
  });
});

describe('scan wiring', () => {
  const src = readFileSync('scripts/schefter-scan.mjs', 'utf8');
  const lane = src.slice(src.indexOf('async function scanContractMoves'), src.indexOf('// ── Schefter Rumor Mill: Trade-Bait Detector'));

  it('keeps the lane state in Redis, never on the public feed file', () => {
    expect(lane).toContain("contractMoveStateKey(league)");
    expect(lane).not.toMatch(/feed\.(contract|tag)\w*\s*=/);
  });

  it('never posts to GroupMe', () => {
    expect(lane).not.toMatch(/postToGroupMe/);
  });
});
