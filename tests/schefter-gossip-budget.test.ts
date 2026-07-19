/**
 * Budget-on-delivery + quiet-feed gate leniency — regression guards.
 *
 * July 2026 post-mortem (AFL launch day): the first post-quiet-hours cycle
 * generated a beat, the quality gate suppressed it, and the scanner STILL
 * incremented posts_today and the 1/day gossip cap. Every later cycle then
 * held the queued tips with "gossip budget spent" and the rumor mill went
 * silent for the whole day. Brandon's directive: only count what POSTED as
 * a post, not what could have posted.
 *
 * Source-contract assertions (same style as schefter-quiet-day.test.ts) —
 * the scanner is a monolith, so these grep the source for the load-bearing
 * shapes rather than executing the Redis flow.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — .mjs imported via allowJs
import { QUALITY_THRESHOLD, RELAXED_QUALITY_THRESHOLD } from '../scripts/lib/schefter-quality-gate.mjs';

const SRC = readFileSync(
  path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
  'utf8',
);

describe('daily budgets count delivered posts only', () => {
  it('keeps the budget-on-delivery sentinel (do not remove without replacing coverage)', () => {
    expect(SRC).toMatch(/BUDGET-ON-DELIVERY SENTINEL/);
  });

  it('increments posts_today and the gossip counter only inside the delivered guard', () => {
    // Both incrs must live inside the `if (allowedPosts.length > 0)` block
    // that follows the sentinel comment. If someone hoists either incr back
    // out, the block match breaks.
    const guarded = SRC.match(
      /BUDGET-ON-DELIVERY SENTINEL[\s\S]*?if \(allowedPosts\.length > 0\) \{([\s\S]*?)\n    \} else \{/,
    );
    expect(guarded).not.toBeNull();
    expect(guarded![1]).toContain('redis.incr(RUMOR_POSTS_TODAY_KEY)');
    expect(guarded![1]).toContain('redis.incr(RUMOR_GOSSIP_POSTS_TODAY_KEY)');
    expect(guarded![1]).toContain('redis.set(RUMOR_LAST_POST_TS_KEY');
    // And no OTHER incr of either budget exists beyond the two legitimate
    // sites: this guarded block and the quiet-day lane (which increments
    // only after its feed entry is written — the post genuinely shipped).
    expect(SRC.match(/redis\.incr\(RUMOR_POSTS_TODAY_KEY\)/g)).toHaveLength(2);
    expect(SRC.match(/redis\.incr\(RUMOR_GOSSIP_POSTS_TODAY_KEY\)/g)).toHaveLength(1);
  });

  it('dropped the old attempt-counting design ("regardless of suppression")', () => {
    expect(SRC).not.toMatch(/regardless of suppression/);
  });

  it('reports delivered posts, not generated beats, from the normal lane', () => {
    // main() must end by returning the shipped count — the old `return 1`
    // made a fully-suppressed cycle log "Posts written: 1".
    expect(SRC).toMatch(/return allowedPosts\.length;\n\}/);
  });

  it('delivery-gates the morning-greeting and roger-riff daily stamps', () => {
    expect(SRC).toMatch(/hadRogerRiff && beatZeroShipped/);
    expect(SRC).toMatch(/morningGreeting && beatZeroShipped/);
  });
});

describe('quiet-feed gate leniency', () => {
  it('relaxed threshold is 3 (a 3/10 ships when the feed is quiet) and below the standard bar', () => {
    expect(RELAXED_QUALITY_THRESHOLD).toBe(3);
    expect(RELAXED_QUALITY_THRESHOLD).toBeLessThan(QUALITY_THRESHOLD);
  });

  it('scanner wires the relaxed threshold into the gate call', () => {
    // League-drought and fresh-subject checks feed a per-beat threshold
    // override into checkGroupMeQuality.
    expect(SRC).toMatch(/RUMOR_QUIET_FEED_DAYS = 7/);
    expect(SRC).toMatch(/relaxedThresholdFor/);
    expect(SRC).toMatch(/threshold: RELAXED_QUALITY_THRESHOLD/);
    expect(SRC).toMatch(/weeksSeen\.includes\(currentIsoWeek\)/);
    expect(SRC).toMatch(/\.\.\.\(relaxed \? \{ threshold: relaxed\.threshold \} : \{\}\)/);
  });
});
