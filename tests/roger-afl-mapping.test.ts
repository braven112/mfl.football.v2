/**
 * AFL enablement for Roger's reply lane: finding the group, and knowing whose
 * roster is whose.
 *
 * Two gaps stood between "Roger answers TheLeague" and "Roger answers the AFL",
 * and both are the kind that look like configuration but are really
 * correctness:
 *
 *  1. NO GROUP ID. Posting (`POST /v3/bots/post`) takes only a bot_id and never
 *     needs the group, which is why the AFL could be nagged for years with no
 *     group id stored anywhere. Reading needs one. Rather than mint a secret,
 *     the bot id names its own group via `GET /v3/bots`.
 *  2. NO OWNER MAP, and a namespace that made a wrong one dangerous — see the
 *     franchiseMapKeys tests in roger-clapback.test.ts. A wrong mapping is
 *     worse than none: Roger quotes one owner's roster while addressing
 *     another, and every number in it is real, so it reads as authoritative.
 *     Hence propose/apply, and the refusals pinned below.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveGroupIdForBot,
  resolveLeagueGroupId,
  fetchGroupMembers,
  groupIdCacheKey,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/lib/groupme-groups.mjs';
import {
  scoreMatch,
  proposeMapping,
  normalize,
  ownerMapKey,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/map-groupme-owners.mjs';
// @ts-ignore — .mjs via allowJs
import { franchiseMapKeys } from '../scripts/roger-groupme-reply.mjs';

const BOTS = [
  { bot_id: 'bot-theleague', group_id: 'group-111', name: 'Ask Roger' },
  { bot_id: 'bot-afl', group_id: 'group-222', name: 'Ask Roger (AFL)' },
];

function botsApi(bots = BOTS) {
  return async () => ({ ok: true, json: async () => ({ response: bots }) });
}

describe('resolveGroupIdForBot — the bot names its own group', () => {
  it('finds the group for a given bot id', async () => {
    expect(await resolveGroupIdForBot({ botId: 'bot-afl', fetchImpl: botsApi(), token: 't' })).toBe(
      'group-222',
    );
  });

  it('keeps the two leagues\' bots apart', async () => {
    expect(
      await resolveGroupIdForBot({ botId: 'bot-theleague', fetchImpl: botsApi(), token: 't' }),
    ).toBe('group-111');
  });

  it('returns null for a bot the token does not own', async () => {
    expect(await resolveGroupIdForBot({ botId: 'bot-nope', fetchImpl: botsApi(), token: 't' })).toBeNull();
  });

  it('returns null rather than throwing when the API fails', async () => {
    const failing = async () => ({ ok: false, status: 401, json: async () => ({}) });
    expect(await resolveGroupIdForBot({ botId: 'bot-afl', fetchImpl: failing, token: 't' })).toBeNull();
    const throwing = async () => {
      throw new Error('ECONNRESET');
    };
    expect(await resolveGroupIdForBot({ botId: 'bot-afl', fetchImpl: throwing, token: 't' })).toBeNull();
  });

  it('returns null with no token instead of calling out unauthenticated', async () => {
    let called = false;
    const spy = async () => {
      called = true;
      return { ok: true, json: async () => ({ response: BOTS }) };
    };
    expect(await resolveGroupIdForBot({ botId: 'bot-afl', fetchImpl: spy, token: null })).toBeNull();
    expect(called).toBe(false);
  });
});

describe('resolveLeagueGroupId — cheapest source wins', () => {
  const league = { slug: 'afl', groupMeRogerBotId: 'bot-afl' };

  it('prefers an explicitly configured id and makes no API call', async () => {
    let called = false;
    const spy = async () => {
      called = true;
      return { ok: true, json: async () => ({ response: BOTS }) };
    };
    const r = await resolveLeagueGroupId({
      league: { ...league, groupMeGroupId: 'explicit-999' },
      redis: null,
      fetchImpl: spy,
      token: 't',
    });
    expect(r).toEqual({ groupId: 'explicit-999', source: 'configured' });
    expect(called).toBe(false);
  });

  it('serves a cached id without an API call', async () => {
    let called = false;
    const redis = {
      get: async (k: string) => (k === groupIdCacheKey('afl') ? 'group-cached' : null),
      set: async () => 'OK',
    };
    const spy = async () => {
      called = true;
      return { ok: true, json: async () => ({ response: BOTS }) };
    };
    const r = await resolveLeagueGroupId({ league, redis, fetchImpl: spy, token: 't' });
    expect(r).toEqual({ groupId: 'group-cached', source: 'cache' });
    expect(called).toBe(false);
  });

  it('derives from the bot and caches the answer', async () => {
    const writes: Record<string, string> = {};
    const redis = {
      get: async () => null,
      set: async (k: string, v: string) => {
        writes[k] = v;
        return 'OK';
      },
    };
    const r = await resolveLeagueGroupId({ league, redis, fetchImpl: botsApi(), token: 't' });
    expect(r).toEqual({ groupId: 'group-222', source: 'derived' });
    expect(writes[groupIdCacheKey('afl')]).toBe('group-222');
  });

  it('still derives when Redis is unavailable', async () => {
    const r = await resolveLeagueGroupId({ league, redis: null, fetchImpl: botsApi(), token: 't' });
    expect(r.groupId).toBe('group-222');
  });

  it('reports unresolved rather than guessing a group', async () => {
    const r = await resolveLeagueGroupId({
      league: { slug: 'afl', groupMeRogerBotId: undefined },
      redis: null,
      fetchImpl: botsApi(),
      token: 't',
    });
    expect(r).toEqual({ groupId: null, source: 'unresolved' });
  });
});

describe('fetchGroupMembers', () => {
  it('returns the member list', async () => {
    const impl = async () => ({
      ok: true,
      json: async () => ({ response: { members: [{ user_id: 'u1', nickname: 'Smokane' }] } }),
    });
    const members = await fetchGroupMembers({ groupId: 'g', fetchImpl: impl, token: 't' });
    expect(members).toEqual([{ user_id: 'u1', nickname: 'Smokane' }]);
  });

  it('returns null on failure rather than an empty list', async () => {
    // An empty list would read as "the group has no members" and silently wipe
    // a mapping run; null is distinguishable and the caller bails.
    const impl = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchGroupMembers({ groupId: 'g', fetchImpl: impl, token: 't' })).toBeNull();
  });
});

// ── The matcher only saves typing; a human confirms it ──────────────────────

const AFL_TEAMS = [
  { franchiseId: '0001', name: 'Smokane FC', nameShort: 'Smokane FC', abbrev: 'SMOKE', aliases: ['Smokane'] },
  { franchiseId: '0008', name: 'Computer Jocks', nameShort: 'Computer Jocks', abbrev: 'JOCKS', aliases: [] },
  { franchiseId: '0015', name: 'Minty Fresh', nameShort: 'Minty Fresh', abbrev: 'MINT', aliases: [] },
];

describe('scoreMatch', () => {
  it('scores an exact team name highest', () => {
    expect(scoreMatch('Smokane FC', AFL_TEAMS[0])).toBe(100);
  });

  it('matches an alias', () => {
    expect(scoreMatch('Smokane', AFL_TEAMS[0])).toBe(100);
  });

  it('matches a nickname containing the team name', () => {
    expect(scoreMatch('Smokane FC (Dave)', AFL_TEAMS[0])).toBeGreaterThanOrEqual(70);
  });

  it('gives no credit to an unrelated nickname', () => {
    expect(scoreMatch('Dicks out for Harambe', AFL_TEAMS[0])).toBe(0);
  });

  it('ignores punctuation and case', () => {
    expect(normalize('Minty-Fresh!!')).toBe('mintyfresh');
    expect(scoreMatch('minty-fresh!!', AFL_TEAMS[2])).toBe(100);
  });
});

describe('proposeMapping', () => {
  it('produces a row for EVERY member, matched or not', () => {
    const members = [
      { user_id: 'u1', nickname: 'Smokane' },
      { user_id: 'u2', nickname: 'Dicks out for Harambe' },
    ];
    const rows = proposeMapping(members, AFL_TEAMS);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ userId: 'u2', franchiseId: null, confidence: 'none' });
  });

  it('leaves an unmatched member null rather than guessing a franchise', () => {
    const rows = proposeMapping([{ user_id: 'u9', nickname: 'zzzz' }], AFL_TEAMS);
    expect(rows[0].franchiseId).toBeNull();
  });

  it('never assigns one franchise to two members', () => {
    const members = [
      { user_id: 'u1', nickname: 'Smokane FC' },
      { user_id: 'u2', nickname: 'Smokane' },
    ];
    const rows = proposeMapping(members, AFL_TEAMS);
    const assigned = rows.map((r) => r.franchiseId).filter(Boolean);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it('lets the stronger match claim the franchise', () => {
    // Weak-first ordering would let a vague nickname take the team a clear one
    // wanted, pushing the real owner to null.
    const members = [
      { user_id: 'weak', nickname: 'jocks fan account' },
      { user_id: 'strong', nickname: 'Computer Jocks' },
    ];
    const rows = proposeMapping(members, AFL_TEAMS);
    expect(rows.find((r) => r.userId === 'strong')?.franchiseId).toBe('0008');
  });
});

describe('the written key matches what Roger reads', () => {
  it('agrees byte for byte with franchiseMapKeys', () => {
    // Two files, one namespace. If these drift, the mapping writes to a key
    // nothing reads and every AFL clapback silently goes factless.
    expect(ownerMapKey('afl', 'u1')).toBe(franchiseMapKeys('afl', 'u1')[0]);
    expect(ownerMapKey('theleague', 'u1')).toBe(franchiseMapKeys('theleague', 'u1')[0]);
  });
});
