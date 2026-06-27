import { describe, it, expect } from 'vitest';
import { getAflLeagueYear } from '../src/utils/league-year';

/**
 * AFL rolls over to the new MFL league year on June 1 (PT) — NOT TheLeague's
 * Feb 14 date. Hard flip: on/after June 1 the helper returns the new calendar
 * year regardless of whether the MFL league exists yet.
 */
describe('getAflLeagueYear', () => {
  it('stays on the prior year before June 1', () => {
    // Jan 1, 2026 → still the 2025 AFL league
    expect(getAflLeagueYear(new Date('2026-01-01T12:00:00Z'))).toBe(2025);
    // Feb 14 (TheLeague rollover) must NOT affect AFL
    expect(getAflLeagueYear(new Date('2026-02-14T23:00:00Z'))).toBe(2025);
    // May 31 → still prior year
    expect(getAflLeagueYear(new Date('2026-05-31T23:00:00Z'))).toBe(2025);
  });

  it('flips to the new year on June 1 (PT)', () => {
    // June 1 00:00 PDT = 07:00 UTC — the boundary
    expect(getAflLeagueYear(new Date('2026-06-01T07:00:00Z'))).toBe(2026);
    expect(getAflLeagueYear(new Date('2026-06-01T12:00:00Z'))).toBe(2026);
    expect(getAflLeagueYear(new Date('2026-12-31T12:00:00Z'))).toBe(2026);
  });

  it('does not flip just before the PT boundary', () => {
    // June 1 06:59 UTC = May 31 23:59 PDT → still prior year
    expect(getAflLeagueYear(new Date('2026-06-01T06:59:00Z'))).toBe(2025);
  });

  it('works across multiple years', () => {
    expect(getAflLeagueYear(new Date('2025-06-01T07:00:00Z'))).toBe(2025);
    expect(getAflLeagueYear(new Date('2025-05-31T12:00:00Z'))).toBe(2024);
    expect(getAflLeagueYear(new Date('2027-07-15T12:00:00Z'))).toBe(2027);
  });
});
