import { describe, it, expect } from 'vitest';
import {
  checkGlobalBudgetGate,
  MAX_GLOBAL_POSTS_PER_DAY,
  RESERVED_PEAK_SLOT,
  MIN_SPACING_MS,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/speculation-budget.mjs';

const NORMAL = { reservesGlobalSlot: false };
const PEAK = { reservesGlobalSlot: true };
const NOW = new Date('2026-11-12T20:00:00Z'); // Nov 12 = peak deadline week

describe('checkGlobalBudgetGate — daily cap', () => {
  it('allows a post when posts_today is under the cap and no prior post', () => {
    const result = checkGlobalBudgetGate({
      cadence: NORMAL,
      globalPostsToday: 0,
      lastPostTs: null,
      now: NOW,
    });
    expect(result.allowed).toBe(true);
    expect(result.ceiling).toBe(MAX_GLOBAL_POSTS_PER_DAY);
  });

  it('blocks at the soft cap for non-peak cadence', () => {
    const result = checkGlobalBudgetGate({
      cadence: NORMAL,
      globalPostsToday: MAX_GLOBAL_POSTS_PER_DAY,
      lastPostTs: null,
      now: NOW,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/normal cap/);
  });

  it('peak-week cadence may use the reserved slot when the soft cap is met', () => {
    const result = checkGlobalBudgetGate({
      cadence: PEAK,
      globalPostsToday: MAX_GLOBAL_POSTS_PER_DAY,
      lastPostTs: null,
      now: NOW,
    });
    expect(result.allowed).toBe(true);
    expect(result.ceiling).toBe(MAX_GLOBAL_POSTS_PER_DAY + RESERVED_PEAK_SLOT);
  });

  it('peak-week cadence still blocks once the reservation is also used', () => {
    const result = checkGlobalBudgetGate({
      cadence: PEAK,
      globalPostsToday: MAX_GLOBAL_POSTS_PER_DAY + RESERVED_PEAK_SLOT,
      lastPostTs: null,
      now: NOW,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/peak-week reservation already used/);
  });
});

describe('checkGlobalBudgetGate — minimum spacing', () => {
  it('blocks when the last post landed inside the spacing window', () => {
    const lastPostTs = NOW.getTime() - 30 * 60 * 1000; // 30 minutes ago
    const result = checkGlobalBudgetGate({
      cadence: NORMAL,
      globalPostsToday: 1,
      lastPostTs,
      now: NOW,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/30m ago/);
  });

  it('allows the post once the spacing window has elapsed', () => {
    const lastPostTs = NOW.getTime() - (MIN_SPACING_MS + 1000);
    const result = checkGlobalBudgetGate({
      cadence: NORMAL,
      globalPostsToday: 1,
      lastPostTs,
      now: NOW,
    });
    expect(result.allowed).toBe(true);
  });

  it('peak-week reservation does NOT bypass the spacing rule', () => {
    const lastPostTs = NOW.getTime() - 5 * 60 * 1000; // 5 minutes ago
    const result = checkGlobalBudgetGate({
      cadence: PEAK,
      globalPostsToday: MAX_GLOBAL_POSTS_PER_DAY,
      lastPostTs,
      now: NOW,
    });
    // Cap check passes (peak slot available) but spacing still blocks.
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/spacing/);
  });

  it('treats a future-dated lastPostTs as "no recent post" rather than blocking', () => {
    // Defensive: clock skew or stale data shouldn't hard-block forever.
    const lastPostTs = NOW.getTime() + 10 * 60 * 1000;
    const result = checkGlobalBudgetGate({
      cadence: NORMAL,
      globalPostsToday: 1,
      lastPostTs,
      now: NOW,
    });
    expect(result.allowed).toBe(true);
  });
});
