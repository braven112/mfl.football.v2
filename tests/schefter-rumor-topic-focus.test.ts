/**
 * Source-level guards for the single-topic rumor-scan pipeline.
 *
 * The rumor scanner used to synthesize whatever was in the tip queue into a
 * single 2–4 sentence post, often blending three unrelated topics. We now
 * pick ONE topic bucket per cycle (trade rumors first, then multi-tip gossip
 * clusters), rate-limit gossip to 1 post/day, preserve unused tips for the
 * next cycle, and link the tip page from every post.
 *
 * These tests pin those invariants at the source level so a regression
 * (e.g. someone re-enables multi-topic synthesis or drops the gossip cap)
 * surfaces in CI rather than in the feed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('rumor-scan daily caps — trade-heavy, gossip-rationed', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('caps daily posts at 3 (gossip hard-limited to 1/day, so the other 2 slots go to trade rumors)', () => {
    expect(src).toMatch(/const\s+MAX_POSTS_PER_DAY\s*=\s*3\b/);
  });

  it('rations gossip posts to at most 1 per day', () => {
    expect(src).toMatch(/const\s+MAX_GOSSIP_POSTS_PER_DAY\s*=\s*1\b/);
  });

  it('tracks the gossip counter in its own Redis key', () => {
    expect(src).toMatch(/const\s+RUMOR_GOSSIP_POSTS_TODAY_KEY\s*=\s*['"]schefter:rumor:gossip_posts_today['"]/);
  });

  it('increments the gossip counter only when postKind === "gossip"', () => {
    expect(src).toMatch(/if\s*\(\s*postKind\s*===\s*['"]gossip['"]\s*\)\s*\{[\s\S]*?redis\.incr\(RUMOR_GOSSIP_POSTS_TODAY_KEY\)/);
  });

  it('sets a TTL on the gossip counter so it resets at PT midnight', () => {
    expect(src).toMatch(/redis\.expire\(RUMOR_GOSSIP_POSTS_TODAY_KEY,\s*secondsUntilPtMidnight/);
  });
});

describe('rumor-scan bucketing — one topic per post', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('defines a buildTopicBuckets helper that groups tips by topic/thread', () => {
    expect(src).toMatch(/function\s+buildTopicBuckets\(/);
  });

  it('defines a pickPrimaryBucket helper that honors the gossip budget', () => {
    expect(src).toMatch(/function\s+pickPrimaryBucket\(\s*buckets\s*,\s*\{\s*gossipAllowedToday\s*\}/);
  });

  it('prefers trade-offer tips over topic="trade" web tips on a tie (structured beats speculative)', () => {
    // Inside pickPrimaryBucket the tie-breaker has to favor "trade:offer"
    // so structured MFL-derived offers outrank owner speculation. This
    // pins the comparator so a future refactor doesn't accidentally
    // reverse it.
    const pickFn = src.match(/function\s+pickPrimaryBucket[\s\S]+?\n\}\n/);
    expect(pickFn).not.toBeNull();
    const body = pickFn![0];
    expect(body).toMatch(/a\.key\s*===\s*['"]trade:offer['"]/);
    expect(body).toMatch(/return\s*-1/);
  });

  it('only considers gossip buckets when the gossip daily budget is still open', () => {
    const pickFn = src.match(/function\s+pickPrimaryBucket[\s\S]+?\n\}\n/);
    expect(pickFn).not.toBeNull();
    expect(pickFn![0]).toMatch(/if\s*\(\s*!gossipAllowedToday\s*\)\s*return\s+null/);
  });

  it('batches tips FROM THE CHOSEN BUCKET ONLY (not the full freshTips list)', () => {
    // The old code did `const batch = freshTips.slice(0, MAX_TIPS_PER_BATCH)`
    // which blended every unrelated topic into one post. We now take the
    // bucket's tips.
    expect(src).not.toMatch(/const\s+batch\s*=\s*freshTips\.slice/);
    expect(src).toMatch(/const\s+batch\s*=\s*primaryBucket\.tips\.slice/);
  });

  it('holds unused tips in Redis for the next cycle instead of DELing them', () => {
    // The old drain was `redis.del(TIPS_QUEUE_KEY)` followed by DEL on
    // first_tip_ts. We now RPUSH any leftover tips back so slow-news days
    // can surface them later.
    expect(src).toMatch(/const\s+unusedTips\s*=\s*freshTips\.filter/);
    expect(src).toMatch(/redis\.rpush\(TIPS_QUEUE_KEY,\s*\.\.\.serialized\)/);
  });

  it('preserves the oldest leftover tip as the new first_tip_ts anchor', () => {
    // Without this, the marinate gate would stay cleared after a partial
    // drain and the next cycle would re-fire immediately.
    expect(src).toMatch(/redis\.set\(FIRST_TIP_TS_KEY,\s*oldest\)/);
  });
});

describe('rumor-scan LLM prompt — one topic only', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('tells the LLM to stay on ONE TOPIC and refuses "meanwhile…" pivots', () => {
    expect(src).toMatch(/ONE TOPIC ONLY/);
    expect(src).toMatch(/No "meanwhile/);
  });

  it('caps post length at 1–2 sentences (down from 2–4)', () => {
    // The HARD RULE 8 line is the authoritative cap; the trade-offer
    // playbook must defer to it as well.
    expect(src).toMatch(/Length:\s*1[–-]2 sentences/);
    expect(src).toMatch(/1[–-]2 sentences TOTAL/);
  });

  it('does not retain the old "mixed batches" multi-topic rule', () => {
    // The old rule 7 explicitly encouraged blending GroupMe + web tips
    // across topics — incompatible with single-topic focus.
    expect(src).not.toMatch(/It's okay for a single post to blend/);
  });
});

describe('rumor-scan tip-page link — every post sends readers back to /tip', () => {
  const src = read('scripts/schefter-rumor-scan.mjs');

  it('defines the tip page path constant (canonical /schefter/tip on theleague.us)', () => {
    expect(src).toMatch(/const\s+TIP_PAGE_PATH\s*=\s*['"]\/schefter\/tip['"]/);
  });

  it('defines a user-facing CTA label', () => {
    expect(src).toMatch(/const\s+TIP_PAGE_LINK_LABEL\s*=\s*['"]Got a tip\? Whisper to Schefter →['"]/);
  });

  it('derives an absolute tip-page URL from SCHEFTER_PUBLIC_BASE_URL (defaults to theleague.us)', () => {
    expect(src).toMatch(/process\.env\.SCHEFTER_PUBLIC_BASE_URL/);
    expect(src).toMatch(/https:\/\/theleague\.us/);
    expect(src).toMatch(/const\s+TIP_PAGE_ABSOLUTE_URL\s*=/);
  });

  it('attaches link + linkLabel to every feed post it generates', () => {
    expect(src).toMatch(/link:\s*TIP_PAGE_PATH/);
    expect(src).toMatch(/linkLabel:\s*TIP_PAGE_LINK_LABEL/);
  });

  it('appends the absolute tip-page URL to GroupMe posts', () => {
    expect(src).toMatch(/const\s+groupMeText\s*=\s*`\$\{post\.body\}\\n\\nGot a tip\? \$\{TIP_PAGE_ABSOLUTE_URL\}`/);
    // The GroupMe call must use groupMeText (not post.body) so the URL ships.
    expect(src).toMatch(/await\s+postToGroupMe\(groupMeText\)/);
    expect(src).not.toMatch(/await\s+postToGroupMe\(post\.body\)/);
  });
});
