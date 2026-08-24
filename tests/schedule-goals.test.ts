/**
 * The goal scorecard. These pin the properties the reveal page and Schefter's
 * column depend on — above all that every goal in force has a scorer, so
 * adding a goal cannot silently ship a season with a hole in its report.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error - .mjs helper shared with the node scripts
import { goalFactsFromSeason, scoreSeasonGoals, summariseGoals } from '../src/utils/schedule-goals.mjs';
// @ts-expect-error - .mjs helper shared with the node scripts
import { scheduleConstraints, upcomingConstraints } from '../src/utils/schedule-constraints.mjs';
import aflRelease from '../data/afl-fantasy/schedule-release/2026.json';
import theLeagueRelease from '../data/theleague/schedule-release/2026.json';

/** AFL 2026 as it was actually drawn: at the ceiling, none of it avoidable. */
const aflFacts = {
  season: 2026,
  crossConference: true,
  lastWeek: 14,
  games: 204,
  doubleheaders: [1, 2, 12],
  byeCount: (w: number) => ({ 5: 2, 6: 4, 7: 4, 8: 4, 9: 2, 10: 4, 11: 6, 13: 4, 14: 2 })[w] ?? 0,
  divisionGames: 120,
  byeFreeDivisionGames: 84,
  divisionGameCeiling: 84,
  divisionByeWeeks: [
    { week: 10, teamsOut: 4 },
    { week: 13, teamsOut: 4 },
    { week: 14, teamsOut: 2 },
  ],
  worstByeWeek: 11,
  finaleAllDivision: true,
  netByeSpread: 2,
  homeGames: { min: 8, max: 9 },
  minRematchGap: 8,
  lightByeWeekMax: 2,
  problems: [] as string[],
};

describe('scoreSeasonGoals', () => {
  it('scores every goal that was in force, and nothing that was not', () => {
    const { goals, notYetAdopted } = scoreSeasonGoals(aflFacts);
    const inForce = scheduleConstraints({ crossConference: true, season: 2026 });
    expect(goals.map((g: any) => g.key)).toEqual(inForce.map((c: any) => c.key));
    // Goals adopted for 2027 must not judge a 2026 draw. Derived rather than
    // named, so adopting another does not break this test.
    const upcoming = upcomingConstraints({ season: 2026 }).map((c: any) => c.key);
    expect(upcoming.length).toBeGreaterThan(0);
    for (const key of upcoming) expect(goals.some((g: any) => g.key === key), key).toBe(false);
    expect(notYetAdopted.map((n: any) => n.key).sort()).toEqual([...upcoming].sort());
    for (const n of notYetAdopted) expect(n.since).toBeGreaterThan(2026);
  });

  it('has a scorer for EVERY goal, including ones not yet in force', () => {
    // The real risk: a goal is adopted, its `since` passes, and the season it
    // first applies to throws at lock time because nobody wrote a scorer.
    for (const crossConference of [true, false]) {
      const future = { ...aflFacts, crossConference, season: 9999 };
      expect(() => scoreSeasonGoals(future), `crossConference=${crossConference}`).not.toThrow();
      const { goals } = scoreSeasonGoals(future);
      expect(goals).toHaveLength(scheduleConstraints({ crossConference }).length);
    }
  });

  it('calls the AFL’s forced bye-week division games MET, not a shortfall', () => {
    const { goals } = scoreSeasonGoals(aflFacts);
    const g = goals.find((x: any) => x.key === 'division-bye-free-ceiling')!;
    expect(g.status).toBe('met');
    expect(g.detail).toMatch(/36 of 120 division games \(30%\)/);
    expect(g.detail).toMatch(/forced by the format/);
  });

  it('calls The League’s bye-week division games a CHOICE, and scores it partial', () => {
    const { goals } = scoreSeasonGoals({
      ...aflFacts,
      crossConference: false,
      divisionGames: 48,
      byeFreeDivisionGames: 40,
      divisionGameCeiling: 48,
      divisionByeWeeks: [{ week: 14, teamsOut: 2 }],
    });
    const g = goals.find((x: any) => x.key === 'division-bye-free-ceiling')!;
    expect(g.status).toBe('partial');
    expect(g.detail).toMatch(/none forced/);
    expect(g.detail).toMatch(/all-division finish/);
  });

  it('blocks the top goal when a doubleheader lands on a bye week', () => {
    const { goals } = scoreSeasonGoals({ ...aflFacts, doubleheaders: [1, 2, 13] });
    const g = goals.find((x: any) => x.key === 'doubleheaders-off-byes')!;
    expect(g.status).toBe('blocked');
    expect(g.detail).toMatch(/Week 13/);
  });

  // Demoted from a hard rule to a goal below getting division games off byes,
  // so a short gap is a trade the league accepted, not a broken schedule.
  it('scores a short rematch gap partial, not blocked', () => {
    const { goals } = scoreSeasonGoals({ ...aflFacts, minRematchGap: 2 });
    const g = goals.find((x: any) => x.key === 'rematch-gap')!;
    expect(g.status).toBe('partial');
    expect(g.detail).toMatch(/traded away for a higher goal/);
  });

  it('blocks the doubleheader-split goal when no franchise gets one after Week 8', () => {
    const { goals } = scoreSeasonGoals({ ...aflFacts, doubleheaders: [1, 2, 3] });
    const g = goals.find((x: any) => x.key === 'doubleheader-split')!;
    expect(g.status).toBe('blocked');
    expect(g.detail).toMatch(/after Week 8/);
  });

  it('reports the after-Week-8 doubleheader count when the goal is met', () => {
    const g = scoreSeasonGoals(aflFacts).goals.find((x: any) => x.key === 'doubleheader-split')!;
    expect(g.status).toBe('met');
    expect(g.detail).toMatch(/1 after Week 8/);
  });

  it('scores the light-bye-week goal partial when the calendar runs out of light weeks', () => {
    const { goals } = scoreSeasonGoals({ ...aflFacts, season: 2027 });
    const g = goals.find((x: any) => x.key === 'light-bye-weeks')!;
    expect(g.status).toBe('partial');
    expect(g.detail).toMatch(/1 of 3/);
  });

  it('fails the spread goal on a season whose division race ends in September', () => {
    // The exact shape the colouring optimiser produced when told only to keep
    // division games off byes: everything in Weeks 1-4 and 12.
    const halves = Array.from({ length: 16 }, (_, i) => ({ franchise: `F${i}`, early: 6, late: 0 }));
    const { goals } = scoreSeasonGoals({ ...aflFacts, season: 2027, divisionHalves: halves });
    const g = goals.find((x: any) => x.key === 'division-spread')!;
    expect(g.status).toBe('blocked');
    expect(g.detail).toMatch(/over before the second half/);
  });

  it('meets the spread goal on an evenly split season', () => {
    const halves = Array.from({ length: 16 }, (_, i) => ({ franchise: `F${i}`, early: 3, late: 3 }));
    const { goals } = scoreSeasonGoals({ ...aflFacts, season: 2027, divisionHalves: halves });
    expect(goals.find((x: any) => x.key === 'division-spread')!.status).toBe('met');
  });
});

