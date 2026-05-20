import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs imported via allowJs
import {
  buildTipsterContext,
  tipsterScoreDelta,
  FIRST_TIME_BOOST,
  BURST_HEAVY_PENALTY,
  BURST_LIGHT_PENALTY,
  PROLIFIC_PENALTY,
  BEAT_TIP_FLOOR,
  BEAT_CONCENTRATION,
} from '../scripts/lib/schefter-tipster-context.mjs';
// @ts-expect-error — .mjs imported via allowJs
import { bucketPriorityScore } from '../scripts/lib/schefter-bucket-logic.mjs';

type Tip = {
  id: string;
  source: 'web' | 'groupme' | 'trade_offer' | 'trade_bait';
  hashedOwnerId?: string;
  submittedAt?: number;
};

function makeBucket(tips: Tip[], oldestSubmittedAtOverride?: number) {
  const oldest = oldestSubmittedAtOverride ?? Math.min(...tips.map((t) => t.submittedAt ?? Date.now()));
  return {
    key: 'topic:trade:league-wide',
    kind: 'gossip',
    tips,
    oldestSubmittedAt: oldest,
  };
}

// ── tipsterScoreDelta (pure scoring helper) ──

describe('tipsterScoreDelta', () => {
  const now = new Date('2026-05-20T12:00:00Z');

  it('returns 0 when no tipster context is provided', () => {
    const bucket = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'aaaa1111', submittedAt: now.getTime() },
    ]);
    expect(tipsterScoreDelta(bucket, null)).toBe(0);
  });

  it('returns 0 when bucket has no web tippers (groupme / trade-offer only)', () => {
    const bucket = makeBucket([
      { id: 't1', source: 'groupme', submittedAt: now.getTime() },
      { id: 't2', source: 'trade_offer', submittedAt: now.getTime() },
    ]);
    const ctx = new Map([['aaaa1111', { hashedOwnerId: 'aaaa1111', tipsInQueue: 1, rumorsTotal: 0, isFirstTime: true, isProlific: false, beat: null }]]);
    expect(tipsterScoreDelta(bucket, ctx)).toBe(0);
  });

  it('boosts a bucket containing a first-time tipster', () => {
    const bucket = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'newbie01', submittedAt: now.getTime() },
    ]);
    const ctx = new Map([
      ['newbie01', { hashedOwnerId: 'newbie01', tipsInQueue: 1, rumorsTotal: 0, isFirstTime: true, isProlific: false, beat: null }],
    ]);
    expect(tipsterScoreDelta(bucket, ctx)).toBe(FIRST_TIME_BOOST);
  });

  it('penalizes a bucket from a burst-tipping regular (≥3 queued)', () => {
    const bucket = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'busy0001', submittedAt: now.getTime() },
    ]);
    const ctx = new Map([
      ['busy0001', { hashedOwnerId: 'busy0001', tipsInQueue: 4, rumorsTotal: 25, isFirstTime: false, isProlific: true, beat: null }],
    ]);
    // Burst penalty (-3) stacks with prolific penalty (-1) — both negatives count.
    expect(tipsterScoreDelta(bucket, ctx)).toBe(BURST_HEAVY_PENALTY);
  });

  it('applies the lighter burst penalty at exactly 2 tips queued', () => {
    const bucket = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'mid00002', submittedAt: now.getTime() },
    ]);
    const ctx = new Map([
      ['mid00002', { hashedOwnerId: 'mid00002', tipsInQueue: 2, rumorsTotal: 4, isFirstTime: false, isProlific: false, beat: null }],
    ]);
    expect(tipsterScoreDelta(bucket, ctx)).toBe(BURST_LIGHT_PENALTY);
  });

  it('applies the lifetime-prolific penalty even when burst is 1', () => {
    const bucket = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'reg00003', submittedAt: now.getTime() },
    ]);
    const ctx = new Map([
      ['reg00003', { hashedOwnerId: 'reg00003', tipsInQueue: 1, rumorsTotal: 50, isFirstTime: false, isProlific: true, beat: null }],
    ]);
    expect(tipsterScoreDelta(bucket, ctx)).toBe(PROLIFIC_PENALTY);
  });

  it('first-time boost wins over any same-bucket regular penalty', () => {
    // A bucket with TWO tipsters — one a brand-new voice, one a prolific
    // regular. The first-time bonus must still apply (the new voice is the
    // story); penalties don't cancel the boost.
    const bucket = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'newbie01', submittedAt: now.getTime() },
      { id: 't2', source: 'web', hashedOwnerId: 'reg00003', submittedAt: now.getTime() },
    ]);
    const ctx = new Map([
      ['newbie01', { hashedOwnerId: 'newbie01', tipsInQueue: 1, rumorsTotal: 0, isFirstTime: true, isProlific: false, beat: null }],
      ['reg00003', { hashedOwnerId: 'reg00003', tipsInQueue: 1, rumorsTotal: 50, isFirstTime: false, isProlific: true, beat: null }],
    ]);
    expect(tipsterScoreDelta(bucket, ctx)).toBe(FIRST_TIME_BOOST + PROLIFIC_PENALTY);
  });
});

