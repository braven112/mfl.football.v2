/**
 * Tests for anonymous rumor-mill reactions.
 *
 * Anonymous mode stores reactor identity under the one-way tipster hash
 * (same salt as tips) in a dedicated `schefter:reactions:anon:` namespace.
 * The GET/batch responses must only ever return counts + the caller's own
 * reaction — never any other reactor's identity.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SCHEFTER_RUMOR_REACTIONS,
  isValidRumorReaction,
} from '../src/types/schefter';

// ── In-memory Upstash Redis fake ──
//
// Implements only the subset of the client used by schefter-reactions.ts
// (hgetall / hset / hdel / pipeline). Enough to exercise the anonymous
// toggle + fetch logic end-to-end without a live Upstash instance.

type Hash = Record<string, unknown>;

class FakeRedis {
  private store = new Map<string, Hash>();

  async hgetall<T = unknown>(key: string): Promise<Record<string, T> | null> {
    const h = this.store.get(key);
    if (!h) return null;
    return { ...(h as Record<string, T>) };
  }

  async hset(key: string, fieldValues: Record<string, unknown>): Promise<number> {
    const h = this.store.get(key) ?? {};
    let added = 0;
    for (const [k, v] of Object.entries(fieldValues)) {
      if (!(k in h)) added++;
      h[k] = v;
    }
    this.store.set(key, h);
    return added;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const h = this.store.get(key);
    if (!h) return 0;
    let n = 0;
    for (const f of fields) {
      if (f in h) {
        delete h[f];
        n++;
      }
    }
    if (Object.keys(h).length === 0) this.store.delete(key);
    return n;
  }

  async hget<T = unknown>(key: string, field: string): Promise<T | null> {
    const h = this.store.get(key);
    if (!h) return null;
    return (h[field] as T) ?? null;
  }

  private sets = new Map<string, Set<string>>();
  /** Every HGETALL the code issues — what Upstash bills per pipeline entry. */
  hgetallCalls = 0;

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    for (const m of members) set.add(m);
    this.sets.set(key, set);
    return set.size - before;
  }

  async smembers<T = string>(key: string): Promise<T[]> {
    return [...(this.sets.get(key) ?? [])] as unknown as T[];
  }

  async scan(_cursor: number | string, opts: { match?: string } = {}): Promise<[string, string[]]> {
    const prefix = (opts.match ?? '*').replace(/\*$/, '');
    return ['0', [...this.store.keys(), ...this.sets.keys()].filter((k) => k.startsWith(prefix))];
  }

  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const self = this;
    return {
      hgetall(key: string) {
        self.hgetallCalls++;
        ops.push(() => self.hgetall(key));
      },
      async exec<T>(): Promise<T> {
        const results = await Promise.all(ops.map((fn) => fn()));
        return results as unknown as T;
      },
    };
  }

  _reset() {
    this.store.clear();
    this.sets.clear();
    this.hgetallCalls = 0;
  }

  _raw(key: string) {
    return this.store.get(key);
  }
}

const fakeRedis = new FakeRedis();

// Replace the dynamic @upstash/redis import with our fake.
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return fakeRedis;
    }
  },
}));

// Required for hashTipsterId inside the API layer (not used here directly,
// but present for completeness if the tests ever exercise POST routes).
process.env.UPSTASH_REDIS_REST_URL = 'http://fake';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake';
process.env.SCHEFTER_TIPSTER_SALT = 'test-salt';

const POST_ID = 'sf_rumor_1000_abc';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

