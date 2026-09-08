/**
 * Trade-Builder Drafts as a Tip Source.
 *
 * Saved trade-builder drafts feed Schefter's rumor mill as a *softer* shopping
 * signal than submitted offers. This file pins the contract:
 *
 *   - drafts decay in 3 days (vs. 7 for submitted offers)
 *   - each draft offerer counts as 0.4 of a real offerer (discount)
 *   - draft contribution can elevate a player from `base` to `tightened_circle`
 *     (n=3) but MUST NOT unlock the `named` tier (n>=4) on its own
 *   - per-run posting probability scales exponentially with the most-shopped
 *     player's effective offerer count, capped at 4× base
 *   - drafts NEVER on their own create a rumor — only blend into existing
 *     real-offer escalation/probability
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  offerPostProbability,
  OFFER_POST_PROBABILITY,
  OFFER_VOLUME_BOOST_FACTOR,
  OFFER_VOLUME_BOOST_MAX,
  OFFER_PROBABILITY_CEILING,
  tierForDistinctOfferers,
} from '../scripts/lib/redact-trade-offer.mjs';
import {
  TB_DRAFT_OFFERER_WEIGHT,
  TB_DRAFT_WINDOW_MS,
  TB_DRAFT_PLAYER_KEY_PREFIX,
  TB_DRAFT_OWNER_KEY_PREFIX,
  scanDraftTrades,
  getDraftOfferersForPlayer,
  getOwnerDraftCount,
} from '../scripts/lib/scan-draft-trades.mjs';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('trade-builder draft constants', () => {
  it('decays drafts in 3 days', () => {
    expect(TB_DRAFT_WINDOW_MS).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it('weights one saved draft as 0.4 of a real offerer', () => {
    expect(TB_DRAFT_OFFERER_WEIGHT).toBe(0.4);
  });

  it('uses dedicated Redis namespace prefixes', () => {
    expect(TB_DRAFT_PLAYER_KEY_PREFIX).toBe('schefter:tb_drafts:player:');
    expect(TB_DRAFT_OWNER_KEY_PREFIX).toBe('schefter:tb_drafts:owner:');
  });
});

describe('offerPostProbability — exponential scaling on shopping volume', () => {
  it('returns the flat base probability for a single offerer', () => {
    expect(offerPostProbability(1)).toBeCloseTo(OFFER_POST_PROBABILITY);
  });

  it('treats missing/zero/NaN offerers as the floor (1)', () => {
    expect(offerPostProbability()).toBeCloseTo(OFFER_POST_PROBABILITY);
    expect(offerPostProbability(0)).toBeCloseTo(OFFER_POST_PROBABILITY);
    expect(offerPostProbability(NaN)).toBeCloseTo(OFFER_POST_PROBABILITY);
  });

  it('scales exponentially with effective offerer count', () => {
    // Each step is the raw product CLAMPED — the ceiling binds partway up the
    // ladder, so asserting the bare product pins numbers the function never
    // returns. What must hold is that the gradient exists below the clamp.
    const stepped = (n: number) =>
      Math.min(OFFER_PROBABILITY_CEILING, OFFER_POST_PROBABILITY * OFFER_VOLUME_BOOST_FACTOR ** (n - 1));
    expect(offerPostProbability(2)).toBeCloseTo(stepped(2));
    expect(offerPostProbability(3)).toBeCloseTo(stepped(3));
    expect(offerPostProbability(4)).toBeCloseTo(stepped(4));
    // The volume boost must not be flattened into a no-op by a ceiling that
    // did not move with the base — a bump that pins them together silently
    // removes the only signal the lane has for "this one actually matters".
    expect(offerPostProbability(2)).toBeGreaterThan(offerPostProbability(1));
  });

  it('caps the multiplier so a heavily-shopped player never auto-posts', () => {
    // The CEILING binds before the volume cap does (0.35 x 4 = 1.4 > 0.75), so
    // the effective ceiling is whichever is lower. Asserting the product alone
    // would pin a number the clamp never returns.
    const capped = Math.min(
      OFFER_POST_PROBABILITY * OFFER_VOLUME_BOOST_MAX,
      OFFER_PROBABILITY_CEILING,
    );
    expect(offerPostProbability(99)).toBeCloseTo(capped);
    // Even capped, the daily probability must remain a roll, not a guarantee.
    // A certainty would let an owner read the feed backwards and work out that
    // his own submission is what tipped Schefter.
    expect(offerPostProbability(99)).toBeLessThan(1);
    expect(offerPostProbability(99)).toBeLessThanOrEqual(OFFER_PROBABILITY_CEILING);
  });

  it('is monotonically non-decreasing in effective offerer count', () => {
    let last = 0;
    for (let n = 1; n <= 20; n += 1) {
      const p = offerPostProbability(n);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});

describe('offerPostProbability — no exposure acceleration', () => {
  // Phase 6c multiplied the base by OFFER_EXPOSURE_BOOST_FACTOR ^ priorExposure
  // so an already-reported offer raced through its reveal ladder. That ladder
  // is gone: a reported offer is now on OFFER_REPOST_COOLDOWN_MS, and speeding
  // up the offers the league has already heard about is precisely backwards.
  // These cases pin the removal so the boost cannot creep back through the
  // second argument.
  it('ignores any second argument — prior exposure cannot change the odds', () => {
    for (const priorExposure of [0, 1, 2, 3, 99, NaN, -5]) {
      expect((offerPostProbability as (n: number, e?: unknown) => number)(1, priorExposure))
        .toBeCloseTo(OFFER_POST_PROBABILITY);
    }
  });

  it('declares one defaulted parameter, so a re-added exposure arg is a signature change', () => {
    // Function.length counts params BEFORE the first default, and the sole
    // parameter is `effectiveOfferers = 1` — hence 0, not 1. Reading the
    // source is the check that actually means something.
    expect(offerPostProbability.length).toBe(0);
    const lib = readFileSync(
      path.join(process.cwd(), 'scripts/lib/redact-trade-offer.mjs'),
      'utf8',
    );
    expect(lib).toMatch(/export function offerPostProbability\(effectiveOfferers = 1\)/);
    // The constants must be gone. The doc comment still NAMES them, on purpose
    // — it explains why they were removed — so match the declaration, not the
    // mention.
    expect(lib).not.toMatch(/export const OFFER_EXPOSURE_BOOST/);
  });

  it('never exceeds the ceiling no matter how hot the offer', () => {
    for (let n = 1; n <= 40; n += 1) {
      expect(offerPostProbability(n)).toBeLessThanOrEqual(OFFER_PROBABILITY_CEILING + 1e-9);
    }
  });

  it('is a per-DAY probability the scanner rolls once per PT day', () => {
    // The constant only means what it reads like because of the
    // trade_offers:last_roll_date throttle. Without it the 15-minute cron
    // compounds this base ~50x a day and every offer leaks within hours,
    // which is the bug this replaced (owner report, 2026-09-08).
    const scanner = readFileSync(
      path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
      'utf8',
    );
    expect(scanner).toMatch(/trade_offers:last_roll_date/);
    expect(scanner).toMatch(/lastRollDate === todayPtForRoll/);
  });

  it('is a real roll on any given DAY, and near-certain across a week', () => {
    // The two halves are the whole design, and they used to be in tension:
    // one roll a day at 0.10 made a week-long offer a coin flip to EVER
    // surface, which is the right rarity for a message that buzzes sixteen
    // phones and the wrong rarity for a report page an owner opens on purpose.
    //
    // Since the trade lane went feed-first (2026-09-08) the chat rarity lives
    // in schefter-trade-distribution.mjs instead, and this constant is free to
    // do its actual job: get the story onto the report. A live proposal should
    // almost always show up there before it dies.
    const oneWeek = 1 - (1 - OFFER_POST_PROBABILITY) ** 7;
    expect(oneWeek).toBeGreaterThan(0.9);
    // A single day still has to be a coin toss at best, or an owner can read
    // the timing backwards to his own submission.
    expect(OFFER_POST_PROBABILITY).toBeLessThan(0.5);
  });
});

describe('escalation tier classifier', () => {
  it('returns base/tightened_circle/named at the documented thresholds', () => {
    expect(tierForDistinctOfferers(0)).toBe('base');
    expect(tierForDistinctOfferers(1)).toBe('base');
    expect(tierForDistinctOfferers(2)).toBe('base');
    expect(tierForDistinctOfferers(3)).toBe('tightened_circle');
    expect(tierForDistinctOfferers(4)).toBe('named');
    expect(tierForDistinctOfferers(99)).toBe('named');
  });
});

describe('rumor-scan: tier cap on draft-only contribution', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('imports the draft-trades helpers + tier classifier', () => {
    expect(src).toMatch(/from\s+['"]\.\/lib\/scan-draft-trades\.mjs['"]/);
    expect(src).toMatch(/tierForDistinctOfferers/);
  });

  it('blends draft offerers into the per-player count using the discount weight', () => {
    expect(src).toMatch(/realCount\s*\+\s*TB_DRAFT_OFFERER_WEIGHT\s*\*\s*draftCount/);
  });

  it('caps the effective count at tightened_circle when no real offerer reaches the named tier', () => {
    // The cap rewrites effectiveCount = 3 (the tightened_circle threshold)
    // when realTier !== 'named' but the blended count would otherwise unlock
    // 'named'. This is the load-bearing privacy guard for soft signals.
    expect(src).toMatch(/realTier\s*!==\s*['"]named['"]/);
    expect(src).toMatch(/tierForDistinctOfferers\(effectiveCount\)\s*===\s*['"]named['"]/);
    expect(src).toMatch(/effectiveCount\s*=\s*3\s*;/);
  });

  it('passes the most-shopped player count — and ONLY that — into the probability roll', () => {
    expect(src).toMatch(/maxEffectiveOfferers/);
    expect(src).toMatch(/offerPostProbability\(\s*maxEffectiveOfferers\s*\)/);
    // priorExposure still decides how much detail a re-surfacing offer reveals,
    // but it must never reach the odds again.
    expect(src).not.toMatch(/offerPostProbability\([^)]*priorExposure/);
  });

  it('runs the draft scan before iterating real offers (so player history reflects drafts on first pass)', () => {
    const scanIdx = src.indexOf('await scanDraftTrades(');
    const offerLoopIdx = src.indexOf('for (const [offerId, { raw, offeringFid }] of offerMap)');
    expect(scanIdx).toBeGreaterThan(-1);
    expect(offerLoopIdx).toBeGreaterThan(-1);
    expect(scanIdx).toBeLessThan(offerLoopIdx);
  });
});

describe('rumor-scan: drafts never create rumors on their own', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('only iterates `offerMap` (real pending trades) — drafts are never a primary key', () => {
    // The for-loop that emits tips is keyed by offerMap, not by any draft store.
    expect(src).toMatch(/for \(const \[offerId, \{ raw, offeringFid \}\] of offerMap\)/);
    // We must NEVER iterate draft keys in the tip-emission loop.
    expect(src).not.toMatch(/for\s*\([^)]*tb_drafts[^)]*\)\s*\{/);
  });
});

// ── In-memory fake Redis ──
// Minimal subset required by scanDraftTrades / getDraftOfferersForPlayer /
// getOwnerDraftCount. Sorted sets are stored as Maps keyed by member with
// numeric scores; range reads filter by score window.

class FakeRedis {
  store = new Map<string, unknown>();
  ttls = new Map<string, number>();

  async get(key: string) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async set(key: string, value: unknown) {
    this.store.set(key, value);
    return 'OK';
  }
  async zadd(key: string, { score, member }: { score: number; member: string }) {
    let zset = this.store.get(key) as Map<string, number> | undefined;
    if (!zset) {
      zset = new Map();
      this.store.set(key, zset);
    }
    zset.set(member, score);
    return 1;
  }
  async zrange(
    key: string,
    min: number,
    max: number,
    opts: { byScore?: boolean } = {},
  ) {
    const zset = this.store.get(key) as Map<string, number> | undefined;
    if (!zset) return [];
    if (!opts.byScore) {
      return Array.from(zset.keys());
    }
    return Array.from(zset.entries())
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1])
      .map(([member]) => member);
  }
  async zremrangebyscore(key: string, min: number, max: number) {
    const zset = this.store.get(key) as Map<string, number> | undefined;
    if (!zset) return 0;
    let removed = 0;
    for (const [member, score] of zset) {
      if (score >= min && score <= max) {
        zset.delete(member);
        removed += 1;
      }
    }
    return removed;
  }
  async expire(key: string, seconds: number) {
    this.ttls.set(key, seconds);
    return 1;
  }
  async zcard(key: string) {
    const zset = this.store.get(key) as Map<string, number> | undefined;
    return zset ? zset.size : 0;
  }
}

describe('scanDraftTrades — Redis projection of dt:{fid} into shopping signals', () => {
  it('projects each owner-side draft player into the per-player sorted set', async () => {
    const redis = new FakeRedis();
    const now = Date.now();
    redis.store.set('dt:0001', [
      {
        id: 'd1',
        name: 'shop CMC',
        createdAt: now,
        updatedAt: now,
        teamA: { franchiseId: '0001', playerIds: ['12345', '67890'], draftPicks: [], rookieExtensions: {} },
        teamB: { franchiseId: '0002', playerIds: ['99999'], draftPicks: [], rookieExtensions: {} },
      },
    ]);
    const teams = new Map([
      ['0001', { division: 'East' }],
      ['0002', { division: 'West' }],
    ]);

    const summary = await scanDraftTrades({ redis: redis as any, teams, dryRun: false });

    expect(summary.ownersScanned).toBe(1);
    expect(summary.draftsScanned).toBe(1);
    expect(summary.playerEntries).toBe(2);

    const cmcOfferers = await getDraftOfferersForPlayer({ redis: redis as any, playerId: '12345' });
    expect(cmcOfferers.has('0001')).toBe(true);

    // The asset on teamB's side ("99999") is what the owner is *requesting*,
    // not offering — it must NOT show up in the trade-block player set.
    const requestedFids = await getDraftOfferersForPlayer({ redis: redis as any, playerId: '99999' });
    expect(requestedFids.size).toBe(0);
  });

  it('skips drafts older than the 3-day window', async () => {
    const redis = new FakeRedis();
    const now = Date.now();
    const stale = now - TB_DRAFT_WINDOW_MS - 60_000;
    redis.store.set('dt:0001', [
      {
        id: 'd1',
        name: 'old',
        createdAt: stale,
        updatedAt: stale,
        teamA: { franchiseId: '0001', playerIds: ['12345'], draftPicks: [], rookieExtensions: {} },
        teamB: { franchiseId: '0002', playerIds: [], draftPicks: [], rookieExtensions: {} },
      },
    ]);
    const teams = new Map([['0001', { division: 'East' }]]);

    const summary = await scanDraftTrades({ redis: redis as any, teams, dryRun: false });
    expect(summary.draftsScanned).toBe(0);
    const fids = await getDraftOfferersForPlayer({ redis: redis as any, playerId: '12345' });
    expect(fids.size).toBe(0);
  });

  it('handles the owner being on teamB instead of teamA', async () => {
    const redis = new FakeRedis();
    const now = Date.now();
    redis.store.set('dt:0003', [
      {
        id: 'd2',
        name: 'reverse-builder',
        createdAt: now,
        updatedAt: now,
        teamA: { franchiseId: '0007', playerIds: ['XXXX'], draftPicks: [], rookieExtensions: {} },
        teamB: { franchiseId: '0003', playerIds: ['55555'], draftPicks: [], rookieExtensions: {} },
      },
    ]);
    const teams = new Map([
      ['0003', { division: 'East' }],
      ['0007', { division: 'West' }],
    ]);

    await scanDraftTrades({ redis: redis as any, teams, dryRun: false });
    // Owner 0003 is on teamB, so 55555 is what they're shopping.
    const ownerSideFids = await getDraftOfferersForPlayer({ redis: redis as any, playerId: '55555' });
    expect(ownerSideFids.has('0003')).toBe(true);
    // teamA's player (XXXX) is requested, not shopped — must not be tagged.
    const otherSideFids = await getDraftOfferersForPlayer({ redis: redis as any, playerId: 'XXXX' });
    expect(otherSideFids.size).toBe(0);
  });

  it('records owner draft volume via getOwnerDraftCount', async () => {
    const redis = new FakeRedis();
    const now = Date.now();
    redis.store.set('dt:0001', [
      {
        id: 'd1',
        name: 'a',
        createdAt: now,
        updatedAt: now,
        teamA: { franchiseId: '0001', playerIds: ['p1'], draftPicks: [], rookieExtensions: {} },
        teamB: { franchiseId: '0002', playerIds: [], draftPicks: [], rookieExtensions: {} },
      },
      {
        id: 'd2',
        name: 'b',
        createdAt: now,
        updatedAt: now,
        teamA: { franchiseId: '0001', playerIds: ['p2'], draftPicks: [], rookieExtensions: {} },
        teamB: { franchiseId: '0003', playerIds: [], draftPicks: [], rookieExtensions: {} },
      },
    ]);
    const teams = new Map([
      ['0001', { division: 'East' }],
      ['0002', { division: 'East' }],
      ['0003', { division: 'West' }],
    ]);

    await scanDraftTrades({ redis: redis as any, teams, dryRun: false });
    const count = await getOwnerDraftCount({ redis: redis as any, franchiseId: '0001' });
    expect(count).toBe(2);
  });

  it('does not write when dryRun=true', async () => {
    const redis = new FakeRedis();
    const now = Date.now();
    redis.store.set('dt:0001', [
      {
        id: 'd1',
        name: 'a',
        createdAt: now,
        updatedAt: now,
        teamA: { franchiseId: '0001', playerIds: ['p1'], draftPicks: [], rookieExtensions: {} },
        teamB: { franchiseId: '0002', playerIds: [], draftPicks: [], rookieExtensions: {} },
      },
    ]);
    const teams = new Map([['0001', { division: 'East' }]]);

    await scanDraftTrades({ redis: redis as any, teams, dryRun: true });
    const fids = await getDraftOfferersForPlayer({ redis: redis as any, playerId: 'p1' });
    expect(fids.size).toBe(0);
  });
});
