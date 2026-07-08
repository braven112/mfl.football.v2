import { describe, it, expect } from 'vitest';
import {
  projectPlayerFinal,
  projectPlayerRemaining,
  projectTeamFinal,
  projectMatchup,
  winProbability,
  NFL_GAME_SECONDS,
} from '../src/utils/live-win-probability';

describe('projectPlayerFinal', () => {
  it('a finished player contributes exactly his live total', () => {
    expect(projectPlayerFinal({ live: 22.1, projected: 18, secondsRemaining: 0 })).toBe(22.1);
  });

  it('a not-started player contributes his full projection', () => {
    expect(
      projectPlayerFinal({ live: 0, projected: 15, secondsRemaining: NFL_GAME_SECONDS }),
    ).toBeCloseTo(15, 6);
  });

  it('a half-played player adds half his projection to his live total', () => {
    expect(
      projectPlayerFinal({ live: 8, projected: 16, secondsRemaining: NFL_GAME_SECONDS / 2 }),
    ).toBeCloseTo(16, 6);
  });

  it('clamps negative / overlong remaining seconds', () => {
    expect(projectPlayerFinal({ live: 5, projected: 10, secondsRemaining: -100 })).toBe(5);
    expect(
      projectPlayerFinal({ live: 0, projected: 10, secondsRemaining: NFL_GAME_SECONDS * 5 }),
    ).toBeCloseTo(10, 6);
  });
});

describe('projectPlayerRemaining', () => {
  it('is zero once the game is final', () => {
    expect(projectPlayerRemaining({ live: 30, projected: 20, secondsRemaining: 0 })).toBe(0);
  });
  it('is the full projection before kickoff', () => {
    expect(
      projectPlayerRemaining({ live: 0, projected: 12, secondsRemaining: NFL_GAME_SECONDS }),
    ).toBeCloseTo(12, 6);
  });
});

describe('winProbability boundaries', () => {
  it('is deterministic once nothing remains to be played', () => {
    expect(winProbability(120, 100, 0)).toBe(1);
    expect(winProbability(100, 120, 0)).toBe(0);
    expect(winProbability(110, 110, 0)).toBe(0.5);
  });

  it('is ~50% when projected finals are even with time left', () => {
    expect(winProbability(100, 100, 60)).toBeCloseTo(0.5, 6);
  });

  it('a large projected lead with little time left approaches certainty', () => {
    expect(winProbability(125, 100, 4)).toBeGreaterThan(0.95);
  });

  it('the same lead is less certain when lots of football remains', () => {
    const early = winProbability(112, 100, 120);
    const late = winProbability(112, 100, 8);
    expect(early).toBeLessThan(late);
    expect(early).toBeGreaterThan(0.5);
  });

  it('home and away probabilities are complementary', () => {
    const home = winProbability(108, 100, 40);
    const away = winProbability(100, 108, 40);
    expect(home + away).toBeCloseTo(1, 6);
  });
});

describe('projectMatchup', () => {
  const starter = (live: number, projected: number, secondsRemaining: number) => ({
    live,
    projected,
    secondsRemaining,
  });

  it('sums lineups and reports a final result when both are done', () => {
    const home = [starter(20, 18, 0), starter(15, 14, 0)];
    const away = [starter(10, 12, 0), starter(12, 11, 0)];
    const r = projectMatchup(home, away);
    expect(r.homeLive).toBe(35);
    expect(r.awayLive).toBe(22);
    expect(r.homeProjectedFinal).toBe(35);
    expect(r.awayProjectedFinal).toBe(22);
    expect(r.remainingPoints).toBe(0);
    expect(r.isFinal).toBe(true);
    expect(r.homeWinProbability).toBe(1);
  });

  it('projects mid-game finals and a non-trivial win probability', () => {
    const home = [starter(10, 20, NFL_GAME_SECONDS / 2)]; // proj final 20
    const away = [starter(9, 18, NFL_GAME_SECONDS / 2)]; // proj final 18
    const r = projectMatchup(home, away);
    expect(r.homeProjectedFinal).toBeCloseTo(20, 6);
    expect(r.awayProjectedFinal).toBeCloseTo(18, 6);
    expect(r.remainingPoints).toBeCloseTo(19, 6); // 10 + 9 remaining
    expect(r.isFinal).toBe(false);
    expect(r.homeWinProbability).toBeGreaterThan(0.5);
    expect(r.homeWinProbability).toBeLessThan(0.9);
  });

  it('empty lineups are a coin flip, not a crash', () => {
    const r = projectMatchup([], []);
    expect(r.homeProjectedFinal).toBe(0);
    expect(r.homeWinProbability).toBe(0.5);
    expect(r.isFinal).toBe(true);
  });
});
