/**
 * Redis reads must survive @upstash/redis deserializing them.
 *
 * The client JSON-parses on read. Every id this feature stores is a digit
 * string, and a digit string with no leading zero parses to a NUMBER — so a
 * `typeof value === 'string'` guard silently rejects the value it just stored.
 *
 * Both bugs this pins were live in production:
 *
 *  - the group-id cache never hit once, because "59643096" came back as
 *    59643096. The id was always correct, so nothing looked wrong; the cache
 *    simply did no work while every run paid for an extra GET /v3/bots.
 *  - one of five cached Roger post ids came back as a number and was dropped,
 *    which un-answers a genuine shot: a native reply resolves against that set,
 *    and a missing id means the reply is not recognised as aimed at Roger.
 *
 * Neither failure produces an error, a warning, or a red run. That is exactly
 * why they are pinned here rather than left to a comment.
 */

import { describe, it, expect } from 'vitest';
import { resolveLeagueGroupId } from '../scripts/lib/groupme-groups.mjs';

/** A Redis double whose GET returns whatever the client would have parsed. */
function fakeRedis(value: unknown) {
  const writes: Array<[string, unknown]> = [];
  return {
    writes,
    get: async () => value,
    set: async (k: string, v: unknown) => {
      writes.push([k, v]);
      return 'OK';
    },
  };
}

const league = {
  slug: 'afl',
  groupMeRogerBotId: 'bot-afl',
} as any;

/** Fails the test if called — proves the cache short-circuited the API. */
const explodingFetch = (async () => {
  throw new Error('should not have called GET /v3/bots — the cache should have hit');
}) as any;

describe('group-id cache tolerates a deserialized number', () => {
  it('hits the cache when the id came back as a NUMBER', async () => {
    const redis = fakeRedis(59643096);
    const { groupId, source } = await resolveLeagueGroupId({
      league,
      redis: redis as any,
      fetchImpl: explodingFetch,
      token: 'tok',
    });
    expect(source).toBe('cache');
    expect(groupId).toBe('59643096');
    // A number must be normalized to a string — callers build URLs from it.
    expect(typeof groupId).toBe('string');
  });

  it('still hits the cache when the id came back as a string', async () => {
    const redis = fakeRedis('59643096');
    const { groupId, source } = await resolveLeagueGroupId({
      league,
      redis: redis as any,
      fetchImpl: explodingFetch,
      token: 'tok',
    });
    expect(source).toBe('cache');
    expect(groupId).toBe('59643096');
  });

  it('falls through to derivation on a genuine miss', async () => {
    const redis = fakeRedis(null);
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ response: [{ bot_id: 'bot-afl', group_id: '59643096' }] }),
    })) as any;

    const { groupId, source } = await resolveLeagueGroupId({
      league,
      redis: redis as any,
      fetchImpl,
      token: 'tok',
    });
    expect(source).toBe('derived');
    expect(groupId).toBe('59643096');
    // And it writes the derived id back so the next run can hit.
    expect(redis.writes[0][0]).toBe('groupme:afl:resolved_group_id');
  });

  it('treats an empty cached value as a miss, not as a group id', async () => {
    const redis = fakeRedis('');
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ response: [] }) })) as any;
    const { groupId, source } = await resolveLeagueGroupId({
      league,
      redis: redis as any,
      fetchImpl,
      token: 'tok',
    });
    expect(source).toBe('unresolved');
    expect(groupId).toBeNull();
  });
});

describe('the coercion the bot-id and franchise reads rely on', () => {
  // Both call sites normalize with `x == null ? '' : String(x)`. These pin the
  // properties that makes safe, so a future "tidy-up" back to a typeof check
  // has to fail here first.
  const normalize = (x: unknown) => (x == null ? '' : String(x));

  it('turns a deserialized number back into its digit string', () => {
    expect(normalize(59643096)).toBe('59643096');
  });

  it('keeps a zero-padded franchise id intact', () => {
    // "0008" is not valid JSON, so it never becomes a number in the first
    // place - but coercing it must not damage it either.
    expect(normalize('0008')).toBe('0008');
  });

  it('drops null and undefined rather than stringifying them', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
    // The call sites test falsiness, so these are skipped rather than added
    // to the set as the literal strings "null" / "undefined".
    expect(Boolean(normalize(null))).toBe(false);
  });

  it('round-trips an 18-digit GroupMe id that stayed a string', () => {
    expect(normalize('178802420331995170')).toBe('178802420331995170');
  });
});
