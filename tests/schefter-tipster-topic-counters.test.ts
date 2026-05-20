/**
 * Per-tipster topic histogram — the "standing beat" data source.
 *
 * incrementTipsterTopicCounters mutates `schefter:tipster:topic_counts:{hash}`
 * (HASH topic → count) after a rumor ships. buildTipsterContext reads the
 * same hash on subsequent cycles to derive a `beat`, which anonymizeTips
 * surfaces as `tipsterBeat: { topic }` and HARD RULE 24 turns into a
 * "standing beat" voice cue (option B — codename NEVER attached).
 *
 * Contracts locked here:
 *   - one increment per (hash, topic) pair, not per tip (a tipster with two
 *     tips on the same topic counts +1, not +2)
 *   - web tips only; groupme + trade_offer are skipped
 *   - tip with no `topic` field falls back to "other"
 *   - dry-run is a true no-op
 *   - per-hash redis failure logs and continues; the post is never blocked
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs imported via allowJs
import { incrementTipsterTopicCounters } from '../scripts/lib/schefter-tipster-counters.mjs';

class FakeRedis {
  hashes: Map<string, Map<string, number>> = new Map();
  calls: Array<{ key: string; field: string; by: number }> = [];
  shouldThrow = false;
  async hincrby(key: string, field: string, by: number): Promise<number> {
    if (this.shouldThrow) throw new Error('redis down');
    const h = this.hashes.get(key) ?? new Map<string, number>();
    h.set(field, (h.get(field) ?? 0) + by);
    this.hashes.set(key, h);
    this.calls.push({ key, field, by });
    return h.get(field)!;
  }
}

describe('incrementTipsterTopicCounters', () => {
  it('no-ops when redis is missing', async () => {
    // No throw, no error — should silently return.
    await expect(incrementTipsterTopicCounters({
      redis: null,
      batch: [{ source: 'web', hashedOwnerId: 'aaaa1111', topic: 'trade' }],
    })).resolves.toBeUndefined();
  });

  it('no-ops on an empty batch', async () => {
    const redis = new FakeRedis();
    await incrementTipsterTopicCounters({ redis, batch: [] });
    expect(redis.calls).toEqual([]);
  });

  it('increments the topic count once per (hash, topic) pair', async () => {
    const redis = new FakeRedis();
    await incrementTipsterTopicCounters({
      redis,
      batch: [
        { source: 'web', hashedOwnerId: 'aaaa1111', topic: 'trade' },
        { source: 'web', hashedOwnerId: 'aaaa1111', topic: 'trade' },  // dedup
        { source: 'web', hashedOwnerId: 'aaaa1111', topic: 'roster' }, // distinct
        { source: 'web', hashedOwnerId: 'bbbb2222', topic: 'commish' },
      ],
    });
    const a = redis.hashes.get('schefter:tipster:topic_counts:aaaa1111');
    expect(a?.get('trade')).toBe(1);
    expect(a?.get('roster')).toBe(1);
    const b = redis.hashes.get('schefter:tipster:topic_counts:bbbb2222');
    expect(b?.get('commish')).toBe(1);
  });

  it('falls back to topic="other" when a tip is missing the field', async () => {
    const redis = new FakeRedis();
    await incrementTipsterTopicCounters({
      redis,
      batch: [{ source: 'web', hashedOwnerId: 'aaaa1111' }],
    });
    expect(redis.hashes.get('schefter:tipster:topic_counts:aaaa1111')?.get('other')).toBe(1);
  });

  it('skips groupme tips (they have their own attribution path)', async () => {
    const redis = new FakeRedis();
    await incrementTipsterTopicCounters({
      redis,
      batch: [{ source: 'groupme', hashedOwnerId: 'aaaa1111', topic: 'trade' }],
    });
    expect(redis.calls).toEqual([]);
  });

  it('skips trade_offer tips (no tipster identity at all)', async () => {
    const redis = new FakeRedis();
    await incrementTipsterTopicCounters({
      redis,
      batch: [{ source: 'trade_offer', topic: 'trade' }],
    });
    expect(redis.calls).toEqual([]);
  });

  it('skips tips with no hashedOwnerId', async () => {
    const redis = new FakeRedis();
    await incrementTipsterTopicCounters({
      redis,
      batch: [{ source: 'web', topic: 'trade' }],
    });
    expect(redis.calls).toEqual([]);
  });

  it('does NOT write counters in dry-run mode', async () => {
    const redis = new FakeRedis();
    const logs: string[] = [];
    await incrementTipsterTopicCounters({
      redis,
      batch: [{ source: 'web', hashedOwnerId: 'aaaa1111', topic: 'trade' }],
      dryRun: true,
      log: (m) => logs.push(m),
    });
    expect(redis.calls).toEqual([]);
    expect(logs.join('\n')).toMatch(/Would increment topic counters/);
  });

  it('logs and continues when redis throws on a single increment', async () => {
    const redis = new FakeRedis();
    redis.shouldThrow = true;
    const warns: string[] = [];
    await incrementTipsterTopicCounters({
      redis,
      batch: [{ source: 'web', hashedOwnerId: 'aaaa1111', topic: 'trade' }],
      warn: (m) => warns.push(m),
    });
    expect(warns.join('\n')).toMatch(/increment failed/);
  });
});