describe('goalFactsFromSeason', () => {
  const described = {
    games: 204,
    byeFreeDivisionGames: 84,
    netByeSpread: 2,
    homeGames: { min: 8, max: 9 },
    minRematchGap: 8,
    byWeek: [
      { week: 12, games: 24, divisionGames: 24, nflByes: 0, doubleheader: true },
      { week: 13, games: 12, divisionGames: 12, nflByes: 4, doubleheader: false },
      { week: 14, games: 12, divisionGames: 12, nflByes: 2, doubleheader: false },
      { week: 11, games: 12, divisionGames: 0, nflByes: 6, doubleheader: false },
    ],
  };

  it('reads the bye-week division rounds and the worst week off byWeek', () => {
    const f = goalFactsFromSeason({
      season: 2026,
      crossConference: true,
      lastWeek: 14,
      described,
      ceiling: { total: 120, ceiling: 84 },
      doubleheaders: [12],
      lightByeWeekMax: 2,
    });
    expect(f.divisionByeWeeks).toEqual([
      { week: 13, teamsOut: 4 },
      { week: 14, teamsOut: 2 },
    ]);
    // Week 11 has the most teams out but carries no division round — which is
    // the point of the preference that puts interdivision there.
    expect(f.worstByeWeek).toBe(11);
    expect(f.finaleAllDivision).toBe(true);
  });
});

describe('the committed 2026 reveals carry their scorecard', () => {
  for (const [name, rec] of [
    ['AFL', aflRelease as any],
    ['The League', theLeagueRelease as any],
  ] as const) {
    it(`${name} scores every in-force goal and defers the 2027 one`, () => {
      const cross = name === 'AFL';
      expect(rec.goals.map((g: any) => g.key)).toEqual(
        scheduleConstraints({ crossConference: cross, season: 2026 }).map((c: any) => c.key),
      );
      expect(rec.notYetAdopted).toEqual([{ key: 'light-bye-weeks', since: 2027 }]);
      // Nothing structural went wrong in a season that is being played.
      expect(rec.goals.filter((g: any) => g.status === 'blocked')).toEqual([]);
      expect(summariseGoals(rec.goals).met).toBeGreaterThan(0);
    });
  }
});
