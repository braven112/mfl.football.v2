import { describe, it, expect, afterEach, vi } from 'vitest';
import { getLeagueYear } from '../src/utils/league-year';

/**
 * Season-rollover regression suite for getLeagueYear.
 *
 * Two invariants this file exists to protect:
 *
 * 1. The Labor Day flip: on the first Monday of September the season year
 *    advances (standings/playoffs/draft predictor switch to the new season)
 *    while the league year is unchanged (it already advanced Feb 14).
 *
 * 2. Stale env pins self-heal: PUBLIC_BASE_YEAR / PUBLIC_MFL_YEAR may be
 *    pinned in the Vercel env (e.g. 2025). Without a clamp, the pin freezes
 *    the base year while the Feb/Labor Day cutoffs advance with the calendar
 *    year — so on Jan 1 of the following year every page silently regresses
 *    to the pinned season. The env pin must act as a floor-only override:
 *    it can push the base year forward, never hold it back.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getLeagueYear — 2026 season timeline (no env pin)', () => {
  it('dual-year window: after Feb 14 2026, league=2026 season=2025', () => {
    const config = getLeagueYear(new Date('2026-07-28T12:00:00'));
    expect(config.currentLeagueYear).toBe(2026);
    expect(config.currentSeasonYear).toBe(2025);
    expect(config.nextDraftYear).toBe(2026);
  });

  it('season year flips on Labor Day 2026 (Mon Sep 7)', () => {
    const before = getLeagueYear(new Date('2026-09-06T12:00:00'));
    expect(before.currentSeasonYear).toBe(2025);

    const after = getLeagueYear(new Date('2026-09-07T12:00:00'));
    expect(after.currentLeagueYear).toBe(2026);
    expect(after.currentSeasonYear).toBe(2026);
    expect(after.nextDraftYear).toBe(2027);
  });

  it('stays consistent through the 2026 season and into January 2027', () => {
    const december = getLeagueYear(new Date('2026-12-15T12:00:00'));
    expect(december.currentLeagueYear).toBe(2026);
    expect(december.currentSeasonYear).toBe(2026);

    // The Jan 1 boundary is where a frozen base year would regress.
    const january = getLeagueYear(new Date('2027-01-15T12:00:00'));
    expect(january.currentLeagueYear).toBe(2026);
    expect(january.currentSeasonYear).toBe(2026);
  });

  it('league year flips at Feb 14 2027 8:45pm PT', () => {
    const before = getLeagueYear(new Date('2027-02-15T04:00:00Z'));
    expect(before.currentLeagueYear).toBe(2026);

    const after = getLeagueYear(new Date('2027-02-15T05:00:00Z'));
    expect(after.currentLeagueYear).toBe(2027);
    expect(after.currentSeasonYear).toBe(2026);
  });
});

describe('getLeagueYear — stale PUBLIC_BASE_YEAR pin self-heals', () => {
  it('a 2025 pin still yields the correct years in January 2027', () => {
    vi.stubEnv('PUBLIC_BASE_YEAR', '2025');
    const january = getLeagueYear(new Date('2027-01-15T12:00:00'));
    expect(january.currentLeagueYear).toBe(2026);
    expect(january.currentSeasonYear).toBe(2026);
  });

  it('a 2025 pin does not block the Labor Day 2026 flip', () => {
    vi.stubEnv('PUBLIC_BASE_YEAR', '2025');
    const after = getLeagueYear(new Date('2026-09-07T12:00:00'));
    expect(after.currentSeasonYear).toBe(2026);
  });

  it('a 2025 pin matches the auto-calculated years during the dual window', () => {
    vi.stubEnv('PUBLIC_BASE_YEAR', '2025');
    const config = getLeagueYear(new Date('2026-07-28T12:00:00'));
    expect(config.currentLeagueYear).toBe(2026);
    expect(config.currentSeasonYear).toBe(2025);
  });

  it('legacy PUBLIC_MFL_YEAR pin self-heals the same way', () => {
    vi.stubEnv('PUBLIC_MFL_YEAR', '2025');
    const january = getLeagueYear(new Date('2027-01-15T12:00:00'));
    expect(january.currentLeagueYear).toBe(2026);
    expect(january.currentSeasonYear).toBe(2026);
  });

  it('a garbage pin falls back to the auto-calculated base year', () => {
    vi.stubEnv('PUBLIC_BASE_YEAR', 'not-a-year');
    const config = getLeagueYear(new Date('2026-07-28T12:00:00'));
    expect(config.currentLeagueYear).toBe(2026);
    expect(config.currentSeasonYear).toBe(2025);
  });

  it('a forward pin is still honored (floor-only clamp)', () => {
    // Pinning ahead of the calendar is an explicit manual override — keep it.
    vi.stubEnv('PUBLIC_BASE_YEAR', '2026');
    const config = getLeagueYear(new Date('2026-07-28T12:00:00'));
    expect(config.currentLeagueYear).toBe(2027);
    expect(config.currentSeasonYear).toBe(2026);
  });
});
