import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { buildPairings, rollingRecord } from '../scripts/generate-pecking-order.mjs';

/**
 * The Pecking Order's "last 3" record is windowed by WEEKS, not games, so it
 * describes the same stretch as the rolling-3-week PPG printed next to it on
 * the card.
 *
 * That distinction only bites in the AFL, which plays double-header weeks: the
 * feed lists each franchise twice in one week against two different opponents,
 * with the SAME weekly score counted in both games. A last-3-GAMES window there
 * covers about a week and a half. TheLeague plays once a week, where the two
 * definitions are identical — which is what makes this easy to get wrong and
 * impossible to notice on one side of the site.
 */

/** weekly-results-raw shape: [{ weeklyResults: { week, matchup: [{ franchise: [...] }] } }] */
const raw = (weeks: Record<number, [string, string][]>) =>
  Object.entries(weeks).map(([week, games]) => ({
    weeklyResults: {
      week: String(week),
      matchup: games.map(([home, away]) => ({
        franchise: [
          { id: home, isHome: '1' },
          { id: away, isHome: '0' },
        ],
      })),
    },
  }));

/** weekly-results shape: one score per franchise per week. */
const results = (weeks: Record<number, Record<string, number>>) => ({
  weeks: Object.entries(weeks).map(([week, scores]) => ({ week: String(week), scores })),
});

describe('buildPairings', () => {
  it('reads pairings from weekly-results-raw when there is no schedule.json', () => {
    const pairings = buildPairings(null, raw({ 1: [['0001', '0002']] }));
    expect(pairings.get(1)).toEqual([
      [
        { id: '0001', isHome: '1' },
        { id: '0002', isHome: '0' },
      ],
    ]);
  });

  it('keeps forward-looking weeks that only schedule.json has', () => {
    const schedule = {
      schedule: {
        weeklySchedule: [
          { week: '2', matchup: [{ franchise: [{ id: '0001', isHome: '1' }, { id: '0003', isHome: '0' }] }] },
        ],
      },
    };
    const pairings = buildPairings(schedule, raw({ 1: [['0001', '0002']] }));
    expect([...pairings.keys()].sort()).toEqual([1, 2]);
  });

  it('lets schedule.json win for a week both sources carry', () => {
    const schedule = {
      schedule: {
        weeklySchedule: [
          { week: '1', matchup: [{ franchise: [{ id: '0001', isHome: '1' }, { id: '0009', isHome: '0' }] }] },
        ],
      },
    };
    const pairings = buildPairings(schedule, raw({ 1: [['0001', '0002']] }));
    expect(pairings.get(1)![0][1].id).toBe('0009');
  });

  it('drops malformed matchups rather than half-counting them', () => {
    const pairings = buildPairings(null, [
      { weeklyResults: { week: '1', matchup: [{ franchise: [{ id: '0001', isHome: '1' }] }] } },
    ]);
    expect(pairings.has(1)).toBe(false);
  });
});

describe('rollingRecord — one game per week (TheLeague)', () => {
  const pairings = buildPairings(
    null,
    raw({ 1: [['0001', '0002']], 2: [['0001', '0003']], 3: [['0001', '0004']], 4: [['0001', '0005']] }),
  );
  const scores = results({
    1: { '0001': 100, '0002': 90 },   // W
    2: { '0001': 80, '0003': 95 },    // L
    3: { '0001': 120, '0004': 110 },  // W
    4: { '0001': 130, '0005': 100 },  // W
  });

  it('counts exactly three games over the last three weeks', () => {
    expect(rollingRecord(pairings, scores, '0001', 4, 3)).toEqual({
      wins: 2, losses: 1, ties: 0, gamesCounted: 3,
    });
  });

  it('honors throughWeek — later weeks never leak into an earlier issue', () => {
    expect(rollingRecord(pairings, scores, '0001', 2, 3)).toEqual({
      wins: 1, losses: 1, ties: 0, gamesCounted: 2,
    });
  });
});

describe('rollingRecord — double-header weeks (AFL)', () => {
  // Week 1 is a double-header: 0001 plays 0002 AND 0003, scoring 100 in both.
  const pairings = buildPairings(
    null,
    raw({
      1: [['0001', '0002'], ['0001', '0003']],
      2: [['0001', '0004']],
      3: [['0001', '0005']],
      4: [['0001', '0006']],
    }),
  );
  const scores = results({
    1: { '0001': 100, '0002': 90, '0003': 110 },  // W and L on the same score
    2: { '0001': 80, '0004': 95 },                // L
    3: { '0001': 120, '0005': 110 },              // W
    4: { '0001': 130, '0006': 100 },              // W
  });

  it('counts every game played inside the three-week window', () => {
    // Weeks 2-4: L, W, W — three weeks, three games, no double-header inside.
    expect(rollingRecord(pairings, scores, '0001', 4, 3)).toEqual({
      wins: 2, losses: 1, ties: 0, gamesCounted: 3,
    });
    // Weeks 1-3 include the double-header: W+L, L, W = four games in three weeks.
    expect(rollingRecord(pairings, scores, '0001', 3, 3)).toEqual({
      wins: 2, losses: 2, ties: 0, gamesCounted: 4,
    });
  });

  it('never lets a double-header shrink the window to fewer weeks', () => {
    // A last-3-GAMES window through week 2 would stop inside week 1 and report
    // three games; the week window keeps both halves of the double-header.
    const record = rollingRecord(pairings, scores, '0001', 2, 3);
    expect(record.gamesCounted).toBe(3);
    expect(record).toEqual({ wins: 1, losses: 2, ties: 0, gamesCounted: 3 });
  });
});

describe('rollingRecord — gaps and edges', () => {
  it('skips byes: the window is the last N weeks the team actually played', () => {
    // 0001 is idle in week 3; the 3-week window reaches back to week 1.
    const pairings = buildPairings(
      null,
      raw({ 1: [['0001', '0002']], 2: [['0001', '0003']], 3: [['0004', '0005']], 4: [['0001', '0006']] }),
    );
    const scores = results({
      1: { '0001': 100, '0002': 90 },
      2: { '0001': 80, '0003': 95 },
      3: { '0004': 100, '0005': 90 },
      4: { '0001': 130, '0006': 100 },
    });
    expect(rollingRecord(pairings, scores, '0001', 4, 3)).toEqual({
      wins: 2, losses: 1, ties: 0, gamesCounted: 3,
    });
  });

  it('ignores weeks with no scores on file instead of counting them as losses', () => {
    const pairings = buildPairings(null, raw({ 1: [['0001', '0002']], 2: [['0001', '0003']] }));
    const scores = results({ 1: { '0001': 100, '0002': 90 } });
    expect(rollingRecord(pairings, scores, '0001', 2, 3)).toEqual({
      wins: 1, losses: 0, ties: 0, gamesCounted: 1,
    });
  });

  it('counts a tie as a tie', () => {
    const pairings = buildPairings(null, raw({ 1: [['0001', '0002']] }));
    const scores = results({ 1: { '0001': 100, '0002': 100 } });
    expect(rollingRecord(pairings, scores, '0001', 1, 3)).toEqual({
      wins: 0, losses: 0, ties: 1, gamesCounted: 1,
    });
  });

  it('returns an empty record for a franchise with no games', () => {
    const pairings = buildPairings(null, raw({ 1: [['0002', '0003']] }));
    const scores = results({ 1: { '0002': 100, '0003': 90 } });
    expect(rollingRecord(pairings, scores, '0001', 1, 3)).toEqual({
      wins: 0, losses: 0, ties: 0, gamesCounted: 0,
    });
  });
});
