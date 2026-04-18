/**
 * Source-level guards for the Phase 8–10 endpoints.
 *
 * The handlers themselves are auth-light public endpoints whose behavior is
 * dominated by Redis interactions; full HTTP-level tests would require a
 * live Upstash connection. These checks pin the critical invariants:
 * response shapes, TTLs, and surface-area restrictions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('Phase 8 — cooker-status endpoint', () => {
  const src = read('src/pages/api/schefter/cooker-status.ts');

  it('is a dynamic handler (prerender=false)', () => {
    expect(src).toMatch(/export\s+const\s+prerender\s*=\s*false/);
  });

  it('exposes queueDepth, marinateStartedAt, nextEarliestPostAt, postsToday, dailyCap', () => {
    expect(src).toMatch(/queueDepth/);
    expect(src).toMatch(/marinateStartedAt/);
    expect(src).toMatch(/nextEarliestPostAt/);
    expect(src).toMatch(/postsToday/);
    expect(src).toMatch(/dailyCap/);
  });

  it('uses the 1-hour marinate window from the plan', () => {
    expect(src).toMatch(/MARINATE_WINDOW_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('caps the rumor daily posts at 3', () => {
    expect(src).toMatch(/DAILY_CAP\s*=\s*3/);
  });

  it('never reads tip contents from the queue', () => {
    // Should only use llen (length) — never lrange / lpop / rpop / lindex.
    expect(src).not.toMatch(/\bredis\.lrange/);
    expect(src).not.toMatch(/\bredis\.lpop/);
    expect(src).not.toMatch(/\bredis\.rpop/);
    expect(src).not.toMatch(/\bredis\.lindex/);
  });
});

describe('Phase 9 — hot-topics endpoint', () => {
  const src = read('src/pages/api/schefter/hot-topics.ts');
  const tip = read('src/pages/api/schefter/tip.ts');

  it('uses a 7-day rolling window', () => {
    expect(src).toMatch(/WINDOW_DAYS\s*=\s*7/);
  });

  it('counts per-topic ZSET membership (exact, not decayed HASH)', () => {
    expect(src).toMatch(/zcount/);
    expect(src).toMatch(/schefter:topic_timeline:/);
  });

  it('sorts descending', () => {
    expect(src).toMatch(/\.sort\(\(a,\s*b\)\s*=>\s*b\.count\s*-\s*a\.count\)/);
  });

  it('tip submit endpoint writes to the per-topic timeline', () => {
    expect(tip).toMatch(/schefter:topic_timeline:\$\{tip\.topic\}/);
    expect(tip).toMatch(/redis\.zadd\(timelineKey/);
  });

  it('tip submit prunes entries older than 30 days to keep sets bounded', () => {
    expect(tip).toMatch(/zremrangebyscore\(timelineKey,\s*0,\s*tip\.submittedAt\s*-\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\)/);
  });
});

describe('Phase 10 — impression tracker endpoint', () => {
  const src = read('src/pages/api/schefter/rumor-impression.ts');

  it('is a POST handler with prerender=false', () => {
    expect(src).toMatch(/export\s+const\s+prerender\s*=\s*false/);
    expect(src).toMatch(/export\s+const\s+POST/);
  });

  it('validates postId shape (sf_rumor_...) before writing Redis', () => {
    expect(src).toMatch(/sf_rumor_/);
    expect(src).toMatch(/test\(postId\)/);
  });

  it('only records impressions for known rumor posts (feed registry)', () => {
    expect(src).toMatch(/isRumorPostId/);
  });

  it('writes with a 30-day TTL', () => {
    expect(src).toMatch(/IMPRESSION_TTL_SEC\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
  });
});

describe('Phase 10 — tip-of-the-week award script', () => {
  const src = read('scripts/schefter-award-tip-of-the-week.mjs');

  it('looks at a 7-day window of rumor posts', () => {
    expect(src).toMatch(/WINDOW_MS\s*=\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it('keys badges under schefter:tipster:badges:{hash}', () => {
    expect(src).toMatch(/schefter:tipster:badges:/);
  });

  it('produces ISO-week-style badge keys (YYYY-WNN)', () => {
    expect(src).toMatch(/isoWeekKey/);
    expect(src).toMatch(/totw-/);
  });

  it('supports --dry-run to audit without writing', () => {
    expect(src).toMatch(/DRY_RUN\s*=\s*process\.argv\.includes\('--dry-run'\)/);
  });

  it('is best-effort — never crashes when a tipster hash lookup fails', () => {
    expect(src).toMatch(/\[totw\] badge award failed/);
  });
});
