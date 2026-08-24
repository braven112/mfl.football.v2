import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildPairings, rollingRecord } from '../scripts/generate-pecking-order.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * The Pecking Order's "last 3" record is windowed by WEEKS, not games, so it
 * describes the same stretch as the rolling-3-week PPG printed next to it on
 * the card.
 *
 * The distinction only shows up in double-header weeks, where the feed lists a
 * franchise twice against two different opponents with the SAME weekly score
 * counted in both games. BOTH leagues play them — the AFL in 2025 weeks 1, 2
 * and 13, TheLeague in weeks 1, 2, 3 and 13 — so a last-3-GAMES window drops a
 * real game from the stretch the PPG beside it averages, in either league.
 * Easy to miss because it only bites when the window reaches into one of those
 * weeks, which for most teams it doesn't.
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

  /**
   * MFL collapses a one-element list to a bare object. A week with a single
   * matchup therefore arrives as `matchup: {...}` rather than `[{...}]`, which
   * crashed the generator outright on AFL 2012 week 13 — a committed feed, so
   * any backfill run hit it.
   */
  it('accepts a singleton matchup object, not just an array', () => {
    const pairings = buildPairings(null, [
      {
        weeklyResults: {
          week: '13',
          matchup: { franchise: [{ id: '0001', isHome: '1' }, { id: '0002', isHome: '0' }] },
        },
      },
    ]);
    expect(pairings.get(13)).toHaveLength(1);
    expect(pairings.get(13)![0].map((f: any) => f.id)).toEqual(['0001', '0002']);
  });

  it('accepts a singleton franchise object inside a matchup', () => {
    // Half a game is still not a game — it must be dropped, not throw.
    const pairings = buildPairings(null, [
      { weeklyResults: { week: '1', matchup: { franchise: { id: '0001', isHome: '1' } } } },
    ]);
    expect(pairings.has(1)).toBe(false);
  });

  it('accepts a singleton weeklySchedule entry from schedule.json', () => {
    const schedule = {
      schedule: {
        weeklySchedule: {
          week: '15',
          matchup: { franchise: [{ id: '0001', isHome: '1' }, { id: '0002', isHome: '0' }] },
        },
      },
    };
    expect(buildPairings(schedule, null).get(15)).toHaveLength(1);
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

/**
 * Pinned against the real committed feeds, because the interesting cases are
 * ones no hand-built fixture would think to include.
 *
 * BOTH leagues play double-header weeks — TheLeague in 2025 weeks 1, 2, 3 and
 * 13, the AFL in weeks 1, 2 and 13 — which is the fact that makes the week
 * window the right one everywhere rather than an AFL special case. The old
 * last-3-GAMES window dropped a real game whenever the window reached into one
 * of those weeks, and the PPG printed beside the record still counted it.
 */
const ROOT = path.resolve(__dirname, '..');
const feed = (slug: 'theleague' | 'afl-fantasy', year: number, file: string) =>
  JSON.parse(
    readFileSync(path.join(ROOT, (LEAGUES as any)[slug].dataPath, 'mfl-feeds', String(year), file), 'utf8'),
  );

describe('rollingRecord — pinned to the committed 2025 feeds', () => {
  it('counts both halves of a double-header the window reaches back into (TheLeague)', () => {
    const pairings = buildPairings(null, feed('theleague', 2025, 'weekly-results-raw.json'));
    const scores = feed('theleague', 2025, 'weekly-results.json');

    // 0009 and 0007 are idle in week 15, so their last three PLAYED weeks
    // through 16 are 13, 14 and 16 — and week 13 is a double-header. Four
    // games in three weeks, which is what the L3 PPG beside it averages.
    expect(rollingRecord(pairings, scores, '0009', 16, 3)).toEqual({
      wins: 2, losses: 2, ties: 0, gamesCounted: 4,
    });
    expect(rollingRecord(pairings, scores, '0007', 16, 3)).toEqual({
      wins: 1, losses: 3, ties: 0, gamesCounted: 4,
    });

    // A team that played all of 14/15/16 sees no change from the old behavior.
    expect(rollingRecord(pairings, scores, '0015', 16, 3).gamesCounted).toBe(3);
  });

  it('counts a double-header week in the AFL the same way', () => {
    const pairings = buildPairings(null, feed('afl-fantasy', 2025, 'weekly-results-raw.json'));
    const scores = feed('afl-fantasy', 2025, 'weekly-results.json');

    // Week 13 is a double-header, so weeks 11-13 hold four games.
    const record = rollingRecord(pairings, scores, '0015', 13, 3);
    expect(record.gamesCounted).toBe(4);
    expect(record.wins + record.losses + record.ties).toBe(4);
  });

  it('survives the singleton-matchup week in the committed AFL 2012 feed', () => {
    // This feed is why asArray() exists — it crashed buildPairings outright.
    const pairings = buildPairings(null, feed('afl-fantasy', 2012, 'weekly-results-raw.json'));
    expect(pairings.size).toBeGreaterThan(0);
  });
});
