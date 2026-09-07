import { describe, it, expect } from 'vitest';
import {
  resolveFeedMode,
  defaultSource,
  seasonModeEnd,
  seasonModeStart,
  SEASON_END_WEEKS,
} from '../src/utils/schefter-season-mode';
import { getCurrentSeasonYear, getSeasonStartForYear } from '../src/utils/league-year';

/**
 * The feed's in-season behaviour is entirely date-switched, so these dates ARE
 * the feature. Every assertion below is a calendar claim someone can check.
 */
describe('resolveFeedMode', () => {
  it('is offseason through the summer', () => {
    for (const iso of ['2026-02-20', '2026-04-15', '2026-06-30', '2026-08-20']) {
      expect(resolveFeedMode(new Date(`${iso}T12:00:00-07:00`))).toBe('offseason');
    }
  });

  /**
   * The season opens on the AFL NL draft — the commissioner's official start,
   * once both conferences have drafted and rosters are set. Labor Day was the
   * first cut and was over a week too late: it left the site serving wire
   * filler to owners whose teams were already built.
   */
  it('opens on the NL draft, over a week before Labor Day', () => {
    expect(resolveFeedMode(new Date('2026-08-29T12:00:00-07:00'))).toBe('offseason');
    // 11pm PT the night BEFORE the draft is still offseason.
    expect(resolveFeedMode(new Date('2026-08-29T23:00:00-07:00'))).toBe('offseason');
    expect(resolveFeedMode(new Date('2026-08-31T12:00:00-07:00'))).toBe('in-season');
    // Labor Day (Sep 7) and kickoff (Sep 10) are both well inside it now.
    expect(resolveFeedMode(new Date('2026-09-06T12:00:00-07:00'))).toBe('in-season');
    expect(resolveFeedMode(new Date('2026-09-09T12:00:00-07:00'))).toBe('in-season');
  });

  /**
   * The feed does NOT own its start date — it is the same instant the season
   * year rolls on, so the feed can never disagree with standings about whether
   * it is the season. This module previously carried its own definition (read
   * from the cron-written event feed, with a Labor-Day-derived fallback); that
   * is exactly the second definition this assertion exists to prevent
   * reappearing.
   */
  it('opens on the season itself, owning no date of its own', () => {
    for (const year of [2026, 2027, 2030]) {
      expect(seasonModeStart(year).getTime()).toBe(getSeasonStartForYear(year).getTime());
    }
  });

  /**
   * Every future season must resolve — a silent Invalid Date here would make
   * the feed offseason forever.
   */
  it('resolves a season far past any calendar the site has computed', () => {
    const start = seasonModeStart(2030);
    expect(Number.isNaN(start.getTime())).toBe(false);
    expect(start.getTime()).toBeLessThan(seasonModeEnd(2030).getTime());
  });

  it('stays in season across the New Year', () => {
    for (const iso of ['2026-10-15', '2026-12-25', '2027-01-20']) {
      expect(resolveFeedMode(new Date(`${iso}T12:00:00-08:00`))).toBe('in-season');
    }
  });

  it('closes after the Super Bowl', () => {
    // Super Bowl LXI: 2027-02-14. Still in season that night.
    expect(resolveFeedMode(new Date('2027-02-14T20:00:00-08:00'))).toBe('in-season');
    expect(resolveFeedMode(new Date('2027-02-25T12:00:00-08:00'))).toBe('offseason');
  });

  /**
   * The bug this guards: a base year that advances at Labor Day gets +1'd
   * twice. If resolveFeedMode ever read getCurrentLeagueYear() (Feb 14) instead
   * of getCurrentSeasonYear() (Labor Day), the whole spring would read as
   * in-season.
   */
  it('rides the Labor Day clock, so spring resolves to a finished season', () => {
    const spring = new Date('2027-04-01T12:00:00-07:00');
    expect(getCurrentSeasonYear(spring)).toBe(2026);
    expect(resolveFeedMode(spring)).toBe('offseason');
  });
});

describe('seasonModeEnd', () => {
  // The window must cover each season's Super Bowl. Openers are derived from
  // Labor Day, so this also pins that the derivation has not drifted.
  it.each([
    [2024, '2025-02-09'],
    [2025, '2026-02-08'],
    [2026, '2027-02-14'],
  ])('season %i still in season on Super Bowl Sunday (%s)', (year, superBowl) => {
    expect(seasonModeEnd(year).getTime()).toBeGreaterThan(
      new Date(`${superBowl}T23:59:00-05:00`).getTime(),
    );
  });

  it('closes well before the next preseason', () => {
    // A window that ran long would put the NEXT offseason into season mode.
    expect(seasonModeEnd(2026).getTime()).toBeLessThan(new Date('2027-07-01').getTime());
  });

  it('is a whole number of weeks after kickoff', () => {
    expect(SEASON_END_WEEKS).toBe(23);
  });
});

describe('defaultSource', () => {
  it('opens an owner on their own players in season', () => {
    expect(defaultSource('in-season', true)).toBe('watching');
  });

  it('never personalizes the offseason feed', () => {
    expect(defaultSource('offseason', true)).toBeNull();
  });

  /**
   * Logged-out and team-less visitors must see exactly what they see today, in
   * either mode — personalization is a signed-in upgrade, never a downgrade for
   * everyone else.
   */
  it('leaves a visitor with no team on the full feed', () => {
    expect(defaultSource('in-season', false)).toBeNull();
    expect(defaultSource('offseason', false)).toBeNull();
  });
});
