/**
 * Guard tests for the MFL weeklyResults fold
 * (`src/utils/roster-weekly-scores.ts`), extracted from rosters.astro's
 * frontmatter where it was untyped and untested.
 *
 * MFL returns a single child as an object and several as an array at every
 * level of that feed, so each of these cases is a shape the real feed produces
 * and a way a week of scores can silently vanish from the trend columns.
 */
import { describe, it, expect } from 'vitest';
import { processWeeklyScores } from '../src/utils/roster-weekly-scores';

describe('processWeeklyScores', () => {
  const week = (n: number, players: Array<{ id: string; score: string }>) => ({
    weeklyResults: {
      week: String(n),
      matchup: { franchise: { player: players } },
    },
  });

  it('indexes scores by player then week', () => {
    const scores = processWeeklyScores([
      week(1, [{ id: '13593', score: '22.4' }]),
      week(2, [{ id: '13593', score: '9.1' }]),
    ]);
    expect(scores.get('13593')).toEqual({ 1: 22.4, 2: 9.1 });
  });

  it('accepts a single week object as well as an array', () => {
    // MFL collapses a one-element list into a bare object at every level.
    const single = processWeeklyScores(week(1, [{ id: '13593', score: '22.4' }]));
    expect(single.get('13593')).toEqual({ 1: 22.4 });
  });

  it('accepts a single matchup, franchise, and player as bare objects', () => {
    const scores = processWeeklyScores([
      {
        weeklyResults: {
          week: '3',
          matchup: { franchise: { player: { id: '99', score: '12.5' } } },
        },
      },
    ]);
    expect(scores.get('99')).toEqual({ 3: 12.5 });
  });

  it('reads every franchise in every matchup', () => {
    const scores = processWeeklyScores([
      {
        weeklyResults: {
          week: '4',
          matchup: [
            { franchise: [{ player: [{ id: 'a', score: '1' }] }, { player: [{ id: 'b', score: '2' }] }] },
            { franchise: [{ player: [{ id: 'c', score: '3' }] }] },
          ],
        },
      },
    ]);
    expect([...scores.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips non-numeric scores rather than storing them as zero', () => {
    // A player who did not play comes back with score ''. Storing 0 would
    // render a real zero-point week in the trend column.
    const scores = processWeeklyScores([
      week(5, [{ id: 'x', score: '' }, { id: 'y', score: '0' }]),
    ]);
    expect(scores.get('x')).toEqual({});
    expect(scores.get('y')).toEqual({ 5: 0 });
  });

  it('returns an empty map for null, undefined, and an unrecognised shape', () => {
    expect(processWeeklyScores(null).size).toBe(0);
    expect(processWeeklyScores(undefined).size).toBe(0);
    expect(processWeeklyScores({} as never).size).toBe(0);
  });
});
