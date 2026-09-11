import { describe, it, expect } from 'vitest';
import {
  REGULAR_SEASON_WEEKS,
  nflWeekFor,
  derivedWeekStartIsoDate,
  hasOfficialSchedule,
  nflKickoffIsoDate,
  nflWeekStart,
  nflWeekStartInstant,
  nflWeekStartIsoDate,
  officialWeekStart,
} from '../src/utils/nfl-week-starts.mjs';
import { NFL_WEEK_STARTS } from '../src/data/nfl/week-starts.mjs';
import {
  CHAMPIONSHIP_WEEK,
  FINAL_FANTASY_REGULAR_SEASON_WEEK,
  FINAL_REGULAR_SEASON_WEEK,
  PLAYOFFS_START_WEEK,
  SEMIFINAL_WEEK,
} from '../src/utils/fantasy-bracket.mjs';

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
  // Derived, not hardcoded: the daily refresh adds seasons to NFL_WEEK_STARTS
  // as the NFL publishes them, so any fixed "unpublished" year eventually
  // becomes published and turns this suite red for no reason. Five past the
  // newest season we hold is always beyond what the fetcher reaches (it asks
  // for this year and next).
  const UNPUBLISHED = Math.max(...SEASONS) + 5;

  it('answers for a season the NFL has not published', () => {
    expect(hasOfficialSchedule(UNPUBLISHED)).toBe(false);
    expect(officialWeekStart(UNPUBLISHED, 1)).toBeNull();
    // Falls through to the derivation: the Thursday after Labor Day.
    expect(nflKickoffIsoDate(UNPUBLISHED)).toBe(derivedWeekStartIsoDate(UNPUBLISHED, 1));
    expect(nflWeekStart(UNPUBLISHED, 1).getDay()).toBe(4);
    expect(nflWeekStart(UNPUBLISHED, 1).getMonth()).toBe(8); // September
  });

  it('gives a derived week the nominal 20:20 ET kickoff instant', () => {
    // The value the retired hardcoded maps carried, so nothing that reads an
    // instant changes behavior for an unpublished season.
    const iso = derivedWeekStartIsoDate(UNPUBLISHED, 1);
    expect(nflWeekStartInstant(UNPUBLISHED, 1).toISOString()).toBe(
      new Date(`${iso}T20:20:00-04:00`).toISOString(),
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

describe('the fantasy bracket derives from the NFL season length', () => {
  it('puts the title game one week before the NFL regular season ends', () => {
    // The rule, stated by the commissioner: league championships are the week
    // before the final NFL regular-season week — that last week is when NFL
    // teams with nothing to play for rest their starters.
    expect(CHAMPIONSHIP_WEEK).toBe(FINAL_REGULAR_SEASON_WEEK - 1);
    expect(SEMIFINAL_WEEK).toBe(CHAMPIONSHIP_WEEK - 1);
    expect(PLAYOFFS_START_WEEK).toBe(CHAMPIONSHIP_WEEK - 2);
    expect(FINAL_FANTASY_REGULAR_SEASON_WEEK).toBe(PLAYOFFS_START_WEEK - 1);
  });

  it('resolves to the bracket both constitutions describe today', () => {
    // TheLeague: playoffs week 15, title week 17. The AFL: conference
    // semifinals 15, conference finals 16, World Championship 17, over a
    // 14-week regular season. An 18-week NFL season yields exactly that.
    expect(FINAL_REGULAR_SEASON_WEEK).toBe(18);
    expect(PLAYOFFS_START_WEEK).toBe(15);
    expect(SEMIFINAL_WEEK).toBe(16);
    expect(CHAMPIONSHIP_WEEK).toBe(17);
    expect(FINAL_FANTASY_REGULAR_SEASON_WEEK).toBe(14);
  });

  it('would reproduce the pre-2021 bracket from a 17-week NFL season', () => {
    // Not a hypothetical: the bracket shifted +1 when the NFL went to 18 weeks
    // in 2021 (QF moved 14→15, title 16→17) and had to be hand-corrected in
    // several files. Deriving it makes the next expansion one constant.
    const priorEra = 17;
    expect(priorEra - 1).toBe(16); // title game was week 16
    expect(priorEra - 3).toBe(14); // playoffs opened week 14
  });
});

describe('nflWeekFor — a week begins when the PREVIOUS one ends', () => {
  const at = (iso: string) => nflWeekFor(2026, new Date(`${iso}T20:00:00Z`));

  it('does not lag when the next week opens late', () => {
    // The regression this rule exists to prevent. 2026's week 18 is all-Sunday
    // (Jan 10), so anchoring purely on each week's first kickoff left Jan 5-9
    // reporting week 17 while MFL had already advanced — /live-scoring and the
    // lineup API would have defaulted a week behind.
    expect(at('2027-01-04')).toBe(17); // Monday — week 17 still running
    expect(at('2027-01-05')).toBe(18); // Tuesday — week 17 is over
    expect(at('2027-01-10')).toBe(18); // week 18's only game day
  });

  it('keeps Monday night inside its own week, after a Wednesday opener', () => {
    // Week 1 opened Wed Sep 9, so its Monday nighter is Sep 14 and the
    // rollover is Sep 15 — a +6 shift where a Thursday opener gives +5.
    expect(at('2026-09-14')).toBe(1);
    expect(at('2026-09-15')).toBe(2);
  });

  it('advances into a Wednesday week on the Tuesday before it', () => {
    // Week 12 moved to Thanksgiving Wednesday (Nov 25). Week 11 ended Mon
    // Nov 23, so Nov 24 is already week 12 even though no game has kicked off.
    expect(at('2026-11-23')).toBe(11);
    expect(at('2026-11-24')).toBe(12);
  });

  it('is 0 before the season and strides weekly through the playoffs', () => {
    expect(at('2026-09-08')).toBe(0); // day before the Wednesday opener
    expect(at('2027-01-12')).toBe(19); // wild card
    expect(at('2027-03-01')).toBe(22); // capped
  });
});
