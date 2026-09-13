/**
 * Guard: the release blackout windows, at their boundaries.
 *
 * Every rule in `scripts/release-blackout.mjs` is a day somebody would
 * otherwise have to remember while about to ship. Boundaries are what break —
 * "Labor Day + 3" is four days, not three, and Feb 14 lands on a different
 * weekday every year — so each rule is pinned on both sides of its edge rather
 * than at a comfortable midpoint.
 *
 * Dates are constructed at noon PT so the assertion is about the calendar day,
 * not about a UTC boundary the script deliberately does not use.
 */

import { describe, it, expect } from 'vitest';
import { resolveBlackout } from '../scripts/release-blackout.mjs';

/** Noon Pacific on an ISO day — safely inside the day in any US offset. */
const at = (iso: string) => new Date(`${iso}T12:00:00-08:00`);

const reasonsOf = (iso: string) => resolveBlackout(at(iso)).reasons.join(' | ');
const blocked = (iso: string) => resolveBlackout(at(iso)).blocked;

describe('release blackout — NFL game days', () => {
  // 2026 season. Nov 15 is a Sunday, Nov 17 a Tuesday.
  it('blocks Sunday, Monday, Thursday and Saturday in season', () => {
    expect(blocked('2026-11-15'), 'Sunday').toBe(true);
    expect(blocked('2026-11-16'), 'Monday').toBe(true);
    expect(blocked('2026-11-19'), 'Thursday').toBe(true);
    expect(blocked('2026-11-21'), 'Saturday').toBe(true);
  });

  it('leaves Tuesday, Wednesday and Friday clear — Tuesday is the train day', () => {
    expect(blocked('2026-11-17'), 'Tuesday').toBe(false);
    expect(blocked('2026-11-18'), 'Wednesday').toBe(false);
    expect(blocked('2026-11-20'), 'Friday').toBe(false);
  });

  it('does not treat an out-of-season Sunday as a game day', () => {
    // Mid-June: no season window, so a Sunday is just a Sunday. This is the
    // rule CLAUDE.md warns about — "in season" is never `month >= 9`, and a
    // blackout that fired year-round would block most of the offseason.
    const june = resolveBlackout(at('2026-06-21'));
    expect(june.inSeason).toBe(false);
    expect(june.blocked).toBe(false);
  });
});

describe('release blackout — the two year-rollover clocks', () => {
  it('blocks Feb 14 and the day either side', () => {
    expect(reasonsOf('2027-02-13')).toMatch(/league-year rollover is tomorrow/);
    expect(reasonsOf('2027-02-14')).toMatch(/league-year rollover is today/);
    expect(reasonsOf('2027-02-15')).toMatch(/league-year rollover is yesterday/);
  });

  it('clears two days out from Feb 14', () => {
    expect(blocked('2027-02-12')).toBe(false);
    expect(blocked('2027-02-16')).toBe(false);
  });

  it('blocks Labor Day through Labor Day + 3, and clears on + 4', () => {
    // Labor Day 2026 is Sep 7. The window is four days, because "in season" is
    // Labor Day + 3 — an off-by-one here reopens the exact day the season-year
    // clock turns.
    expect(blocked('2026-09-07'), 'Labor Day').toBe(true);
    expect(blocked('2026-09-10'), 'Labor Day + 3').toBe(true);

    // + 4 is clear of the rollover rule itself. It may still be blocked as a
    // game day, so assert on the reason rather than the boolean.
    expect(reasonsOf('2026-09-11')).not.toMatch(/Labor Day \+/);
  });

  it('does not fire the Labor Day rule before Labor Day', () => {
    expect(reasonsOf('2026-09-06')).not.toMatch(/Labor Day \+/);
  });
});

describe('release blackout — the AFL draft', () => {
  it('blocks the AFL National League draft day and the day either side', () => {
    // Derived, not fixed: the Sunday eight days before Labor Day. 2026 → Aug 30.
    expect(reasonsOf('2026-08-30')).toMatch(/AFL National League draft is today/);
    expect(reasonsOf('2026-08-29')).toMatch(/AFL National League draft is tomorrow/);
    expect(reasonsOf('2026-08-31')).toMatch(/AFL National League draft is yesterday/);
  });

  it('derives the date per year rather than hardcoding one', () => {
    // 2027's Labor Day is Sep 6, so the draft moves to Aug 29 — a test that
    // passed only for 2026 would be pinning a constant that does not exist.
    expect(reasonsOf('2027-08-29')).toMatch(/AFL National League draft is today/);
    expect(reasonsOf('2026-08-29')).not.toMatch(/draft is today/);
  });
});

describe('release blackout — shape', () => {
  it('reports every applicable reason, not just the first', () => {
    // Labor Day is a Monday, so in a season that has begun it trips both the
    // game-day rule and the rollover rule. A promotion held for two reasons
    // should say both — fixing one and retrying should not surprise anyone.
    const laborDay = resolveBlackout(at('2026-09-07'));
    expect(laborDay.reasons.length).toBeGreaterThanOrEqual(1);
    expect(laborDay.blocked).toBe(true);
  });

  it('names the weekday and date it judged, so a wrong answer is debuggable', () => {
    const result = resolveBlackout(at('2026-11-17'));
    expect(result.date).toBe('2026-11-17');
    expect(result.weekday).toBe('Tuesday');
  });

  it('evaluates the calendar day in Pacific, not UTC', () => {
    // 5pm PT Tuesday is already Wednesday in UTC. The league's clock is PT
    // (officialClock), so this must still read as Tuesday — a UTC evaluation
    // would roll the day over mid-afternoon and mislabel every late release.
    const tuesdayEvening = new Date('2026-11-17T17:00:00-08:00');
    expect(resolveBlackout(tuesdayEvening).weekday).toBe('Tuesday');
    expect(resolveBlackout(tuesdayEvening).date).toBe('2026-11-17');
  });
});
