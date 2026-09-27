import { describe, expect, it } from 'vitest';
import { bestBallSeason, BESTBALL_FRANCHISES } from '../scripts/demo/lib/bestball.mjs';

// Twelve teams, each drafting 2 QB, 4 RB, 5 WR, 2 TE on its own NFL team.
const POS = ['QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE'];
const players = new Map<string, { position: string; team: string }>();
const picks: Array<{ franchiseId: string; playerId: string }> = [];
BESTBALL_FRANCHISES.forEach((f, t) => {
  POS.forEach((position, i) => {
    const id = `${t}${String(i).padStart(2, '0')}`;
    players.set(id, { position, team: t < 6 ? 'AAA' : 'BBB' });
    picks.push({ franchiseId: f.id, playerId: id });
  });
});
// Every player scores his index; in week 3 only team AAA has played.
const weekScores = (week: number) =>
  new Map([...players.keys()].filter((id) => week < 3 || players.get(id)!.team === 'AAA').map((id) => [id, Number(id.slice(-2)) + week]));
const facts = { players, scores: new Map([1, 2, 3].map((w) => [w, weekScores(w)])) };

describe('demo best-ball season', () => {
  const season = bestBallSeason({ draft: { picks }, facts, currentWeek: 2 });

  it('scores each played week from the optimal eight: QB, 2 RB, 3 WR, TE and a flex', () => {
    expect(season.weekly.map((w) => w.week)).toEqual([1, 2]);
    for (const w of season.weekly) {
      expect(w.games).toHaveLength(6);
      for (const [home, away] of w.games) {
        for (const lineup of [home, away]) {
          expect(lineup.starters).toHaveLength(8);
          const pos = lineup.starters.map((id: string) => players.get(id)!.position);
          expect(pos.filter((p: string) => p === 'QB')).toHaveLength(1);
          expect(pos.filter((p: string) => p === 'TE').length).toBeGreaterThanOrEqual(1);
          const sum = lineup.starters.reduce((s: number, id: string) => s + (facts.scores.get(w.week)!.get(id) ?? 0), 0);
          expect(lineup.score).toBeCloseTo(sum, 2);
        }
      }
    }
  });

  it('plays the next week live: only finished NFL games carry points, the rest are still to play', () => {
    expect(season.inProgress?.week).toBe(3);
    const lineups = season.inProgress!.games.flatMap(([h, a]: any[]) => [h, a]);
    const toPlay = lineups.flatMap((l: any) => l.players).filter((p: any) => p.gameSecondsRemaining === '3600');
    expect(toPlay.length).toBeGreaterThan(0);
    for (const p of toPlay) expect(Number(p.score)).toBe(0);
  });

  it('rosters every drafted player on the team that drafted him', () => {
    expect([...season.rosters.values()].reduce((n, r) => n + r.size, 0)).toBe(picks.length);
  });
});
