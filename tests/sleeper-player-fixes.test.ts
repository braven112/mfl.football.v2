/**
 * Crowd player fixes for Sleeper players the id join left unmatched.
 *
 * The rule being pinned (Brandon, Oct 2026): a pick applies to its owner at
 * once and to everyone once TWO different owners pick the same MFL player, or
 * the admin applies it; a rejected pick is blocked and withdrawn everywhere. A
 * fix only ever fills a blank, so the crowd can never re-point a match the
 * join already made.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory hash store standing in for Upstash: the part of the client
// player-fixes.ts uses, with Upstash's own "missing hash reads as null".
const store = new Map<string, Map<string, unknown>>();
const fake = {
  hget: async (k: string, f: string) => store.get(k)?.get(f) ?? null,
  hgetall: async (k: string) => {
    const h = store.get(k);
    return h && h.size ? Object.fromEntries(h) : null;
  },
  hset: async (k: string, values: Record<string, unknown>) => {
    const h = store.get(k) ?? new Map();
    for (const [f, v] of Object.entries(values)) h.set(f, v);
    store.set(k, h);
    return Object.keys(values).length;
  },
  hdel: async (k: string, ...fields: string[]) => {
    const h = store.get(k);
    let n = 0;
    for (const f of fields) if (h?.delete(f)) n += 1;
    return n;
  },
};
vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fake }));

const {
  AGREEMENT,
  agreedMatch,
  applyPlayerFixes,
  approvePlayerFix,
  buildFixReview,
  clearPlayerFix,
  clearPlayerFixCache,
  listFixReviews,
  readGlobalFixes,
  readMyFixes,
  readViewerFixes,
  rejectPlayerFix,
  submitPlayerFix,
  viewerFixes,
} = await import('../src/utils/sleeper/player-fixes');
const { searchMflPlayers, suggestMflPlayers } = await import('../src/utils/sleeper/players');
const { sleeperViewerKey, sleeperLinkKey } = await import('../src/utils/sleeper/link');
const { isUnresolvedPlayerId, UNRESOLVED_PREFIX } = await import('../src/utils/sleeper/ids');

const SUBJECT = { name: 'Hollywood Brown', position: 'WR', team: 'KC' };
const pick = (voter: string, mfl: string, sid = '5848') =>
  submitPlayerFix({ voter, sid, mfl, subject: SUBJECT });

beforeEach(() => {
  store.clear();
  clearPlayerFixCache();
});

describe('agreedMatch', () => {
  it('needs two different owners', () => {
    expect(AGREEMENT).toBe(2);
    expect(agreedMatch({ a: '1' })).toBeNull();
    expect(agreedMatch({ a: '1', b: '1' })).toBe('1');
    expect(agreedMatch({ a: '1', b: '2' })).toBeNull();
  });

  it('a dispute (two candidates each agreed) is left for the admin', () => {
    expect(agreedMatch({ a: '1', b: '1', c: '2', d: '2' })).toBeNull();
  });

  it('never counts a blocked pick', () => {
    expect(agreedMatch({ a: '1', b: '1' }, new Set(['1']))).toBeNull();
    expect(agreedMatch({ a: '1', b: '1', c: '2', d: '2' }, new Set(['1']))).toBe('2');
  });
});

describe('applyPlayerFixes', () => {
  const map = {
    '5848': { mfl: '', name: 'Hollywood Brown', position: 'WR', team: 'KC' },
    '4046': { mfl: '13116', name: 'Patrick Mahomes', position: 'QB', team: 'KC' },
  };

  it('fills a blank, and never re-points a match the join made', () => {
    const out = applyPlayerFixes(map, { '5848': '14000', '4046': '99999', '1': '2' });
    expect(out['5848'].mfl).toBe('14000');
    expect(out['4046'].mfl).toBe('13116');
    expect(out['1']).toBeUndefined();
  });

  it('never mutates the shared base map', () => {
    applyPlayerFixes(map, { '5848': '14000' });
    expect(map['5848'].mfl).toBe('');
    expect(applyPlayerFixes(map, {})).toBe(map);
  });

  it("the viewer's own pick wins over everyone's on their board", () => {
    const global = { '5848': { mfl: '14000', source: 'agreement' as const, at: '' } };
    expect(viewerFixes(global, {})).toEqual({ '5848': '14000' });
    expect(viewerFixes(global, { '5848': '15000' })).toEqual({ '5848': '15000' });
  });
});

describe('submitting and withdrawing', () => {
  it('one pick applies to its owner only', async () => {
    expect(await pick('a', '14000')).toBe('saved');
    expect(await readMyFixes('a')).toEqual({ '5848': '14000' });
    expect(await readViewerFixes('b')).toEqual({});
    expect(await readGlobalFixes()).toEqual({});
  });

  it('a second owner agreeing applies it to everyone', async () => {
    await pick('a', '14000');
    expect(await pick('b', '14000')).toBe('agreed');
    expect(await readViewerFixes('c')).toEqual({ '5848': '14000' });
    expect((await readGlobalFixes())['5848'].source).toBe('agreement');
  });

  it('one owner submitting twice is still one vote', async () => {
    await pick('a', '14000');
    expect(await pick('a', '14000')).toBe('saved');
    expect(await readGlobalFixes()).toEqual({});
  });

  it('withdrawing a vote below agreement un-applies it', async () => {
    await pick('a', '14000');
    await pick('b', '14000');
    expect(await clearPlayerFix('b', '5848')).toBe(true);
    expect(await readGlobalFixes()).toEqual({});
    expect(await readMyFixes('a')).toEqual({ '5848': '14000' });
  });
});

describe('the admin', () => {
  it('apply wins regardless of the count, and a withdrawal cannot undo it', async () => {
    await pick('a', '14000');
    expect(await approvePlayerFix('5848', '15000')).toBe(true);
    expect((await readGlobalFixes())['5848']).toMatchObject({ mfl: '15000', source: 'admin' });
    await clearPlayerFix('a', '5848');
    expect((await readGlobalFixes())['5848'].mfl).toBe('15000');
  });

  it('reject blocks the pick, withdraws it from every voter, and un-applies it', async () => {
    await pick('a', '14000');
    await pick('b', '14000');
    expect(await rejectPlayerFix('5848', '14000')).toBe(true);
    expect(await readGlobalFixes()).toEqual({});
    expect(await readMyFixes('a')).toEqual({});
    expect(await readMyFixes('b')).toEqual({});
    expect(await pick('c', '14000')).toBe('blocked');
  });

  it('after a reject, another agreed candidate takes over', async () => {
    await pick('a', '14000');
    await pick('b', '14000');
    await pick('c', '15000');
    await pick('d', '15000');
    // A dispute: neither applies until the admin settles it.
    expect(await readGlobalFixes()).toEqual({});
    await rejectPlayerFix('5848', '14000');
    expect((await readGlobalFixes())['5848'].mfl).toBe('15000');
  });

  it('lists every player with a submission, with each candidate counted', async () => {
    await pick('a', '14000');
    await pick('b', '15000');
    await rejectPlayerFix('5848', '15000');
    const reviews = await listFixReviews();
    expect(reviews).toHaveLength(1);
    expect(reviews?.[0].subject.name).toBe('Hollywood Brown');
    expect(reviews?.[0].candidates).toEqual([
      { mfl: '14000', votes: 1, blocked: false },
      { mfl: '15000', votes: 0, blocked: true },
    ]);
  });

  it('buildFixReview keeps an applied pick nobody voted for', () => {
    const review = buildFixReview('1', { ...SUBJECT, at: '' }, {}, {}, { mfl: '9', source: 'admin', at: '' });
    expect(review.candidates).toEqual([{ mfl: '9', votes: 0, blocked: false }]);
  });
});

describe('finding the MFL player', () => {
  const index = [
    { id: '14000', name: 'Marquise Brown', position: 'WR', team: 'KC' },
    { id: '14001', name: 'Noah Brown', position: 'WR', team: 'WSH' },
    { id: '14002', name: 'Chase Brown', position: 'RB', team: 'CIN' },
    { id: '14003', name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET' },
  ];

  it('suggests same-position players sharing the last name', () => {
    expect(suggestMflPlayers(index, { name: 'Hollywood Brown', position: 'WR' }).map((p) => p.id)).toEqual([
      '14003',
      '14000',
      '14001',
    ]);
  });

  it('search ranks the position first and ignores a one-letter query', () => {
    expect(searchMflPlayers(index, 'brown', 'RB')[0].id).toBe('14002');
    expect(searchMflPlayers(index, 'b')).toEqual([]);
  });
});

describe('ids', () => {
  it('the client-safe prefix is the one rows carry', () => {
    expect(UNRESOLVED_PREFIX).toBe('sleeper:');
    expect(isUnresolvedPlayerId('sleeper:5848')).toBe(true);
    expect(isUnresolvedPlayerId('13116')).toBe(false);
  });

  it('a vote and a link are credited to the same hashed MFL username', () => {
    const key = sleeperViewerKey({ name: 'Brandon' });
    expect(key).toBe(sleeperViewerKey({ name: ' brandon ' }));
    expect(sleeperLinkKey({ name: 'Brandon' })).toBe(`live:sleeper:link:${key}`);
    expect(sleeperViewerKey({ name: '' })).toBeNull();
  });
});

describe('linking switches the new Sleeper leagues on', async () => {
  const { withLeaguesEnabled } = await import('../src/utils/mfl-live-selection');

  it('appends to an explicit selection, which would otherwise never widen', () => {
    expect(withLeaguesEnabled('13522,19621', ['sl-1', 'sl-2'])).toBe('13522,19621,sl-1,sl-2');
  });

  it('writes nothing when the default already includes them, or nothing is new', () => {
    expect(withLeaguesEnabled(undefined, ['sl-1'])).toBeNull();
    expect(withLeaguesEnabled('default', ['sl-1'])).toBeNull();
    expect(withLeaguesEnabled('13522,sl-1', ['sl-1'])).toBeNull();
    expect(withLeaguesEnabled('13522', [])).toBeNull();
  });
});
