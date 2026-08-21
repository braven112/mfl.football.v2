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
  showTestDriveHero,
  testDriveBoard,
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
    // just August?" ambiguity the hero exists to remove. These live on the
    // button and are never printed; the reader taps, they do not configure.
    expect(TEST_DRIVE_QUERY).toBe('demo=live&espnSeason=1&espnWeek=3&espnYear=2026');
    expect(TEST_DRIVE_PARAMS.map(([p]) => p)).toEqual(['demo', 'espnSeason', 'espnWeek', 'espnYear']);
    for (const [param, value] of TEST_DRIVE_PARAMS) {
      expect(value, `${param} needs a value`).not.toBe('');
    }
  });

  it('offers THIS league\u2019s board and no other', () => {
    // One league, not both: an owner on TheLeague's homepage is being asked to
    // check TheLeague's board, and offering the AFL's alongside it turns one
    // instruction into a choice.
    for (const league of ALL_LEAGUES) {
      const board = testDriveBoard(league.slug);
      if (!board) continue;
      expect(board.slug).toBe(league.slug);
      expect(board.name).toBe(league.name);
      // Prefix intact: both homepages render prefixed internal routes.
      expect(board.path).toBe(`/${league.slug}/live-scoring?${TEST_DRIVE_QUERY}`);
    }
  });

  it('returns null for a league with nothing on the board', () => {
    for (const l of ALL_LEAGUES) {
      if (!leagueHasFeature(l.slug, 'liveScoring')) {
        expect(testDriveBoard(l.slug), `${l.slug} has no board`).toBeNull();
      }
      if (l.bestBall) {
        // Draft-only: its MFL season does not exist until draft night, so the
        // board renders "scores will appear here when games begin". Linking an
        // empty page from a go-look-at-this hero reads as a broken feature.
        expect(testDriveBoard(l.slug), `${l.slug} is draft-only`).toBeNull();
      }
    }
    expect(testDriveBoard('not-a-league')).toBeNull();
  });

  it('at least one league actually gets the hero', () => {
    // Guards the whole thing being silently inert.
    const shown = ALL_LEAGUES.filter((l) => showTestDriveHero(l.slug, pt('2026-08-21T12:00:00-07:00')));
    expect(shown.length).toBeGreaterThan(0);
  });

  it('the page-level gate agrees with the component\u2019s, in both directions', () => {
    // The page uses showTestDriveHero to SUPPRESS its normal hero, and the
    // component independently decides whether to render. If those two ever
    // disagree the homepage shows two heroes or none — the failure this pairs
    // against, so it is asserted rather than assumed.
    const inside = pt('2026-08-21T12:00:00-07:00');
    const outside = pt('2026-09-21T12:00:00-07:00');
    for (const l of ALL_LEAGUES) {
      const hasBoard = testDriveBoard(l.slug) !== null;
      expect(showTestDriveHero(l.slug, inside), `${l.slug} inside the window`).toBe(hasBoard);
      expect(showTestDriveHero(l.slug, outside), `${l.slug} outside the window`).toBe(false);
    }
  });
});
