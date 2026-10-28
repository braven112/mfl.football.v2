import { describe, it, expect } from 'vitest';
import {
  allPlayWeek,
  addGame,
  emptyRecord,
  formatRecord,
  hasResult,
  isForfeit,
  scoreResult,
  sideResult,
  weekEntries,
  weekGames,
  winPct,
} from '../src/utils/game-results.mjs';

/** The site's one definition of a game result (src/utils/game-results.mjs). */
const side = (id: string, score?: string, result?: string) => ({ id, ...(score != null ? { score } : {}), ...(result ? { result } : {}) });

describe('game results', () => {
  it('a game has a result once both scores are posted and not 0-0', () => {
    expect(hasResult(side('a', '101.5'), side('b', '99'))).toBe(true);
    // A forfeit: one side set no lineup. Still a game.
    expect(hasResult(side('a', '0.00'), side('b', '88'))).toBe(true);
    expect(isForfeit(0, 88)).toBe(true);
    expect(isForfeit(90, 88)).toBe(false);
    // MFL stamps an unplayed week "T" with no score: not a game.
    expect(hasResult(side('a', undefined, 'T'), side('b', undefined, 'T'))).toBe(false);
    expect(hasResult(side('a', '0'), side('b', '0'))).toBe(false);
  });

  it("MFL's recorded result wins over the scores", () => {
    // AFL 2005 week 17: 76.92 each, MFL broke the tie.
    expect(sideResult(side('a', '76.92', 'W'), side('b', '76.92', 'L'))).toBe('W');
    expect(sideResult(side('b', '76.92', 'L'), side('a', '76.92', 'W'))).toBe('L');
    expect(sideResult(side('a', '80'), side('b', '76'))).toBe('W');
    expect(sideResult(side('a', '76'), side('b', '76'))).toBe('T');
  });

  it('scoreResult is null for a missing or 0-0 pairing', () => {
    expect(scoreResult(100, 90)).toBe('W');
    expect(scoreResult(0, 90)).toBe('L');
    expect(scoreResult(0, 0)).toBeNull();
    expect(scoreResult(null, 90)).toBeNull();
  });

  it('weekGames keeps played pairs only and reads both sides', () => {
    const games = weekGames({
      week: '3',
      matchup: [
        { regularSeason: '1', franchise: [side('a', '110', 'W'), side('b', '90', 'L')] },
        { franchise: [side('c', undefined, 'T'), side('d', undefined, 'T')] },
        { franchise: [side('e', '100'), side('e', '100')] },
        { franchise: side('f', '50') },
      ],
    });
    expect(games).toEqual([{ week: 3, a: 'a', b: 'b', sa: 110, sb: 90, ra: 'W', rb: 'L', regularSeason: true }]);
  });

  it('weekEntries reads schedules and weekly-results exports, oldest first', () => {
    const wk = (week: string) => ({ week, matchup: [] });
    expect(weekEntries({ schedule: { weeklySchedule: [wk('2'), wk('1')] } }).map((w: { week: string }) => w.week)).toEqual(['1', '2']);
    expect(weekEntries([{ weeklyResults: wk('5') }, { weeklyResults: wk('4') }]).map((w: { week: string }) => w.week)).toEqual(['4', '5']);
    expect(weekEntries(null)).toEqual([]);
  });

  it('records count a tie as half a win', () => {
    const rec = emptyRecord();
    addGame(rec, 100, 90);
    addGame(rec, 80, 80);
    addGame(rec, 76.92, 76.92, 'L');
    expect(formatRecord(rec)).toBe('1-1-1');
    expect(winPct(rec)).toBeCloseTo(0.5);
    expect(winPct(emptyRecord())).toBeNull();
  });

  it('all-play compares every score that week, and an all-zero week is unplayed', () => {
    const ap = allPlayWeek({ a: 100, b: 90, c: 90, d: 0 });
    expect(ap.get('a')).toEqual({ wins: 3, losses: 0, ties: 0 });
    expect(ap.get('b')).toEqual({ wins: 1, losses: 1, ties: 1 });
    expect(ap.get('d')).toEqual({ wins: 0, losses: 3, ties: 0 });
    expect(allPlayWeek({ a: 0, b: 0 }).size).toBe(0);
  });
});
