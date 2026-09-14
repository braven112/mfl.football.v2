import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findNextGame,
  franchiseSchedule,
  opponentsByWeek,
  parseWeeklySchedule,
} from '../src/utils/schedule-data.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = join(__dirname, '..');

function feedFor(slug: string, year: number) {
  return JSON.parse(
    readFileSync(join(ROOT, 'data', slug, 'mfl-feeds', String(year), 'schedule.json'), 'utf8'),
  );
}

/**
 * The whole reason this module exists. MFL stamps `result: "T"` on a matchup
 * that has not kicked off yet, so anything reading `result` without checking
 * for a score reports the rest of the season as ties.
 */
describe('an unplayed game is not a tie', () => {
  const unplayed = {
    schedule: {
      weeklySchedule: [
        {
          week: '5',
          matchup: [
            {
              franchise: [
                { id: '0001', isHome: '1', result: 'T', spread: '0' },
                { id: '0002', isHome: '0', result: 'T', spread: '0' },
              ],
            },
          ],
        },
      ],
    },
  };

  it('marks it unplayed and leaves the outcome null', () => {
    const [{ games }] = franchiseSchedule(parseWeeklySchedule(unplayed), '0001');
    expect(games).toHaveLength(1);
    expect(games[0].played).toBe(false);
    expect(games[0].outcome).toBeNull();
  });

  it('is still the next game to play', () => {
    const next = findNextGame(franchiseSchedule(parseWeeklySchedule(unplayed), '0001'), 1);
    expect(next).toMatchObject({ week: 5, played: false });
  });
});

describe('doubleheaders stay plural', () => {
  const doubleheader = {
    schedule: {
      weeklySchedule: [
        {
          week: '1',
          matchup: [
            {
              franchise: [
                { id: '0001', isHome: '1', result: 'W', score: '120.5' },
                { id: '0002', isHome: '0', result: 'L', score: '99.0' },
              ],
            },
            {
              franchise: [
                { id: '0003', isHome: '1', result: 'W', score: '130.0' },
                { id: '0001', isHome: '0', result: 'L', score: '110.25' },
              ],
            },
          ],
        },
      ],
    },
  };
  const weeks = parseWeeklySchedule(doubleheader);

  it('returns both of a franchise’s games for the week', () => {
    const schedule = franchiseSchedule(weeks, '0001');
    expect(schedule).toHaveLength(1);
    expect(schedule[0].games.map((g) => g.opponentId)).toEqual(['0002', '0003']);
  });

  it('keeps both outcomes and both scores', () => {
    const [{ games }] = franchiseSchedule(weeks, '0001');
    expect(games.map((g: any) => g.outcome)).toEqual(['W', 'L']);
    expect(games.map((g: any) => g.score)).toEqual([120.5, 110.25]);
  });

  it('reports both opponents in the grid cell', () => {
    const cell = opponentsByWeek(weeks).get('0001')?.get(1);
    expect(cell?.map((entry) => entry.opponentId)).toEqual(['0002', '0003']);
  });

  it('reports the week once, with both games under it', () => {
    expect(weeks.map((w: any) => w.week)).toEqual([1]);
    expect(franchiseSchedule(weeks, '0001')[0].games).toHaveLength(2);
  });
});

describe('findNextGame', () => {
  const weeks = parseWeeklySchedule({
    schedule: {
      weeklySchedule: [
        {
          week: '1',
          matchup: {
            franchise: [
              { id: '0001', isHome: '1', result: 'W', score: '120.5' },
              { id: '0002', isHome: '0', result: 'L', score: '99.0' },
            ],
          },
        },
        {
          week: '2',
          matchup: {
            franchise: [
              { id: '0001', isHome: '0', result: 'T' },
              { id: '0003', isHome: '1', result: 'T' },
            ],
          },
        },
      ],
    },
  });

  it('skips played weeks and returns the first pending game', () => {
    const next = findNextGame(franchiseSchedule(weeks, '0001'), 1);
    expect(next).toMatchObject({ week: 2, opponentId: '0003', played: false });
  });

  it('returns null once nothing is left', () => {
    expect(findNextGame(franchiseSchedule(weeks, '0001'), 3)).toBeNull();
  });

  it('accepts MFL’s single-object matchup shape', () => {
    expect(weeks[0].matchups).toHaveLength(1);
  });
});

describe.each(['theleague', 'afl-fantasy'])('the committed %s feed parses', (slug) => {
  const league = LEAGUES[slug as keyof typeof LEAGUES];
  const year = 2025; // a completed season, so the played branch is exercised
  const weeks = parseWeeklySchedule(feedFor(league.dataPath.replace('data/', ''), year));

  it('has ascending weeks, each with two franchises per matchup', () => {
    expect(weeks.length).toBeGreaterThan(10);
    expect(weeks.map((w) => w.week)).toEqual([...weeks.map((w) => w.week)].sort((a, b) => a - b));
    for (const { matchups } of weeks) {
      expect(matchups.length).toBeGreaterThan(0);
      for (const matchup of matchups) expect(matchup.franchises).toHaveLength(2);
    }
  });

  it('gives franchise 0001 a full season of played games with outcomes', () => {
    const games = franchiseSchedule(weeks, '0001').flatMap((entry: any) => entry.games);
    const played = games.filter((g: any) => g.played);
    expect(played.length).toBeGreaterThan(10);
    for (const game of played) {
      expect(['W', 'L', 'T']).toContain(game.outcome);
      expect(game.score).toBeGreaterThan(0);
    }
  });
});

