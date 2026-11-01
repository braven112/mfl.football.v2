import { describe, expect, it } from 'vitest';
import {
  attachDriveStakes,
  biggestStake,
  rankedStakes,
  scoreValue,
  stakesFor,
  stakeSwing,
} from '../src/utils/broadcast-drive-stakes';
import { overlayStake } from '../src/utils/broadcast-overlay';
import { winProbability } from '../src/utils/live-win-probability';
import type { RedZoneAlert } from '../src/utils/broadcast-moments';
import type { PositionRuleSet } from '../src/utils/live/scoring-rules';
import type { BroadcastLeagueScore, BroadcastTeamScore } from '../src/types/live-broadcast';

const team = (projectedFinal: number, remainingPoints: number): BroadcastTeamScore => ({
  live: projectedFinal - remainingPoints,
  projectedFinal,
  remainingPoints,
  yetToPlay: 3,
  players: [],
});

const score = (overrides: Partial<BroadcastLeagueScore> = {}): BroadcastLeagueScore => {
  const teams = { '0001': team(100, 30), '0002': team(96, 25), '0003': team(110, 20) };
  return {
    leagueId: 'L1',
    ok: true,
    live: true,
    teams,
    winProbability: [
      winProbability(100, 96, 55),
      winProbability(100, 110, 50),
    ],
    ...overrides,
  };
};

const viewer = { leagueId: 'L1', franchiseId: '0001', opponentIds: ['0002', '0003'] };

describe('scoreValue', () => {
  it('prices a position at the standard touchdown when the league publishes no rules', () => {
    expect(scoreValue(null, 'RB')).toBe(6);
    expect(scoreValue(null, 'WR')).toBe(6);
    expect(scoreValue(null, 'QB')).toBe(4);
    expect(scoreValue(null, 'K')).toBe(3);
  });

  it('gives a defense or an IDP no stake: they are not on the offense with the ball', () => {
    expect(scoreValue(null, 'DEF')).toBeNull();
    expect(scoreValue(null, 'LB')).toBeNull();
  });

  it("reads the league's own rule, summing a base TD and a bonus on the same code", () => {
    const rules: PositionRuleSet[] = [
      {
        positions: ['QB'],
        rules: [{ event: ['#P'], lo: 1, hi: 99, kind: 'per', points: 6, every: 1 }],
      },
      {
        positions: ['RB', 'WR', 'TE'],
        rules: [
          { event: ['#R'], lo: 1, hi: 99, kind: 'per', points: 6, every: 1 },
          { event: ['#R'], lo: 1, hi: 1, kind: 'flat', points: 1, every: 1 },
        ],
      },
      {
        positions: ['PK'],
        rules: [
          { event: ['FG'], lo: 0, hi: 39, kind: 'flat', points: 3, every: 1 },
          { event: ['FG'], lo: 40, hi: 99, kind: 'flat', points: 5, every: 1 },
        ],
      },
    ];
    expect(scoreValue(rules, 'QB')).toBe(6);
    expect(scoreValue(rules, 'RB')).toBe(7);
    // A red-zone kick is priced at 30 yards, inside the 0-39 band.
    expect(scoreValue(rules, 'K')).toBe(3);
    // No rule names a receiving TD for a WR here: standard value, never 0.
    expect(scoreValue(rules, 'WR')).toBe(6);
  });

  it('keeps a published rule that pays nothing for one score, rather than the standard', () => {
    const rules: PositionRuleSet[] = [
      { positions: ['RB'], rules: [{ event: ['#R'], lo: 2, hi: 99, kind: 'flat', points: 10, every: 1 }] },
    ];
    expect(scoreValue(rules, 'RB')).toBe(0);
  });
});

const best = (...args: Parameters<typeof stakesFor>) => biggestStake(stakesFor(...args));
const me = { side: 'mine' as const, franchiseId: '0001', position: 'RB', playerId: '2' };

