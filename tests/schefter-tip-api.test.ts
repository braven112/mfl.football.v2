/**
 * Tests for the Schefter tip API surface.
 *
 * Covers the P0 regression guard (admin rate-limit exemption removed) and the
 * tips-remaining response shape.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// P0 regression guard — this is a source-level check. If anyone ever re-adds
// the admin exemption, any surface that reports a per-user counter becomes a
// de-anonymization oracle (see engagement plan P0). We pin the assertion at
// the source level to make the reasoning visible in test output.
describe('P0 admin rate-limit exemption', () => {
  const tipSource = readFileSync(
    path.join(process.cwd(), 'src/pages/api/schefter/tip.ts'),
    'utf8',
  );

  it('does not import isCommissionerOrAdmin from auth', () => {
    expect(tipSource).not.toMatch(/isCommissionerOrAdmin/);
  });

  it('applies the rate-limit counter unconditionally (no admin branch)', () => {
    // The 3/24h rate limit must run for every authenticated caller; there is
    // no "if (!isAdmin)" guard and no early return that skips the INCR path.
    expect(tipSource).toMatch(/redis\.incr\(rateKey\)/);
    expect(tipSource).not.toMatch(/const\s+isAdmin\s*=/);
    expect(tipSource).not.toMatch(/if\s*\(!isAdmin\)/);
  });

  it('still returns 429 when the counter exceeds RATE_LIMIT_MAX', () => {
    expect(tipSource).toMatch(/count\s*>\s*RATE_LIMIT_MAX/);
    expect(tipSource).toMatch(/['"]rate_limited['"]/);
  });
});

// ── tips-remaining endpoint shape ──

describe('tips-remaining endpoint', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'src/pages/api/schefter/tips-remaining.ts'),
    'utf8',
  );

  it('exports prerender=false so the dynamic handler runs on every request', () => {
    expect(src).toMatch(/export\s+const\s+prerender\s*=\s*false/);
  });

  it('requires authentication', () => {
    expect(src).toMatch(/getAuthUser/);
    expect(src).toMatch(/unauthorized/);
  });

  it('hashes the user id before touching Redis (never exposes raw id)', () => {
    expect(src).toMatch(/hashTipsterId\(user\.id\)/);
  });

  it('returns max=3 and never surfaces values above the cap', () => {
    expect(src).toMatch(/RATE_LIMIT_MAX\s*=\s*3/);
    expect(src).toMatch(/Math\.min\(used,\s*RATE_LIMIT_MAX\)/);
  });

  it('degrades gracefully when Redis is unavailable', () => {
    // If we cannot read the counter we must still render a usable UI — return
    // the optimistic max so the submit button stays enabled. The POST endpoint
    // still enforces the cap atomically when Redis recovers.
    expect(src).toMatch(/remaining:\s*RATE_LIMIT_MAX/);
  });
});

// ── Anonymous Style Book integration (source-level contract) ──

describe('anon Style Book — tip.ts integration', () => {
  const tipSource = readFileSync(
    path.join(process.cwd(), 'src/pages/api/schefter/tip.ts'),
    'utf8',
  );

  it('imports the shared TS detectAttackOnSchefter utility', () => {
    expect(tipSource).toMatch(/from '\.\.\/\.\.\/\.\.\/utils\/schefter-attack-detection'/);
    expect(tipSource).toMatch(/detectAttackOnSchefter\(trimmedText\)/);
  });

  it('uses separate Redis key prefixes for anon (not the named namespace)', () => {
    // The anon Style Book MUST live on its own keyspace so named and anon
    // leaderboards never mix. If these asserts fail, tips are leaking into
    // the named pool.
    expect(tipSource).toMatch(/schefter:style_book:anon:/);
    expect(tipSource).toMatch(/schefter:style_book:anon_leaderboard:/);
  });

  it('stamps attackOnSchefter + styleBookCount + tipsterCodename on the tip', () => {
    expect(tipSource).toMatch(/attackOnSchefter:\s*true/);
    expect(tipSource).toMatch(/styleBookCount/);
    expect(tipSource).toMatch(/tipsterCodename/);
  });

  it('assigns/retrieves a codename so the leaderboard has something to render', () => {
    expect(tipSource).toMatch(/assignCodename\(redis,\s*hashedOwnerId\)/);
  });

  it('increments the anon leaderboard ZSET using the HASH (never the tip text)', () => {
    // Leaderboard member is the hashedOwnerId so the API layer can resolve to
    // codename. The raw hash must never surface in responses (guarded in the
    // API test suite).
    expect(tipSource).toMatch(/zincrby\(leaderboardKey,\s*1,\s*hashedOwnerId\)/);
  });

  it('wraps the style-book bump in try/catch so a Redis failure never blocks enqueue', () => {
    // The ordering matters: detection + bump run BEFORE the tip is built +
    // pushed. Any failure in the bump path must be logged + swallowed so the
    // tip still reaches the queue.
    expect(tipSource).toMatch(/\[schefter\/tip\] anon style-book bump failed/);
  });

  // ── A=C barometer plumbing (rolling-window off-topic timeline) ──

  it('uses a rolling-window timeline ZSET (not a lifetime counter)', () => {
    // The barometer must be rolling — good behavior should let owners
    // improve their dial by simply not sending mean tips for a while. A
    // cumulative INCR counter would punish old behavior forever, which
    // contradicts the design intent.
    expect(tipSource).toMatch(/schefter:off_topic:timeline:/);
    expect(tipSource).toMatch(/OFF_TOPIC_WINDOW_MS/);
  });

  it('defines a 30-day rolling window', () => {
    expect(tipSource).toMatch(/30 \* 24 \* 60 \* 60 \* 1000/);
  });

  it('increments timeline only when topic is "commish"', () => {
    // The Beef topic is the off-topic channel by design. We don't bump on
    // trade/draft/extension/roster/other — those are either league-business
    // or genuinely general.
    expect(tipSource).toMatch(/if \(topic === 'commish'\)/);
  });

  it('prunes entries older than the window on every write', () => {
    // ZREMRANGEBYSCORE ... nowMs - OFF_TOPIC_WINDOW_MS is what lets old
    // tips age out so the barometer reading reflects recent activity only.
    expect(tipSource).toMatch(/zremrangebyscore/);
    expect(tipSource).toMatch(/OFF_TOPIC_WINDOW_MS/);
  });

  it('reads the rolling count via ZCARD', () => {
    expect(tipSource).toMatch(/redis\.zcard\(timelineKey\)/);
  });

  it('stamps offTopicCount on the tip when set', () => {
    expect(tipSource).toMatch(/offTopicCount/);
  });

  it('wraps the timeline bump in try/catch (best-effort)', () => {
    expect(tipSource).toMatch(/\[schefter\/tip\] off-topic timeline bump failed/);
  });
});
