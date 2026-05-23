import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isQuietHours,
  isSpacingHeld,
  secondsUntilPtMidnight,
  evaluatePingWindow,
  consumeDailyPost,
  MAX_POSTS_PER_DAY,
  MIN_SPACING_MS,
  QUIET_HOUR_START,
  QUIET_HOUR_END,
  RUMOR_POSTS_TODAY_KEY,
  RUMOR_LAST_POST_TS_KEY,
  // @ts-expect-error — plain .mjs module, no type declarations
} from '../scripts/lib/schefter-groupme-budget.mjs';

// A PT instant helper: build a Date that reads as the given hour in LA.
// 2026-06-15 is PDT (UTC-7), so PT hour = UTC hour - 7 (mod 24).
function ptDate(hourPT: number, min = 0): Date {
  const utcHour = (hourPT + 7) % 24;
  return new Date(Date.UTC(2026, 5, 15, utcHour, min, 0));
}

describe('isQuietHours (23:00–06:59 PT)', () => {
  it('is quiet overnight and active during the day', () => {
    expect(isQuietHours(ptDate(23))).toBe(true);
    expect(isQuietHours(ptDate(2))).toBe(true);
    expect(isQuietHours(ptDate(6, 59))).toBe(true);
    expect(isQuietHours(ptDate(7))).toBe(false);
    expect(isQuietHours(ptDate(12))).toBe(false);
    expect(isQuietHours(ptDate(22, 59))).toBe(false);
  });
});

describe('isSpacingHeld', () => {
  const now = new Date('2026-06-15T20:00:00Z');
  it('does not hold when no post has gone out today', () => {
    expect(isSpacingHeld(now, now.getTime() - 1000, 0)).toBe(false);
  });
  it('holds within the spacing window once a post exists', () => {
    expect(isSpacingHeld(now, now.getTime() - (MIN_SPACING_MS - 1000), 1)).toBe(true);
  });
  it('clears after the spacing window', () => {
    expect(isSpacingHeld(now, now.getTime() - (MIN_SPACING_MS + 1000), 1)).toBe(false);
  });
});

describe('secondsUntilPtMidnight', () => {
  it('returns a value within a day', () => {
    const s = secondsUntilPtMidnight(ptDate(12));
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(24 * 3600);
  });
});

// Minimal in-memory fake of the Upstash client surface we use.
function fakeRedis(initial: Record<string, number> = {}) {
  const store = new Map<string, number>(Object.entries(initial));
  return {
    store,
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async incr(k: string) { const v = (store.get(k) ?? 0) + 1; store.set(k, v); return v; },
    async set(k: string, v: number) { store.set(k, v); },
    async expire() { /* no-op */ },
  };
}

describe('evaluatePingWindow', () => {
  it('ok during the day with no prior posts', async () => {
    const w = await evaluatePingWindow(fakeRedis(), ptDate(12));
    expect(w.ok).toBe(true);
    expect(w.quietHours).toBe(false);
    expect(w.atCap).toBe(false);
  });

  it('holds during quiet hours', async () => {
    const w = await evaluatePingWindow(fakeRedis(), ptDate(2));
    expect(w.ok).toBe(false);
    expect(w.quietHours).toBe(true);
  });

  it('reports atCap once the daily budget is spent (but does not force-block)', async () => {
    const redis = fakeRedis({ [RUMOR_POSTS_TODAY_KEY]: MAX_POSTS_PER_DAY });
    const w = await evaluatePingWindow(redis, ptDate(12));
    expect(w.atCap).toBe(true);
    expect(w.ok).toBe(true); // cap is advisory for big drops; quiet/spacing gate instead
  });
});

describe('consumeDailyPost', () => {
  it('increments the shared counter and stamps last-post time', async () => {
    const redis = fakeRedis();
    const now = ptDate(12);
    await consumeDailyPost(redis, now);
    expect(redis.store.get(RUMOR_POSTS_TODAY_KEY)).toBe(1);
    expect(redis.store.get(RUMOR_LAST_POST_TS_KEY)).toBe(now.getTime());
  });
});

// Guard: the rumor scanner owns the canonical budget. If its constants/keys
// drift from this lib, the shared-budget contract breaks silently — so pin them.
describe('rumor-scan budget constants stay in sync', () => {
  const src = readFileSync(path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'), 'utf8');
  it('matches MAX_POSTS_PER_DAY, spacing, quiet hours, and key names', () => {
    expect(src).toContain(`const MAX_POSTS_PER_DAY = ${MAX_POSTS_PER_DAY}`);
    expect(src).toContain('const MIN_SPACING_MS = 4 * 60 * 60 * 1000');
    expect(MIN_SPACING_MS).toBe(4 * 60 * 60 * 1000);
    expect(src).toContain(`const QUIET_HOUR_START = ${QUIET_HOUR_START}`);
    expect(src).toContain(`const QUIET_HOUR_END = ${QUIET_HOUR_END}`);
    expect(src).toContain(`'${RUMOR_POSTS_TODAY_KEY}'`);
    expect(src).toContain(`'${RUMOR_LAST_POST_TS_KEY}'`);
  });
});
