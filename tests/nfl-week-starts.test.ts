import { describe, it, expect } from 'vitest';
import {
  REGULAR_SEASON_WEEKS,
  derivedWeekStartIsoDate,
  hasOfficialSchedule,
  nflKickoffIsoDate,
  nflWeekStart,
  nflWeekStartInstant,
  nflWeekStartIsoDate,
  officialWeekStart,
} from '../src/utils/nfl-week-starts.mjs';
import { NFL_WEEK_STARTS } from '../src/data/nfl/week-starts.mjs';

/** Season years present in the committed data, as numbers — the key type. */
const SEASONS: number[] = Object.keys(NFL_WEEK_STARTS).map(Number);

/**
 * The NFL week anchor: published schedule first, Labor Day derivation second.
 *
 * Roger posted "TODAY: NFL Season Starts" to GroupMe on Thursday 2026-09-10.
 * The season had opened the previous night — the NFL moved the opener to
 * WEDNESDAY Sep 9 — because every date in the repo hung off "kickoff is the
 * Thursday after Labor Day". See docs/claude/rules/schedule-optimization.md.
 */
describe('nflWeekStartIsoDate — published schedule wins', () => {
  it('reports the real 2026 opener, a Wednesday, not Labor Day + 3', () => {
    expect(nflKickoffIsoDate(2026)).toBe('2026-09-09');
    // What the old derivation said, and what Roger announced a day late.
    expect(derivedWeekStartIsoDate(2026, 1)).toBe('2026-09-10');
  });

  it('tracks the two other 2026 weeks the derivation gets wrong', () => {
    // Week 12 moved to the Wednesday of Thanksgiving; week 18 is all-Sunday.
    expect(nflWeekStartIsoDate(2026, 12)).toBe('2026-11-25');
    expect(derivedWeekStartIsoDate(2026, 12)).toBe('2026-11-26');
    expect(nflWeekStartIsoDate(2026, 18)).toBe('2027-01-10');
    expect(derivedWeekStartIsoDate(2026, 18)).toBe('2027-01-07');
  });

  it('agrees with the derivation on the weeks the NFL did not move', () => {
    // The weeks every league deadline hangs off. If these ever diverge it is
    // real news, not noise — a moved week 11 moves both trade deadlines.
    for (const week of [11, 15, 17]) {
      expect(nflWeekStartIsoDate(2026, week)).toBe(derivedWeekStartIsoDate(2026, week));
    }
  });
});

describe('the Labor Day fallback', () => {
  it('answers for a season the NFL has not published', () => {
    expect(hasOfficialSchedule(2031)).toBe(false);
    expect(officialWeekStart(2031, 1)).toBeNull();
    // Labor Day 2031 is Sep 1, so the derived opener is Thursday Sep 4.
    expect(nflKickoffIsoDate(2031)).toBe('2031-09-04');
    expect(nflWeekStart(2031, 1).getDay()).toBe(4);
  });

  it('gives a derived week the nominal 20:20 ET kickoff instant', () => {
    // The value the retired hardcoded maps carried, so nothing that reads an
    // instant changes behavior for an unpublished season.
    expect(nflWeekStartInstant(2031, 1).toISOString()).toBe(
      new Date('2031-09-04T20:20:00-04:00').toISOString(),
    );
  });

  it('is a fallback, not a floor — the published date overrides it', () => {
    expect(hasOfficialSchedule(2026)).toBe(true);
    expect(nflWeekStartInstant(2026, 1).toISOString()).toBe(
      new Date('2026-09-09T20:20:00-04:00').toISOString(),
    );
  });
});

describe('the committed schedule data', () => {
  it('holds all 18 regular-season weeks for every season it lists', () => {
    expect(SEASONS.length).toBeGreaterThan(0);
    for (const year of SEASONS) {
      for (let week = 1; week <= REGULAR_SEASON_WEEKS; week += 1) {
        expect(NFL_WEEK_STARTS[year][week], `${year} week ${week}`).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/,
        );
      }
    }
  });

  it('runs strictly forward, 3 to 11 days between week starts', () => {
    // The shape check the fetcher refuses to commit past. A season that fails
    // it means MFL served a partial schedule, which must never overwrite a
    // good one.
    for (const year of SEASONS) {
      for (let week = 2; week <= REGULAR_SEASON_WEEKS; week += 1) {
        const gap =
          (Date.parse(NFL_WEEK_STARTS[year][week]) - Date.parse(NFL_WEEK_STARTS[year][week - 1])) /
          86_400_000;
        expect(gap, `${year} week ${week}`).toBeGreaterThanOrEqual(3);
        expect(gap, `${year} week ${week}`).toBeLessThanOrEqual(11);
      }
    }
  });

  it('rejects a week number outside the regular season', () => {
    expect(() => nflWeekStartIsoDate(2026, 0)).toThrow();
    expect(() => nflWeekStartIsoDate(2026, 19)).toThrow();
    expect(() => nflWeekStartIsoDate(2026, 4.5)).toThrow();
  });
});
