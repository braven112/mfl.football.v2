import { describe, it, expect } from 'vitest';
import {
  getAflWhatsNextTimeline,
  getAllResolvedAflEvents,
} from '../src/utils/league-event-resolver';
import { getAflLeagueYear, getCurrentLeagueYear } from '../src/utils/league-year';

/**
 * The AFL's What's Next card and calendar must pick the league year on the
 * AFL's OWN clock — it rolls on June 1 (`leagueYearRollover` in the registry),
 * not on TheLeague's Feb 14. Between Feb 14 and May 31 the two clocks
 * disagree, and the AFL is still in the PREVIOUS league year.
 *
 * Both resolvers used to call `getCurrentLeagueYear`, which is TheLeague's
 * clock, so for three and a half months a year the AFL resolved as if its
 * new league year had already begun.
 */

// Noon local time keeps every date clear of the midnight-PT rollover cutoffs.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

const CASES: Array<{ label: string; date: Date; aflYear: number }> = [
  { label: '2027-02-10 (before both rollovers)', date: at(2027, 2, 10), aflYear: 2026 },
  { label: '2027-02-15 (just past TheLeague\'s Feb 14)', date: at(2027, 2, 15), aflYear: 2026 },
  { label: '2027-03-10 (between the two rollovers)', date: at(2027, 3, 10), aflYear: 2026 },
  { label: '2027-05-31 (last day before the AFL rolls)', date: at(2027, 5, 31), aflYear: 2026 },
  { label: '2027-06-15 (after both rollovers)', date: at(2027, 6, 15), aflYear: 2027 },
];

describe('AFL events resolve on the AFL league-year clock (June 1), not TheLeague\'s (Feb 14)', () => {
  it('the window under test really is one where the two clocks disagree', () => {
    expect(getCurrentLeagueYear(at(2027, 3, 10))).toBe(2027);
    expect(getAflLeagueYear(at(2027, 3, 10))).toBe(2026);
  });

  for (const { label, date, aflYear } of CASES) {
    describe(label, () => {
      it(`getAflWhatsNextTimeline reports league year ${aflYear}`, () => {
        const timeline = getAflWhatsNextTimeline(date);
        expect(timeline.leagueYear).toBe(aflYear);
        expect(timeline.leagueYear).toBe(getAflLeagueYear(date));
      });

      it(`getAllResolvedAflEvents defaults to league year ${aflYear}`, () => {
        const events = getAllResolvedAflEvents({ referenceDate: date });
        const newSeason = events.find((e) => e.definition.id === 'afl-new-season-starts');
        expect(newSeason, 'afl-new-season-starts missing').toBeDefined();
        // "New Season Starts" is fixed on June 1 of the league year it opens.
        expect(newSeason!.startDate.getFullYear()).toBe(aflYear);
        expect(newSeason!.startDate.getMonth()).toBe(5);
        expect(newSeason!.startDate.getDate()).toBe(1);
      });
    });
  }

  it('an explicit leagueYear still wins over the clock', () => {
    const events = getAllResolvedAflEvents({ leagueYear: 2030, referenceDate: at(2027, 3, 10) });
    const newSeason = events.find((e) => e.definition.id === 'afl-new-season-starts');
    expect(newSeason!.startDate.getFullYear()).toBe(2030);
  });

  it('between the rollovers the timeline still leads with the upcoming June 1 rollover', () => {
    const timeline = getAflWhatsNextTimeline(at(2027, 3, 10));
    expect(timeline.current?.definition.id).toBe('afl-new-season-starts');
    expect(timeline.current?.startDate.getFullYear()).toBe(2027);
  });
});