/**
 * MFL creates the playoff weeks before it draws them: the live 2026 feeds
 * carry `{"week":"15"}` with no `matchup` for TheLeague 15-17 and the AFL
 * 15-18. Rendering those weeks puts a column in the grid where every club
 * shows the bye dash, which reads as a real bye.
 */
describe('a week with no matchups is not a scheduled week', () => {
  it('drops the undrawn week', () => {
    const weeks = parseWeeklySchedule({
      schedule: {
        weeklySchedule: [
          {
            week: '14',
            matchup: {
              franchise: [
                { id: '0001', isHome: '1', result: 'T' },
                { id: '0002', isHome: '0', result: 'T' },
              ],
            },
          },
          { week: '15' },
        ],
      },
    });
    expect(weeks.map((w) => w.week)).toEqual([14]);
  });

  it('drops them in the committed 2026 feeds too', () => {
    for (const slug of ['theleague', 'afl-fantasy']) {
      const weeks = parseWeeklySchedule(feedFor(slug, 2026));
      expect(weeks.every((w) => w.matchups.length > 0)).toBe(true);
      expect(weeks.some((w) => w.week >= 15)).toBe(false);
    }
  });
});

describe('a played game MFL left unlabelled falls back to the score', () => {
  it('resolves W/L from the scores when result is missing', () => {
    const weeks = parseWeeklySchedule({
      schedule: {
        weeklySchedule: [
          {
            week: '3',
            matchup: {
              franchise: [
                { id: '0001', isHome: '1', score: '101.0' },
                { id: '0002', isHome: '0', score: '99.5' },
              ],
            },
          },
        ],
      },
    });
    expect(franchiseSchedule(weeks, '0001')[0].games[0].outcome).toBe('W');
    expect(franchiseSchedule(weeks, '0002')[0].games[0].outcome).toBe('L');
  });
});

/**
 * The league grid prints the final score inside each cell, and a cell belongs
 * to a ROW — so `score` must be that row's club, not whichever side MFL
 * happened to list first. Printing the pair the wrong way round shows every
 * club its opponent's score as its own, which reads as plausible right up
 * until someone checks a game they remember.
 */
describe('opponentsByWeek carries the score from the row club\'s side', () => {
  const weeks = parseWeeklySchedule({
    schedule: {
      weeklySchedule: [
        {
          week: '1',
          matchup: {
            // 0002 is listed FIRST here on purpose.
            franchise: [
              { id: '0002', isHome: '1', result: 'L', score: '99.0' },
              { id: '0001', isHome: '0', result: 'W', score: '120.5' },
            ],
          },
        },
        {
          week: '2',
          matchup: { franchise: [{ id: '0001', isHome: '1' }, { id: '0002', isHome: '0' }] },
        },
      ],
    },
  });
  const grid = opponentsByWeek(weeks);

  it('gives each club its own score, not the first-listed one', () => {
    expect(grid.get('0001')?.get(1)?.[0]).toMatchObject({ score: 120.5, opponentScore: 99.0, outcome: 'W' });
    expect(grid.get('0002')?.get(1)?.[0]).toMatchObject({ score: 99.0, opponentScore: 120.5, outcome: 'L' });
  });

  it('leaves both scores null for a game that has not been played', () => {
    expect(grid.get('0001')?.get(2)?.[0]).toMatchObject({
      played: false,
      score: null,
      opponentScore: null,
      outcome: null,
    });
  });

  /**
   * MFL publishes a half-filled matchup mid-scoring. `played` is already false
   * for one, but passing the one score it DOES carry through would let a grid
   * cell print a partial result as a final score.
   */
  it('hides the one score a half-filled matchup carries', () => {
    const half = parseWeeklySchedule({
      schedule: {
        weeklySchedule: [
          {
            week: '1',
            matchup: {
              franchise: [
                { id: '0001', isHome: '1', result: 'T', score: '61.4' },
                { id: '0002', isHome: '0', result: 'T' },
              ],
            },
          },
        ],
      },
    });
    const cell = opponentsByWeek(half);
    expect(cell.get('0001')?.get(1)?.[0]).toMatchObject({
      played: false,
      score: null,
      opponentScore: null,
      outcome: null,
    });
    expect(cell.get('0002')?.get(1)?.[0]).toMatchObject({ played: false, score: null, opponentScore: null });
  });
});
