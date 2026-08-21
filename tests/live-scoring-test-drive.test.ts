/**
 * TEMPORARY — guards for the live-scoring test-drive promo.
 *
 * Delete alongside src/utils/live-scoring-test-drive.ts and the component.
 * Until then the one thing worth locking is that the promo EXPIRES: a banner
 * that says "test this today" is actively misleading the day after, and the
 * whole reason it is gated by a date rather than a flag is that nobody will
 * remember to take it down.
 */

import { describe, it, expect } from 'vitest';
import {
  isTestDriveWindow,
  testDriveBoards,
  TEST_DRIVE_PARAMS,
  TEST_DRIVE_QUERY,
} from '../src/utils/live-scoring-test-drive';
import { ALL_LEAGUES, leagueHasFeature } from '../src/config/leagues';

const pt = (iso: string) => new Date(iso);

describe('live-scoring test drive', () => {
  it('runs only over the preseason weekend it was written for', () => {
    expect(isTestDriveWindow(pt('2026-08-19T23:59:00-07:00')), 'before the window').toBe(false);
    expect(isTestDriveWindow(pt('2026-08-20T00:00:00-07:00')), 'first minute').toBe(true);
    // The boundary is PACIFIC. On the evening it was written it was already
    // the 21st in UTC, so a UTC-dated window would have been dark for the
    // Thursday night games it exists to promote.
    expect(isTestDriveWindow(pt('2026-08-20T19:56:00-07:00')), 'Thursday night games').toBe(true);
    expect(isTestDriveWindow(pt('2026-08-22T13:00:00-07:00')), 'mid-window').toBe(true);
    expect(isTestDriveWindow(pt('2026-08-23T23:59:00-07:00')), 'last minute').toBe(true);
    expect(isTestDriveWindow(pt('2026-08-24T00:00:00-07:00')), 'after the window').toBe(false);
  });

  it('is gone for good afterwards, not merely dormant for a season', () => {
    // A forgotten merge must not resurrect it next August.
    expect(isTestDriveWindow(pt('2026-10-05T12:00:00-07:00'))).toBe(false);
    expect(isTestDriveWindow(pt('2027-08-22T12:00:00-07:00'))).toBe(false);
  });

  it('carries every param the board needs to resolve a slate', () => {
    // Without the espn* override the board asks for regular-season week 1,
    // which does not exist yet, and comes back empty — the exact "broken or
    // just August?" ambiguity the promo exists to remove.
    expect(TEST_DRIVE_QUERY).toBe('demo=live&espnSeason=1&espnWeek=3&espnYear=2026');
    expect(TEST_DRIVE_PARAMS.map(([p]) => p)).toEqual(['demo', 'espnSeason', 'espnWeek', 'espnYear']);
    for (const [param, value, note] of TEST_DRIVE_PARAMS) {
      expect(value, `${param} needs a value`).not.toBe('');
      expect(note.length, `${param} needs an explanation — the promo IS the explanation`).toBeGreaterThan(20);
    }
  });

  it('offers exactly the leagues that have the board, current one first', () => {
    // Derived from the registry, so a league gaining or losing liveScoring is
    // right without editing the promo.
    const expected = ALL_LEAGUES
      .filter((l) => leagueHasFeature(l.slug, 'liveScoring') && !l.bestBall)
      .map((l) => l.slug);
    expect(expected.length, 'no league has liveScoring — the promo would be empty').toBeGreaterThan(0);

    for (const slug of expected) {
      const boards = testDriveBoards(slug);
      expect(boards.map((b) => b.slug).sort()).toEqual([...expected].sort());
      expect(boards[0].slug, 'the viewer’s own league leads').toBe(slug);
      expect(boards.filter((b) => b.isCurrent)).toHaveLength(1);
      for (const b of boards) {
        // Prefix intact: both homepages render prefixed internal routes, and a
        // cross-league link must keep its prefix regardless.
        expect(b.path).toBe(`/${b.slug}/live-scoring?${TEST_DRIVE_QUERY}`);
      }
    }
  });

  it('never lists a league with nothing on the board', () => {
    const listed = testDriveBoards('theleague').map((b) => b.slug);
    for (const l of ALL_LEAGUES) {
      if (!leagueHasFeature(l.slug, 'liveScoring')) {
        expect(listed, `${l.slug} has no board`).not.toContain(l.slug);
      }
      if (l.bestBall) {
        // Draft-only: its MFL season does not exist until draft night, so the
        // board renders "scores will appear here when games begin". Linking an
        // empty page from a "go look at this" promo reads as a broken feature.
        expect(listed, `${l.slug} is draft-only and has no matchups yet`).not.toContain(l.slug);
      }
    }
    expect(listed.length, 'the promo would be empty').toBeGreaterThan(0);
  });
});
