/**
 * Who the "Your veteran extension" card shows (Brandon, 2026-11-14):
 * likely = under $3M AND ever top 10 at the position; under $3M OR top 10
 * goes behind "Show all"; neither never shows. Lowest salary first.
 */
import { describe, it, expect } from 'vitest';
import { buildVeteranExtensionBoard } from '../src/utils/veteran-extension-board';
import { computeBestFinishes } from '../src/utils/position-finishes';

const averages = { positions: { WR: { top5Average: 8_000_000 } } };
const p = (id: string, salary: number) => ({
  id, name: `P${id}`, position: 'WR', nflTeam: 'KC', headshot: '', salary, contractYears: 3, contractInfo: '',
});
const top = (rank: number) => ({ rank, year: 2024, position: 'WR' });

describe('buildVeteranExtensionBoard display rules', () => {
  const board = buildVeteranExtensionBoard({
    players: [p('cheapTop', 2_000_000), p('cheapOnly', 1_000_000), p('richTop', 6_000_000), p('richOnly', 5_000_000), p('cheapTop2', 500_000)],
    leagueYear: 2026,
    salaryAverages: averages,
    bestFinishes: new Map([['cheapTop', top(4)], ['richTop', top(10)], ['cheapTop2', top(1)], ['cheapOnly', top(11)]]),
  });
  const ids = board.rows.map((r) => r.player.id);

  it('never shows a player at $3M+ with no top-10 finish', () => {
    expect(ids).not.toContain('richOnly');
  });
  it('marks under-$3M top-10 players likely, others not', () => {
    const likely = board.rows.filter((r) => r.likely).map((r) => r.player.id).sort();
    expect(likely).toEqual(['cheapTop', 'cheapTop2']);
  });
  it('sorts lowest salary first', () => {
    expect(ids).toEqual(['cheapTop2', 'cheapOnly', 'cheapTop', 'richTop']);
  });
  it('always shows the player already filed', () => {
    const b = buildVeteranExtensionBoard({
      players: [p('richOnly', 5_000_000)],
      leagueYear: 2026,
      salaryAverages: averages,
      declaration: { playerId: 'richOnly', playerName: 'P', status: 'pending', requestedYears: 5, currentYears: 3, currentSalary: 5_000_000 } as any,
    });
    expect(b.rows.map((r) => r.player.id)).toEqual(['richOnly']);
  });
});

describe('computeBestFinishes', () => {
  it('ranks regular-season points by position and year, keeping the best', () => {
    const best = computeBestFinishes(
      {
        players: { a: ['A', 'WR'], b: ['B', 'WR'], d: ['D', 'Def'] },
        weeks: [
          [2023, 1, '0001', 'a', 10, 0],
          [2023, 1, '0002', 'b', 20, 0],
          [2023, 15, '0001', 'a', 99, 0], // playoffs: ignored
          [2024, 1, '0001', 'a', 30, 0],
          [2024, 1, '0002', 'b', 5, 0],
          [2024, 2, '0003', 'd', 7, 0],
        ],
      },
      { seasons: [{ y: 2023, pw: 15 }, { y: 2024, pw: 15 }] },
    );
    expect(best.get('a')).toEqual({ rank: 1, year: 2024, position: 'WR' });
    expect(best.get('b')).toEqual({ rank: 1, year: 2023, position: 'WR' });
    expect(best.get('d')?.position).toBe('DEF');
  });
});
