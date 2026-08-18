import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  nflWeekOneKickoff,
  isSeasonWindowOpen,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../src/utils/pecking-order-season-window.mjs';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { resolveSeasonGate } from '../scripts/generate-pecking-order.mjs';

/**
 * Regression: on 2026-08-18 the preseason Tuesday cron generated AFL 2025
 * week 16 (currentSeasonYear() still resolves to 2025 until Labor Day) and
 * blasted a GroupMe announcement ranking a season that ended in December.
 */
describe('nflWeekOneKickoff', () => {
  // Derived from Labor Day; must reproduce week-resolver's hardcoded map.
  it.each([
    [2024, '2024-09-05T20:20:00-04:00'],
    [2025, '2025-09-04T20:20:00-04:00'],
    [2026, '2026-09-10T20:20:00-04:00'],
    [2027, '2027-09-09T20:20:00-04:00'],
  ])('matches the known NFL opener for %i', (year, iso) => {
    expect(nflWeekOneKickoff(year as number).toISOString()).toBe(
      new Date(iso as string).toISOString()
    );
  });

  it('keeps deriving past the end of the hardcoded map', () => {
    // 2030: Labor Day is Sep 2, opener Sep 5.
    expect(nflWeekOneKickoff(2030).toISOString()).toBe(
      new Date('2030-09-05T20:20:00-04:00').toISOString()
    );
  });
});

describe('isSeasonWindowOpen', () => {
  it('is closed before the season it would rank kicks off', () => {
    // Labor Day 2026 is Sep 7; the opener is Sep 10. The clock has already
    // rolled to the 2026 season but no game has been played.
    expect(isSeasonWindowOpen(2026, new Date('2026-09-08T14:00:00Z'))).toBe(false);
  });

  it('is closed all preseason for the previous, finished season', () => {
    expect(isSeasonWindowOpen(2025, new Date('2026-08-18T14:43:00Z'))).toBe(false);
    expect(isSeasonWindowOpen(2025, new Date('2026-03-01T14:00:00Z'))).toBe(false);
    expect(isSeasonWindowOpen(2025, new Date('2026-07-01T14:00:00Z'))).toBe(false);
  });

  it('is open on in-season Tuesdays', () => {
    expect(isSeasonWindowOpen(2026, new Date('2026-09-15T14:00:00Z'))).toBe(true); // after wk 1
    expect(isSeasonWindowOpen(2026, new Date('2026-11-17T14:00:00Z'))).toBe(true);
    expect(isSeasonWindowOpen(2026, new Date('2026-12-29T14:00:00Z'))).toBe(true);
  });

  it('closes after the fantasy season is over', () => {
    expect(isSeasonWindowOpen(2025, new Date('2026-02-10T14:00:00Z'))).toBe(false);
  });
});

describe('resolveSeasonGate', () => {
  it('skips the preseason run that shipped the bad AFL post', () => {
    const gate = resolveSeasonGate({ now: new Date('2026-08-18T14:43:00Z') });
    expect(gate.skip).toBe(true);
    expect(gate.year).toBe(2025);
  });

  it('skips between Labor Day and week 1 kickoff', () => {
    expect(resolveSeasonGate({ now: new Date('2026-09-08T14:00:00Z') })).toMatchObject({
      skip: true,
      year: 2026,
    });
  });

  it('runs in season, on the season being played', () => {
    const gate = resolveSeasonGate({ now: new Date('2026-11-17T14:00:00Z') });
    expect(gate.skip).toBe(false);
    expect(gate.year).toBe(2026);
  });

  it('lets an explicit --year backfill bypass the window', () => {
    const gate = resolveSeasonGate({ optsYear: 2025, now: new Date('2026-08-18T14:43:00Z') });
    expect(gate.skip).toBe(false);
    expect(gate.year).toBe(2025);
  });
});