describe('stakesFor', () => {
  it("raises the viewer's chance when his own player scores", () => {
    const stake = best(me, score(), viewer, null);
    expect(stake).not.toBeNull();
    expect(stake!.after).toBeGreaterThan(stake!.before);
    expect(stake!.points).toBe(6);
  });

  it("prices every matchup of a doubleheader, and the biggest is the board's", () => {
    const all = stakesFor(me, score(), viewer, null);
    expect(all.map((s) => s.matchupIndex)).toEqual([0, 1]);
    const swings = all.map((s) => s.after - s.before);
    expect(biggestStake(all)!.matchupIndex).toBe(swings[0] > swings[1] ? 0 : 1);
  });

  it("lowers the chance for an opponent's player, and only in his own matchup", () => {
    const all = stakesFor({ side: 'opponent', franchiseId: '0003', position: 'WR', playerId: '9' }, score(), viewer, null);
    expect(all.map((s) => s.matchupIndex)).toEqual([1]);
    expect(all[0].after).toBeLessThan(all[0].before);
  });

  it('moves nothing when he starts for both sides of an AFL matchup', () => {
    const row = { id: '2' } as BroadcastTeamScore['players'][number];
    const s = score();
    s.teams['0001'] = { ...s.teams['0001'], players: [row] };
    s.teams['0002'] = { ...s.teams['0002'], players: [row] };
    const [first] = stakesFor(me, s, viewer, null);
    expect(first.matchupIndex).toBe(0);
    expect(first.after).toBeCloseTo(first.before, 10);
  });

  it("measures `before` with the same model as `after`, whatever curve the caller's bar used", () => {
    // The demo draws its bar with its own soft curve; a stake read off that bar
    // could show the viewer's own touchdown LOWERING his chance.
    const s = score({ winProbability: [0.99, 0.99] });
    for (const stake of stakesFor(me, s, viewer, null)) {
      expect(stake.after).toBeGreaterThan(stake.before);
    }
  });

  it('prices nothing for a league whose feed could not be read', () => {
    expect(stakesFor(me, score({ ok: false }), viewer, null)).toEqual([]);
  });
});

const alert = (players: Partial<RedZoneAlert['players'][number]>[]): RedZoneAlert => ({
  team: 'ATL',
  downDistance: '1st & Goal',
  players: players.map((p) => ({
    leagueId: 'L1',
    leagueName: 'TheLeague',
    side: 'mine',
    playerId: '2',
    playerName: 'Bijan Robinson',
    position: 'RB',
    franchiseId: '0001',
    ...p,
  })),
});

describe('attachDriveStakes, rankedStakes and the overlay tab', () => {
  it('attaches a stake to every red-zone player it can price', () => {
    const [out] = attachDriveStakes([alert([{}, { playerId: '7', position: 'DEF' }])], [score()], [viewer], new Map());
    expect(out.players[0].stake).toBeDefined();
    expect(out.players[1].stake).toBeUndefined();
  });

  it('ranks by the size of the swing, and drops one that rounds to nothing', () => {
    const alerts: RedZoneAlert[] = [
      alert([
        { playerId: 'a', stake: { matchupIndex: 0, before: 0.5, after: 0.58, points: 6 } },
        { playerId: 'b', side: 'opponent', stake: { matchupIndex: 1, before: 0.6, after: 0.47, points: 6 } },
        { playerId: 'c', stake: { matchupIndex: 0, before: 0.501, after: 0.503, points: 3 } },
      ]),
    ];
    expect(rankedStakes(alerts).map((r) => r.playerId)).toEqual(['b', 'a']);
    expect(stakeSwing({ before: 0.6, after: 0.47 })).toBe(-13);
  });

  it("gives the corner box only its own game's stake", () => {
    const alerts = [alert([{ stake: { matchupIndex: 1, before: 0.4, after: 0.55, points: 6 } }])];
    expect(overlayStake(alerts, { key: 'L1:0', leagueId: 'L1' })).toBeNull();
    expect(overlayStake(alerts, { key: 'L1:1', leagueId: 'L1' })).toMatchObject({
      playerName: 'Bijan Robinson',
      team: 'ATL',
      swing: 15,
    });
    expect(overlayStake(alerts, { key: 'L2:1', leagueId: 'L2' })).toBeNull();
  });

  it('keeps a doubleheader player on both games as the box rotates', () => {
    const [priced] = attachDriveStakes([alert([{}])], [score()], [viewer], new Map());
    expect(overlayStake([priced], { key: 'L1:0', leagueId: 'L1' })).not.toBeNull();
    expect(overlayStake([priced], { key: 'L1:1', leagueId: 'L1' })).not.toBeNull();
  });
});