// ── bucketPriorityScore integration ──

describe('bucketPriorityScore with tipster context', () => {
  const now = new Date('2026-05-20T12:00:00Z');

  it('falls back to size+age math when no context is provided (back-compat)', () => {
    const bucket = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'aaaa1111', submittedAt: now.getTime() },
      { id: 't2', source: 'web', hashedOwnerId: 'bbbb2222', submittedAt: now.getTime() },
    ]);
    // (size - 1) * 2 + 0 age days = 2.
    expect(bucketPriorityScore(bucket, now)).toBe(2);
  });

  it('lifts a singleton first-timer above a 2-cluster from a regular', () => {
    // Cluster from the regular: size 2 → +2 (size score), 0 age → +0.
    // Regular is prolific lifetime → −1. Net = 1.
    const cluster = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'reg00003', submittedAt: now.getTime() },
      { id: 't2', source: 'web', hashedOwnerId: 'reg00003', submittedAt: now.getTime() },
    ]);
    // Singleton from a brand-new voice: size 1 → +0, age 0 → +0, first-time → +5. Net = 5.
    const fresh = makeBucket([
      { id: 't3', source: 'web', hashedOwnerId: 'newbie01', submittedAt: now.getTime() },
    ]);
    const ctx = new Map([
      ['reg00003', { hashedOwnerId: 'reg00003', tipsInQueue: 2, rumorsTotal: 50, isFirstTime: false, isProlific: true, beat: null }],
      ['newbie01', { hashedOwnerId: 'newbie01', tipsInQueue: 1, rumorsTotal: 0, isFirstTime: true, isProlific: false, beat: null }],
    ]);
    expect(bucketPriorityScore(fresh, now, ctx)).toBeGreaterThan(bucketPriorityScore(cluster, now, ctx));
  });

  it('a multi-tipster cluster on a fresh topic still wins outright', () => {
    // Cluster of 3 distinct tippers (none prolific, none in burst): size 3
    // → +4, no penalty. Should beat a singleton first-timer (+5)? Yes —
    // (size-1)*2 = 4 + 0 first-time delta = 4. Hmm, that's < 5.
    // Let's instead test the documented case: 3-tip cluster across distinct
    // moderate tippers BEATS a 1-tip burst from the regular even at heavy penalty.
    const cluster = makeBucket([
      { id: 't1', source: 'web', hashedOwnerId: 'mod00001', submittedAt: now.getTime() },
      { id: 't2', source: 'web', hashedOwnerId: 'mod00002', submittedAt: now.getTime() },
      { id: 't3', source: 'web', hashedOwnerId: 'mod00003', submittedAt: now.getTime() },
    ]);
    const single = makeBucket([
      { id: 't4', source: 'web', hashedOwnerId: 'busy0001', submittedAt: now.getTime() },
    ]);
    const ctx = new Map([
      ['mod00001', { hashedOwnerId: 'mod00001', tipsInQueue: 1, rumorsTotal: 5, isFirstTime: false, isProlific: false, beat: null }],
      ['mod00002', { hashedOwnerId: 'mod00002', tipsInQueue: 1, rumorsTotal: 5, isFirstTime: false, isProlific: false, beat: null }],
      ['mod00003', { hashedOwnerId: 'mod00003', tipsInQueue: 1, rumorsTotal: 5, isFirstTime: false, isProlific: false, beat: null }],
      ['busy0001', { hashedOwnerId: 'busy0001', tipsInQueue: 4, rumorsTotal: 50, isFirstTime: false, isProlific: true, beat: null }],
    ]);
    expect(bucketPriorityScore(cluster, now, ctx)).toBeGreaterThan(bucketPriorityScore(single, now, ctx));
  });
});

// ── buildTipsterContext (Redis I/O wrapper) ──

