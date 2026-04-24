/**
 * Source-level guards for the Phase 7 whisper-back flow.
 *
 * The live HTTP handlers are difficult to exercise in unit tests because they
 * depend on cookie-backed auth. These checks pin the critical invariants at
 * the code level so accidental regressions (dropping the rate-limit counter,
 * silently accepting missing parent posts, leaking raw hashes through the
 * thread API) are caught before they ship.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('Phase 7 — whisper-back validation at POST /api/schefter/tip', () => {
  const tip = read('src/pages/api/schefter/tip.ts');

  it('accepts repliesToPostId in the request body', () => {
    expect(tip).toMatch(/repliesToPostId/);
  });

  it('imports WHISPER_BACK_MAX_AGE_MS (14 days) for the age check', () => {
    expect(tip).toMatch(/WHISPER_BACK_MAX_AGE_MS/);
  });

  it('rejects replies to non-existent posts', () => {
    expect(tip).toMatch(/reply_not_found/);
  });

  it('rejects replies to non-rumor posts', () => {
    expect(tip).toMatch(/reply_not_rumor/);
  });

  it('rejects replies to posts older than the cutoff', () => {
    expect(tip).toMatch(/reply_too_old/);
    expect(tip).toMatch(/WHISPER_BACK_MAX_AGE_MS/);
  });

  it('runs the rate-limit INCR BEFORE deciding to enqueue the tip', () => {
    // Guarantees whisper-backs count toward the per-owner cap: the INCR runs
    // before the queue push.
    const incrIdx = tip.indexOf('redis.incr(rateKey)');
    const queueIdx = tip.indexOf('redis.lpush(TIPS_QUEUE_KEY');
    expect(incrIdx).toBeGreaterThan(-1);
    expect(queueIdx).toBeGreaterThan(-1);
    expect(incrIdx).toBeLessThan(queueIdx);
  });
});

describe('Phase 7 — thread API shape', () => {
  const thread = read('src/pages/api/schefter/thread.ts');

  it('exports prerender=false so it sees fresh feed state on every request', () => {
    expect(thread).toMatch(/export\s+const\s+prerender\s*=\s*false/);
  });

  it('filters to rumor_mill posts only (never surfaces articles in a thread)', () => {
    expect(thread).toMatch(/transactionSubType\s*===\s*['"]rumor_mill['"]/);
  });

  it('sorts thread posts chronologically', () => {
    expect(thread).toMatch(/new Date\([^)]*\.timestamp\)/);
  });

  it('never echoes hashedOwnerId, tipIds, or raw tipster data in the response', () => {
    // pickPublicFields is the only shape that reaches the client. Confirm it
    // does NOT include tip identity fields.
    expect(thread).toMatch(/function pickPublicFields/);
    const pick = thread.match(/function pickPublicFields[\s\S]+?\n\}/m)?.[0] ?? '';
    expect(pick).not.toMatch(/hashedOwnerId/);
    expect(pick).not.toMatch(/tipIds/);
    expect(pick).not.toMatch(/franchiseIds/);
  });
});

describe('Phase 7 — scanner thread persistence', () => {
  const scanner = read('scripts/schefter-rumor-scan.mjs');

  it('threads are keyed in Redis under schefter:thread:{threadId}', () => {
    expect(scanner).toMatch(/schefter:thread:\$\{threadId\}/);
  });

  it('thread registry writes a 14-day TTL', () => {
    // 14 * 24 * 60 * 60
    expect(scanner).toMatch(/14\s*\*\s*24\s*\*\s*60\s*\*\s*60/);
  });

  it('records thread_of mapping for both parent and new post', () => {
    expect(scanner).toMatch(/thread_of:\$\{dominantParentId\}/);
    // Loop variable is `p` now (we iterate over builtPosts per beat), but
    // the key shape is the same: `thread_of:${postId}`.
    expect(scanner).toMatch(/thread_of:\$\{(?:post|p)\.id\}/);
  });

  it('tells the LLM to open with continuity language when a threadFollowup is present', () => {
    expect(scanner).toMatch(/threadFollowup/);
    expect(scanner).toMatch(/Thread continuity/);
  });
});
