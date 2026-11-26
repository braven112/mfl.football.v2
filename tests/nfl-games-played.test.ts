import { describe, expect, it } from 'vitest';
import { gamesDivisor, gamesPlayedByTeam } from '../scripts/lib/nfl-games-played.mjs';
import { transformPointsAllowed } from '../scripts/fetch-fantasy-points-allowed.mjs';

const game = (a: string, b: string, final = true) => ({
  gameSecondsRemaining: final ? '0' : '3600',
  team: [
    { id: a, score: final ? '10' : '' },
    { id: b, score: final ? '13' : '' },
  ],
});

// KCC plays weeks 1 and 3 (bye in week 2); BUF plays 1 and 2; week 3's BUF game is not final.
const schedule = {
  fullNflSchedule: {
    nflSchedule: [
      { week: '1', matchup: [game('KCC', 'BUF')] },
      { week: '2', matchup: [game('BUF', 'MIA')] },
      { week: '3', matchup: [game('KCC', 'MIA'), game('BUF', 'NYJ', false)] },
    ],
  },
};

describe('games played for points allowed', () => {
  it('counts only final games, so a bye is not a game', () => {
    expect(gamesPlayedByTeam(schedule)).toEqual({ KCC: 2, BUF: 2, MIA: 2 });
  });

  it('falls back to completed weeks for a team the schedule does not know', () => {
    expect(gamesDivisor({ KCC: 2 }, 'KCC', 3)).toBe(2);
    expect(gamesDivisor({ KCC: 2 }, 'NYJ', 3)).toBe(3);
    expect(gamesDivisor(null, 'KCC', 0)).toBe(1);
  });

  it('averages each defense over its own games, keyed by the standard code', () => {
    const mfl = {
      pointsAllowed: {
        team: [
          { id: 'KCC', position: [{ name: 'RB', points: '40' }] },
          { id: 'BUF', position: [{ name: 'RB', points: '45' }] },
        ],
      },
    };
    const out = transformPointsAllowed(mfl, 3, { KCC: 2, BUF: 3 });
    // By weeks, KC would be 13.3 and look tougher than BUF; by games it is softer.
    expect(out.KC.RB).toEqual({ avg: 20, rank: 2 });
    expect(out.BUF.RB).toEqual({ avg: 15, rank: 1 });
  });
});