describe('anonymous rumor reactions', () => {
  let mod: typeof import('../src/utils/schefter-reactions');

  beforeEach(async () => {
    fakeRedis._reset();
    vi.resetModules();
    mod = await import('../src/utils/schefter-reactions');
  });

  it('locks the emoji set to the four verdicts', () => {
    expect(SCHEFTER_RUMOR_REACTIONS).toEqual(['🔥', '💯', '🤔', '📉']);
    expect(isValidRumorReaction('🔥')).toBe(true);
    expect(isValidRumorReaction('❤️')).toBe(false);
    expect(mod.isValidRumorReactionEmoji('💩')).toBe(false);
  });

  it('rejects emoji outside the rumor set (toggle returns null)', async () => {
    const out = await mod.toggleAnonymousReaction(POST_ID, HASH_A, '❤️');
    expect(out).toBeNull();
    // Nothing should have been written.
    expect(fakeRedis._raw(`schefter:reactions:anon:${POST_ID}`)).toBeUndefined();
  });

  it('writes to the anonymous key namespace (never the identified one)', async () => {
    await mod.toggleAnonymousReaction(POST_ID, HASH_A, '🔥');
    expect(fakeRedis._raw(`schefter:reactions:anon:${POST_ID}`)).toBeDefined();
    expect(fakeRedis._raw(`schefter:reactions:${POST_ID}`)).toBeUndefined();
  });

  it('returns only counts and the caller’s own reaction — never other reactors', async () => {
    await mod.toggleAnonymousReaction(POST_ID, HASH_A, '🔥');
    await mod.toggleAnonymousReaction(POST_ID, HASH_B, '🔥');
    await mod.toggleAnonymousReaction(POST_ID, HASH_C, '💯');

    const asA = await mod.getAnonymousReactions(POST_ID, HASH_A);
    expect(asA.reactions).toEqual({ '🔥': 2, '💯': 1 });
    expect(asA.userReaction).toBe('🔥');

    const anon = await mod.getAnonymousReactions(POST_ID);
    expect(anon.reactions).toEqual({ '🔥': 2, '💯': 1 });
    expect(anon.userReaction).toBeNull();

    // Spot-check the serialized response shape — no raw hash lists.
    const serialized = JSON.stringify(anon);
    expect(serialized).not.toContain(HASH_A);
    expect(serialized).not.toContain(HASH_B);
    expect(serialized).not.toContain(HASH_C);
  });

  it('swaps the caller’s reaction when they pick a different emoji', async () => {
    await mod.toggleAnonymousReaction(POST_ID, HASH_A, '🔥');
    await mod.toggleAnonymousReaction(POST_ID, HASH_A, '🤔');

    const after = await mod.getAnonymousReactions(POST_ID, HASH_A);
    expect(after.reactions).toEqual({ '🤔': 1 });
    expect(after.userReaction).toBe('🤔');
  });

  it('removes the caller when they click their current reaction (toggle off)', async () => {
    await mod.toggleAnonymousReaction(POST_ID, HASH_A, '🔥');
    const off = await mod.toggleAnonymousReaction(POST_ID, HASH_A, '🔥');
    expect(off).toBeNull();

    const after = await mod.getAnonymousReactions(POST_ID, HASH_A);
    expect(after.reactions).toEqual({});
    expect(after.userReaction).toBeNull();
  });

  it('batch-fetch returns counts only and preserves per-caller reaction flag', async () => {
    const postA = 'sf_rumor_1_a';
    const postB = 'sf_rumor_2_b';
    await mod.toggleAnonymousReaction(postA, HASH_A, '🔥');
    await mod.toggleAnonymousReaction(postA, HASH_B, '💯');
    await mod.toggleAnonymousReaction(postB, HASH_B, '📉');

    const batch = await mod.getBatchAnonymousReactions([postA, postB], HASH_A);
    expect(batch[postA].reactions).toEqual({ '🔥': 1, '💯': 1 });
    expect(batch[postA].userReaction).toBe('🔥');
    expect(batch[postB].reactions).toEqual({ '📉': 1 });
    expect(batch[postB].userReaction).toBeNull();

    const serialized = JSON.stringify(batch);
    expect(serialized).not.toContain(HASH_A);
    expect(serialized).not.toContain(HASH_B);
  });

  it('identified reactions never cross-contaminate the anonymous namespace', async () => {
    // A reaction written via the regular (non-anonymous) path should NOT show
    // up in the anonymous getter — and vice versa.
    await mod.toggleReaction(POST_ID, '0001', '🔥');
    const anon = await mod.getAnonymousReactions(POST_ID, HASH_A);
    expect(anon.reactions).toEqual({});

    await mod.toggleAnonymousReaction(POST_ID, HASH_A, '🤔');
    const identified = await mod.getReactions(POST_ID, '0001');
    // Identified side still only has the original reaction; anonymous write
    // did not leak into the identified namespace.
    expect(identified.reactions).toEqual({ '🔥': 1 });
  });

  it('batch reads only the hashes of posts that were ever reacted to', async () => {
    await mod.toggleReaction('sf_a', '0001', '🔥');
    await mod.toggleAnonymousReaction('sf_rumor_b', HASH_A, '🔥');
    const ids = Array.from({ length: 500 }, (_, i) => `sf_quiet_${i}`);
    fakeRedis.hgetallCalls = 0;

    const regular = await mod.getBatchReactions(['sf_a', ...ids], '0001');
    const anon = await mod.getBatchAnonymousReactions(['sf_rumor_b', ...ids], HASH_A);

    expect(regular.sf_a).toEqual({ reactions: { '🔥': 1 }, userReaction: '🔥' });
    expect(anon.sf_rumor_b).toEqual({ reactions: { '🔥': 1 }, userReaction: '🔥' });
    expect(regular.sf_quiet_7).toEqual({ reactions: {}, userReaction: null });
    expect(anon.sf_quiet_7).toEqual({ reactions: {}, userReaction: null });
    expect(fakeRedis.hgetallCalls).toBe(2);
  });

  it('seeds the index from reaction hashes written before it existed', async () => {
    // Hashes as the pre-index code left them: no index set at all.
    await fakeRedis.hset('schefter:reactions:sf_old', { '🔥': ['0002'] });
    await fakeRedis.hset('schefter:reactions:anon:sf_rumor_old', { '💯': [HASH_B] });

    const regular = await mod.getBatchReactions(['sf_old', 'sf_rumor_old']);
    const anon = await mod.getBatchAnonymousReactions(['sf_old', 'sf_rumor_old']);

    expect(regular.sf_old.reactions).toEqual({ '🔥': 1 });
    expect(regular.sf_rumor_old.reactions).toEqual({});
    expect(anon.sf_rumor_old.reactions).toEqual({ '💯': 1 });
    expect(anon.sf_old.reactions).toEqual({});
  });
});
