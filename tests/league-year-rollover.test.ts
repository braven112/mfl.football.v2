import { describe, it, expect, afterEach, vi } from 'vitest';
import { getLeagueYear, getSeasonStartForYear } from '../src/utils/league-year';
import { resolveDateForYear } from '../src/utils/league-event-resolver';

/**
 * Season-rollover regression suite for getLeagueYear.
 *
 * Two invariants this file exists to protect:
 *
 * 1. The season flip: on the NL draft (the Sunday before Labor Day weekend)
 *    the season year advances (standings/playoffs/draft predictor switch to
 *    the new season) while the league year is unchanged (it already advanced
 *    Feb 14).
 *
 * 2. Stale env pins self-heal: PUBLIC_BASE_YEAR / PUBLIC_MFL_YEAR may be
 *    pinned in the Vercel env (e.g. 2025). Without a clamp, the pin freezes
 *    the base year while the Feb/season cutoffs advance with the calendar
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

  /**
   * The season flips on the NL DRAFT (Sunday before Labor Day weekend), not on
   * Labor Day. It rolled on Labor Day until Sep 2026, which was eight days too
   * late: both AFL drafts were done, every roster was real, and standings,
   * draft order, MVP tracking and the Schefter feed were all still reporting
   * the PREVIOUS season.
   */
  it('season year flips on the NL draft 2026 (Sun Aug 30), not Labor Day', () => {
    const before = getLeagueYear(new Date('2026-08-29T12:00:00'));
    expect(before.currentSeasonYear).toBe(2025);

    const after = getLeagueYear(new Date('2026-08-30T12:00:00'));
    expect(after.currentLeagueYear).toBe(2026);
    expect(after.currentSeasonYear).toBe(2026);
    expect(after.nextDraftYear).toBe(2027);

    // The eight days this change moved. Under the old Labor Day cutoff every
    // one of these read 2025.
    for (const day of ['2026-08-31', '2026-09-03', '2026-09-06']) {
      expect(getLeagueYear(new Date(`${day}T12:00:00`)).currentSeasonYear).toBe(2026);
    }

    // Labor Day itself keeps working — it is inside the window now, not the edge.
    expect(getLeagueYear(new Date('2026-09-07T12:00:00')).currentSeasonYear).toBe(2026);
  });

  /**
   * The rollover date is DERIVED (`laborDay - 8`) while the league calendar
   * spells the same day as the `sunday-before-labor-day-weekend` rule. Two
   * derivations of one date drift silently, so pin them against each other.
   */
  it('agrees with the league calendar rule for the NL draft', () => {
    for (const year of [2026, 2027, 2028, 2029, 2030]) {
      const derived = getSeasonStartForYear(year);
      const fromCalendar = resolveDateForYear(
        { type: 'computed', rule: 'sunday-before-labor-day-weekend' },
        year,
      );
      expect(derived.getFullYear()).toBe(fromCalendar.getFullYear());
      expect(derived.getMonth()).toBe(fromCalendar.getMonth());
      expect(derived.getDate()).toBe(fromCalendar.getDate());
      // Always a Sunday, in every year.
      expect(derived.getDay()).toBe(0);
    }
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

  it('a 2025 pin does not block the 2026 season flip', () => {
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