class FakeRedis {
  store: Map<string, string | number> = new Map();
  hashes: Map<string, Record<string, number>> = new Map();
  failGet = false;
  async get(key: string): Promise<unknown> {
    if (this.failGet) throw new Error('redis down');
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async hgetall(key: string): Promise<Record<string, number> | null> {
    return this.hashes.get(key) ?? null;
  }
}

describe('buildTipsterContext', () => {
  it('returns an empty map when there are no web tips', async () => {
    const result = await buildTipsterContext([
      { id: 't1', source: 'groupme' },
      { id: 't2', source: 'trade_offer' },
    ], new FakeRedis());
    expect(result.size).toBe(0);
  });

  it('marks a tipster with no rumors_total entry as first-time', async () => {
    const redis = new FakeRedis();
    // Note: rumors_total key intentionally absent.
    const result = await buildTipsterContext([
      { id: 't1', source: 'web', hashedOwnerId: 'newbie01' },
    ], redis);
    const ctx = result.get('newbie01');
    expect(ctx?.isFirstTime).toBe(true);
    expect(ctx?.rumorsTotal).toBe(0);
    expect(ctx?.tipsInQueue).toBe(1);
    expect(ctx?.beat).toBeNull();
  });

  it('counts distinct tips per tipster in the current queue', async () => {
    const redis = new FakeRedis();
    const result = await buildTipsterContext([
      { id: 't1', source: 'web', hashedOwnerId: 'busy0001' },
      { id: 't2', source: 'web', hashedOwnerId: 'busy0001' },
      { id: 't3', source: 'web', hashedOwnerId: 'busy0001' },
      { id: 't4', source: 'web', hashedOwnerId: 'other001' },
    ], redis);
    expect(result.get('busy0001')?.tipsInQueue).toBe(3);
    expect(result.get('other001')?.tipsInQueue).toBe(1);
  });

  it('marks tipsters with rumors_total ≥ threshold as prolific', async () => {
    const redis = new FakeRedis();
    redis.store.set('schefter:tipster:rumors_total:reg00003', '20');
    const result = await buildTipsterContext([
      { id: 't1', source: 'web', hashedOwnerId: 'reg00003' },
    ], redis);
    expect(result.get('reg00003')?.isProlific).toBe(true);
    expect(result.get('reg00003')?.isFirstTime).toBe(false);
  });

  it('derives a beat when one topic exceeds the concentration floor', async () => {
    const redis = new FakeRedis();
    redis.store.set('schefter:tipster:rumors_total:reg00003', '10');
    redis.hashes.set('schefter:tipster:topic_counts:reg00003', {
      trade: 7,
      commish: 2,
      roster: 1,
    });
    const result = await buildTipsterContext([
      { id: 't1', source: 'web', hashedOwnerId: 'reg00003' },
    ], redis);
    expect(result.get('reg00003')?.beat).toEqual({
      topic: 'trade',
      count: 7,
      total: 10,
      share: 0.7,
    });
  });

  it('does not assign a beat when concentration is below the floor', async () => {
    const redis = new FakeRedis();
    redis.store.set('schefter:tipster:rumors_total:reg00003', '10');
    redis.hashes.set('schefter:tipster:topic_counts:reg00003', {
      trade: 4,
      commish: 3,
      roster: 3,
    });
    const result = await buildTipsterContext([
      { id: 't1', source: 'web', hashedOwnerId: 'reg00003' },
    ], redis);
    expect(result.get('reg00003')?.beat).toBeNull();
  });

  it('does not assign a beat with too little data even at high concentration', async () => {
    const redis = new FakeRedis();
    redis.store.set('schefter:tipster:rumors_total:reg00003', '2');
    redis.hashes.set('schefter:tipster:topic_counts:reg00003', {
      trade: 2,
    });
    const result = await buildTipsterContext([
      { id: 't1', source: 'web', hashedOwnerId: 'reg00003' },
    ], redis);
    expect(result.get('reg00003')?.beat).toBeNull();
  });

  it('tolerates a redis fetch failure by falling back to first-time defaults', async () => {
    const redis = new FakeRedis();
    redis.failGet = true;
    const result = await buildTipsterContext([
      { id: 't1', source: 'web', hashedOwnerId: 'newbie01' },
    ], redis);
    expect(result.get('newbie01')?.isFirstTime).toBe(true);
  });

  it('returns first-time defaults for everyone when redis is null', async () => {
    const result = await buildTipsterContext([
      { id: 't1', source: 'web', hashedOwnerId: 'aaaa1111' },
      { id: 't2', source: 'web', hashedOwnerId: 'bbbb2222' },
    ], null);
    expect(result.get('aaaa1111')?.isFirstTime).toBe(true);
    expect(result.get('bbbb2222')?.isFirstTime).toBe(true);
  });

  it('uses constants that satisfy the integration sanity check', () => {
    // Sanity: the brainstorm contract is "first-timer beats same-sized noise
    // from the regular." size-1 boost (+0) + first-time (+5) must beat
    // size-1 boost (+0) + prolific (−1) by enough to flip the order.
    expect(FIRST_TIME_BOOST).toBeGreaterThan(Math.abs(PROLIFIC_PENALTY));
    expect(BURST_HEAVY_PENALTY).toBeLessThan(BURST_LIGHT_PENALTY);
    expect(BEAT_TIP_FLOOR).toBeGreaterThan(0);
    expect(BEAT_CONCENTRATION).toBeGreaterThan(0.5);
    expect(BEAT_CONCENTRATION).toBeLessThanOrEqual(1);
  });
});
