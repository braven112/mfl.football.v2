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
  it('blocks Sunday, Monday and Thursday in season', () => {
    expect(blocked('2026-11-15'), 'Sunday').toBe(true);
    expect(blocked('2026-11-16'), 'Monday').toBe(true);
    expect(blocked('2026-11-19'), 'Thursday').toBe(true);
  });

  // Saturday was removed from the routine set on 2026-09-19 (Brandon's call):
  // the NFL plays no Saturday games for most of the season, so blacking out
  // every Saturday taxed ~13 clear days a year to protect the late-season
  // outliers. Pinned so the removal is deliberate rather than drift — and so
  // the gap it leaves is written down where the next reader will find it.
  it('leaves an in-season Saturday clear', () => {
    expect(blocked('2026-11-21'), 'Saturday in season').toBe(false);
  });

  it('leaves an ordinary Tuesday, Wednesday and Friday clear — Tuesday is the train day', () => {
    expect(blocked('2026-11-17'), 'Tuesday').toBe(false);
    expect(blocked('2026-11-18'), 'Wednesday').toBe(false);
    expect(blocked('2026-11-20'), 'Friday').toBe(false);
  });

  it('blocks the WEDNESDAY week starts the real schedule carries', () => {
    // The bug this pins: a fixed Thu/Sat/Sun/Mon weekday set said "clear to
    // promote" on two live game days. 2026 week 1 is Wed Sep 9 and week 12 is
    // Wed Nov 25 (src/data/nfl/week-starts.mjs). CLAUDE.md says it directly —
    // kickoff is not a derivation, read the schedule.
    expect(reasonsOf('2026-11-25')).toMatch(/NFL week start/);
    expect(blocked('2026-11-25'), 'Thanksgiving-week Wednesday').toBe(true);
    expect(blocked('2026-09-09'), 'opening Wednesday').toBe(true);
  });

  it('resolves the season year on the Labor Day clock, so January still counts', () => {
    // Week 18 of the 2026 season starts 2027-01-10. Asking about calendar year
    // 2027 compares against a kickoff eight months out and calls a live game
    // day the offseason.
    const weekEighteen = resolveBlackout(at('2027-01-10'));
    expect(weekEighteen.seasonYear).toBe(2026);
    expect(weekEighteen.inSeason).toBe(true);
    expect(weekEighteen.blocked).toBe(true);
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
  it("blocks TheLeague's Feb 14 rollover and the day either side", () => {
    expect(reasonsOf('2027-02-13')).toMatch(/theleague.*rollover is tomorrow/);
    expect(reasonsOf('2027-02-14')).toMatch(/theleague.*rollover is today/);
    expect(reasonsOf('2027-02-15')).toMatch(/theleague.*rollover is yesterday/);
  });

  it("blocks the AFL's June 1 rollover, which is NOT Feb 14", () => {
    // Read from the registry per league. Hardcoding Feb 14 sailed straight
    // through the AFL and Best Ball transitions, which roll on June 1 because
    // their MFL leagues are created in late spring.
    expect(reasonsOf('2026-06-01')).toMatch(/afl-fantasy.*rollover is today/);
    expect(blocked('2026-06-01')).toBe(true);
    // And an ordinary June Tuesday stays clear.
    expect(blocked('2026-06-16')).toBe(false);
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
    // Needs a date where two rules genuinely overlap, and asserts BOTH.
    // 2026-09-10 is Labor Day + 3 AND a Thursday in season; the earlier
    // version used Sep 7, where only one rule applies and a
    // `toBeGreaterThanOrEqual(1)` would have passed with a reason dropped.
    const overlap = resolveBlackout(at('2026-09-10'));
    expect(overlap.blocked).toBe(true);
    const joined = overlap.reasons.join(' | ');
    expect(joined, 'the Labor Day rollover reason').toMatch(/Labor Day \+ 3/);
    expect(joined, 'the game-day reason').toMatch(/Thursday/);
    expect(overlap.reasons.length).toBeGreaterThanOrEqual(2);
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
