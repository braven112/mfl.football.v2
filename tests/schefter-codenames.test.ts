/**
 * Tests for Schefter tipster codename assignment.
 *
 * Contract:
 *  - Codenames are unique per owner — no "#N" suffix reuse.
 *  - Seed slot is deterministic from the hash (stable across retries).
 *  - Collision path advances through the list from the seed slot.
 *  - All 29 base names exhausted → fallback name that includes the first 4
 *    chars of the hash so leagues larger than the list still get unique names.
 *  - Function is idempotent: second call for the same user returns the same
 *    name without issuing a new one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SCHEFTER_CODENAMES,
  assignCodename,
  getCodename,
  seedSlotForHash,
  CODENAME_KEY_PREFIX,
  CODENAMES_USED_KEY,
} from '../src/utils/schefter-codenames';

/** Minimal Redis stand-in matching the CodenameRedis contract. */
class FakeRedis {
  private strings = new Map<string, string>();
  private sets = new Map<string, Set<string>>();

  async get<T>(key: string): Promise<T | null> {
    const v = this.strings.get(key);
    return (v === undefined ? null : v) as T | null;
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean }): Promise<unknown> {
    if (opts?.nx && this.strings.has(key)) return null;
    this.strings.set(key, String(value));
    return 'OK';
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added++;
      }
    }
    this.sets.set(key, set);
    return added;
  }
  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed++;
    }
    return removed;
  }
  _reset() {
    this.strings.clear();
    this.sets.clear();
  }
  _seedAllUsedExcept(excluded: Set<string>) {
    const used = new Set<string>();
    for (const name of SCHEFTER_CODENAMES) {
      if (!excluded.has(name)) used.add(name);
    }
    this.sets.set(CODENAMES_USED_KEY, used);
  }
  _snapshot() {
    return {
      strings: new Map(this.strings),
      sets: new Map([...this.sets.entries()].map(([k, v]) => [k, new Set(v)])),
    };
  }
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

describe('seedSlotForHash', () => {
  it('is deterministic for the same hash', () => {
    expect(seedSlotForHash(HASH_A)).toBe(seedSlotForHash(HASH_A));
  });

  it('stays in range for any non-empty hash', () => {
    for (const h of [HASH_A, HASH_B, HASH_C, '0'.repeat(64), 'deadbeef' + '0'.repeat(56)]) {
      const slot = seedSlotForHash(h);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(SCHEFTER_CODENAMES.length);
    }
  });

  it('returns 0 for empty / malformed input', () => {
    expect(seedSlotForHash('')).toBe(0);
  });
});

describe('assignCodename', () => {
  const redis = new FakeRedis();

  beforeEach(() => {
    redis._reset();
  });

  it('issues a codename from the SCHEFTER_CODENAMES list', async () => {
    const name = await assignCodename(redis, HASH_A);
    expect(SCHEFTER_CODENAMES).toContain(name as typeof SCHEFTER_CODENAMES[number]);
  });

  it('is idempotent — second call returns the same name without claiming another', async () => {
    const first = await assignCodename(redis, HASH_A);
    const snap = redis._snapshot();
    const usedBefore = snap.sets.get(CODENAMES_USED_KEY)?.size ?? 0;

    const second = await assignCodename(redis, HASH_A);
    expect(second).toBe(first);
    const usedAfter = redis._snapshot().sets.get(CODENAMES_USED_KEY)?.size ?? 0;
    expect(usedAfter).toBe(usedBefore);
  });

  it('returns the hash-seeded name when the set is empty', async () => {
    const slot = seedSlotForHash(HASH_A);
    const name = await assignCodename(redis, HASH_A);
    expect(name).toBe(SCHEFTER_CODENAMES[slot]);
  });

  it('advances through the list when the seeded slot is already taken', async () => {
    // Pre-claim the slot A would seed into — A must pick the next one.
    const slotA = seedSlotForHash(HASH_A);
    const taken = SCHEFTER_CODENAMES[slotA];
    await redis.sadd(CODENAMES_USED_KEY, taken);

    const name = await assignCodename(redis, HASH_A);
    expect(name).not.toBe(taken);
    expect(SCHEFTER_CODENAMES).toContain(name as typeof SCHEFTER_CODENAMES[number]);
  });

  it('never issues the same codename to two different owners', async () => {
    const nameA = await assignCodename(redis, HASH_A);
    const nameB = await assignCodename(redis, HASH_B);
    const nameC = await assignCodename(redis, HASH_C);
    const set = new Set([nameA, nameB, nameC]);
    expect(set.size).toBe(3);
  });

  it('falls back to a hash-suffixed name when every base name is taken', async () => {
    redis._seedAllUsedExcept(new Set()); // all 29 claimed

    const name = await assignCodename(redis, HASH_A);
    expect(name).toMatch(new RegExp(`${HASH_A.slice(0, 4)}$`));
    // Fallback still persists the assignment so subsequent calls are idempotent.
    const again = await assignCodename(redis, HASH_A);
    expect(again).toBe(name);
  });

  it('persists the assignment under the codename key namespace', async () => {
    const name = await assignCodename(redis, HASH_A);
    const stored = await redis.get<string>(`${CODENAME_KEY_PREFIX}${HASH_A}`);
    expect(stored).toBe(name);
  });
});

describe('getCodename', () => {
  const redis = new FakeRedis();

  beforeEach(() => {
    redis._reset();
  });

  it('returns null for a tipster with no assignment', async () => {
    expect(await getCodename(redis, HASH_A)).toBeNull();
  });

  it('returns the assigned name after assignCodename', async () => {
    const name = await assignCodename(redis, HASH_A);
    expect(await getCodename(redis, HASH_A)).toBe(name);
  });
});
