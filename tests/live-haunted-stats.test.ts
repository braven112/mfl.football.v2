/**
 * The Halloween header's two cards on Live Scoring (`hauntedStats`).
 *
 * Pins the choices a reader would notice: the monster is the best performance
 * across EVERY panel (the AFL has one per conference), a game still being
 * played outranks a closer final one, an unplayed 0-0 pairing is never the
 * scariest game, and a failed panel contributes nothing.
 */
import { describe, it, expect } from 'vitest';
import { hauntedStats } from '../src/utils/live/haunted-stats';
import type { LiveMatchup, LivePanel } from '../src/types/live';
import type { PlayerMeta } from '../src/types/live-scoring';

const side = (name: string, live: number, secondsRemaining: number, yetToPlay = 0) =>
  ({
    franchiseId: name,
    name,
    nameShort: name,
    live,
    yetToPlay,
    players: [{ playerId: `${name}-1`, points: live, secondsRemaining }],
    bench: [],
  }) as unknown as LiveMatchup['sides'][number];

const matchup = (a: LiveMatchup['sides'][number], b: LiveMatchup['sides'][number]) =>
  ({ index: 0, sides: [a, b], viewerSide: null, p0: 0.5 }) as unknown as LiveMatchup;

const panel = (
  matchups: LiveMatchup[],
  players: { playerId: string; points: number; owners?: string[] }[] = [],
  status = 'ok',
) =>
  ({
    leagueId: 'L',
    leagueName: 'L',
    status,
    matchups,
    leaders: {
      teams: [],
      players: players.map((p) => ({
        playerId: p.playerId,
        points: p.points,
        secondsRemaining: 0,
        owners: (p.owners ?? []).map((franchiseName) => ({ franchiseId: franchiseName, franchiseName })),
      })),
    },
  }) as unknown as LivePanel;

const meta = { p1: { name: 'James Cook' }, p2: { name: 'Sam Darnold' } } as unknown as Record<
  string,
  PlayerMeta
>;

describe('hauntedStats', () => {
  it('takes the best performance across every panel and names his owners', () => {
    const stats = hauntedStats(
      [
        panel([], [{ playerId: 'p2', points: 11, owners: ['Pigskins'] }]),
        panel([], [{ playerId: 'p1', points: 20.9, owners: ['Ninjas', 'Smokane'] }]),
      ],
      meta,
    );
    expect(stats.monster).toEqual({ playerId: 'p1', name: 'James Cook', points: 20.9, owners: 'Ninjas, Smokane' });
  });

  it('names an unmapped player by id rather than dropping him', () => {
    const stats = hauntedStats([panel([], [{ playerId: 'p9', points: 5 }])], meta);
    expect(stats.monster?.name).toBe('Player p9');
  });

  it('prefers a game still being played over a closer final one', () => {
    const closeFinal = matchup(side('A', 90, 0), side('B', 89, 0));
    const liveGame = matchup(side('C', 95.3, 600, 1), side('D', 88.3, 0, 1));
    const stats = hauntedStats([panel([closeFinal, liveGame])], meta);
    expect(stats.scariest).toEqual({ names: ['C', 'D'], margin: 7, yetToPlay: 2, final: false });
  });

  it('picks the smallest margin among live games', () => {
    const wide = matchup(side('A', 120, 600), side('B', 60, 600));
    const tight = matchup(side('C', 70, 600), side('D', 68.5, 600));
    expect(hauntedStats([panel([wide, tight])], meta).scariest?.names).toEqual(['C', 'D']);
  });

  it('never calls an unplayed 0-0 pairing the scariest game', () => {
    const unplayed = matchup(side('A', 0, 3600, 9), side('B', 0, 3600, 9));
    expect(hauntedStats([panel([unplayed])], meta)).toEqual({ monster: null, scariest: null });
  });

  it('ignores a panel that could not be read', () => {
    const game = matchup(side('A', 50, 0), side('B', 40, 0));
    const stats = hauntedStats([panel([game], [{ playerId: 'p1', points: 30 }], 'unavailable')], meta);
    expect(stats).toEqual({ monster: null, scariest: null });
  });
});
