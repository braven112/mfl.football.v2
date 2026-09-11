import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  doubleheaderWeeks,
  findNextGame,
  franchiseSchedule,
  opponentsByWeek,
  parseWeeklySchedule,
  summarizeSchedule,
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

  it('counts no tie in the record', () => {
    const summary = summarizeSchedule(franchiseSchedule(parseWeeklySchedule(unplayed), '0001'));
    expect(summary).toMatchObject({ wins: 0, losses: 0, ties: 0, played: 0 });
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

  it('counts both results and both scores', () => {
    const summary = summarizeSchedule(franchiseSchedule(weeks, '0001'));
    expect(summary).toMatchObject({ wins: 1, losses: 1, played: 2 });
    expect(summary.pointsFor).toBeCloseTo(230.75, 2);
  });

  it('reports both opponents in the grid cell', () => {
    const cell = opponentsByWeek(weeks).get('0001')?.get(1);
    expect(cell?.map((entry) => entry.opponentId)).toEqual(['0002', '0003']);
  });

  it('names the doubleheader week from the data, not a constant', () => {
    expect(doubleheaderWeeks(weeks)).toEqual([1]);
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

  it('gives franchise 0001 a full season whose record adds up', () => {
    const schedule = franchiseSchedule(weeks, '0001');
    const summary = summarizeSchedule(schedule);
    expect(summary.played).toBeGreaterThan(10);
    expect(summary.wins + summary.losses + summary.ties).toBe(summary.played);
    expect(summary.pointsFor).toBeGreaterThan(0);
  });
});
