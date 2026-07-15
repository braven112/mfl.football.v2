import { describe, it, expect } from 'vitest';
import { getLeagueYearForSlug, getCurrentLeagueYear, getAflLeagueYear } from '../src/utils/league-year';

/**
 * getLeagueYearForSlug is the slug-keyed sibling of getLeagueYearForMflId —
 * used by routes that resolve a league from the registry (by slug) rather
 * than from a raw MFL id. It must agree with the id-keyed helpers on every
 * date, including around each league's own rollover clock (TheLeague Feb 14,
 * AFL June 1 — see CLAUDE.md "Year rollover — two independent clocks").
 */
describe('getLeagueYearForSlug', () => {
  it('theleague uses the Feb 14 clock, matching getCurrentLeagueYear', () => {
    const beforeCutoff = new Date('2026-02-14T12:00:00Z');
    const afterCutoff = new Date('2026-02-15T05:00:00Z');
    expect(getLeagueYearForSlug('theleague', beforeCutoff)).toBe(
      getCurrentLeagueYear(beforeCutoff)
    );
    expect(getLeagueYearForSlug('theleague', afterCutoff)).toBe(
      getCurrentLeagueYear(afterCutoff)
    );
  });

  it('afl-fantasy uses the June 1 clock, matching getAflLeagueYear', () => {
    const beforeCutoff = new Date('2026-05-31T23:00:00Z');
    const afterCutoff = new Date('2026-06-01T12:00:00Z');
    expect(getLeagueYearForSlug('afl-fantasy', beforeCutoff)).toBe(
      getAflLeagueYear(beforeCutoff)
    );
    expect(getLeagueYearForSlug('afl-fantasy', afterCutoff)).toBe(
      getAflLeagueYear(afterCutoff)
    );
  });

  it('diverges between the two clocks in the Feb 14 – June 1 window', () => {
    // March 1: TheLeague has already rolled to the new year; AFL has not.
    const marchFirst = new Date('2026-03-01T12:00:00Z');
    const theleagueYear = getLeagueYearForSlug('theleague', marchFirst);
    const aflYear = getLeagueYearForSlug('afl-fantasy', marchFirst);
    expect(theleagueYear).toBe(aflYear + 1);
  });

  it('falls back to the Feb 14 clock for an unknown slug', () => {
    const date = new Date('2026-07-01T12:00:00Z');
    expect(getLeagueYearForSlug('not-a-real-league', date)).toBe(
      getCurrentLeagueYear(date)
    );
  });
});
