import { describe, expect, it } from 'vitest';
import { findLineupProblems, hasBlockingProblem, type ProblemPlayer } from '../src/utils/lineup-problems';

const player = (id: string, over: Partial<ProblemPlayer> = {}): ProblemPlayer => ({
  id,
  name: `Player ${id}`,
  isBye: false,
  gameLocked: false,
  injury: null,
  ...over,
});

const players = (...ps: ProblemPlayer[]) => new Map(ps.map((p) => [p.id, p]));

describe('findLineupProblems', () => {
  it('returns nothing for a clean lineup', () => {
    const problems = findLineupProblems({
      slots: [{ position: 'QB', playerId: '1', locked: false }],
      players: players(player('1')),
      week: 6,
    });
    expect(problems).toEqual([]);
    expect(hasBlockingProblem(problems)).toBe(false);
  });

  it('puts IR violations first, as blocking, naming the league rule', () => {
    const problems = findLineupProblems({
      slots: [{ position: 'RB', playerId: null, locked: false }],
      players: players(),
      week: 6,
      irViolations: [{ id: '9', name: 'Breece Hall', injuryStatus: 'Questionable' }],
      irEligibleStatuses: ['Doubtful', 'Out', 'IR'],
    });
    expect(problems.map((p) => p.kind)).toEqual(['ir-violation', 'empty-slot']);
    expect(problems[0]).toMatchObject({ severity: 'blocking', playerId: '9' });
    expect(problems[0].detail).toContain('listed Questionable');
    expect(problems[0].detail).toContain('Doubtful, Out or IR');
    expect(hasBlockingProblem(problems)).toBe(true);
  });

  it('stays league-neutral when the league declares no IR rule', () => {
    const [p] = findLineupProblems({
      slots: [],
      players: players(),
      week: 6,
      irViolations: [{ id: '9', name: 'X', injuryStatus: null }],
    });
    expect(p.detail).toContain('not on the injury report');
    expect(p.detail).toContain('no longer qualifies');
  });

  it('flags starters on bye and ruled out, with the slot to reopen', () => {
    const problems = findLineupProblems({
      slots: [
        { position: 'QB', playerId: '1', locked: false },
        { position: 'WR', playerId: '2', locked: false },
        { position: 'TE', playerId: '3', locked: false },
      ],
      players: players(
        player('1', { isBye: true }),
        player('2', { injury: { injuryStatus: 'Out' } }),
        player('3', { injury: { injuryStatus: 'Questionable' } }),
      ),
      week: 6,
    });
    expect(problems.map((p) => [p.kind, p.slotIndex, p.severity])).toEqual([
      ['bye', 0, 'warning'],
      ['out', 1, 'warning'],
    ]);
  });

  it('skips slots that can no longer change', () => {
    const problems = findLineupProblems({
      slots: [
        { position: 'QB', playerId: null, locked: true },
        { position: 'WR', playerId: '2', locked: false },
      ],
      players: players(player('2', { isBye: true, gameLocked: true })),
      week: 6,
    });
    expect(problems).toEqual([]);
  });
});
