import { describe, it, expect } from 'vitest';
import {
  assembleRoundView,
  formatRecord,
  formatPointsFor,
  type RoundViewDeps,
} from '../src/utils/hero-data/playoff-round-data';
import type { PlayoffBracketSummaryGame } from '../src/types/hero-state';

/** Minimal deps: brand echoes the id, one team carries a compositable headliner. */
function makeDeps(overrides: Partial<RoundViewDeps> = {}): RoundViewDeps {
  return {
    brandOf: (fid) => ({ name: `Team ${fid}`, color: '#123456', crest: `/crest/${fid}.png`, icon: `/icon/${fid}.png` }),
    shortNameOf: (fid) => `T${fid}`,
    mediumNameOf: (fid) => `Team ${fid}`,
    headlinerOf: (fid) => ({ name: `Star ${fid}`, position: 'QB', nflTeam: 'BAL', headshot: 'https://a.espncdn.com/x.png' }),
    projOf: () => 0,
    recordOf: () => '',
    pointsForOf: () => '',
    ...overrides,
  };
}

function game(
  id: string,
  week: number,
  home: { fid: string; seed: number },
  away: { fid: string; seed: number },
  complete = false,
): PlayoffBracketSummaryGame {
  return {
    gameId: id,
    roundWeek: week,
    home: { franchiseId: home.fid, seed: home.seed, displayName: home.fid, points: complete ? 100 : undefined },
    away: { franchiseId: away.fid, seed: away.seed, displayName: away.fid, points: complete ? 90 : undefined },
    isComplete: complete,
  };
}

describe('assembleRoundView — round selection', () => {
  const bracket: PlayoffBracketSummaryGame[] = [
    // Week 15: 3 wild-card games
    game('wc1', 15, { fid: '3', seed: 3 }, { fid: '6', seed: 6 }),
    game('wc2', 15, { fid: '4', seed: 4 }, { fid: '5', seed: 5 }),
    game('wc3', 15, { fid: '7', seed: 7 }, { fid: '8', seed: 8 }),
    // Week 16: 2 semifinal games
    game('sf1', 16, { fid: '1', seed: 1 }, { fid: '8', seed: 8 }),
    game('sf2', 16, { fid: '2', seed: 2 }, { fid: '4', seed: 4 }),
    // Week 17: championship
    game('final', 17, { fid: '1', seed: 1 }, { fid: '2', seed: 2 }),
  ];

  it('features the wild-card round (3 games) while everything is unplayed', () => {
    const view = assembleRoundView(bracket, makeDeps());
    expect(view?.kind).toBe('wild-card');
    expect(view?.week).toBe(15);
    expect(view?.games).toHaveLength(3);
    expect(view?.label).toBe('Wild Card Weekend');
  });

  it('advances to semifinals once the wild-card week is complete', () => {
    const played = bracket.map((g) => (g.roundWeek === 15 ? { ...g, isComplete: true } : g));
    const view = assembleRoundView(played, makeDeps());
    expect(view?.kind).toBe('semifinals');
    expect(view?.week).toBe(16);
    expect(view?.games).toHaveLength(2);
  });

  it('features the championship when only the final is unplayed', () => {
    const played = bracket.map((g) => (g.roundWeek !== 17 ? { ...g, isComplete: true } : g));
    const view = assembleRoundView(played, makeDeps());
    expect(view?.kind).toBe('championship');
    expect(view?.week).toBe(17);
    expect(view?.games).toHaveLength(1);
  });

  it('lingers on the final round when the whole bracket is complete', () => {
    const played = bracket.map((g) => ({ ...g, isComplete: true }));
    const view = assembleRoundView(played, makeDeps());
    expect(view?.kind).toBe('championship');
  });

  it('returns null for an empty bracket', () => {
    expect(assembleRoundView([], makeDeps())).toBeNull();
  });

  it('prefers the live week’s round even when the whole bracket is unplayed', () => {
    // Static/preview bracket (nothing played): preferWeek steers the round.
    expect(assembleRoundView(bracket, makeDeps(), 15)?.kind).toBe('wild-card');
    expect(assembleRoundView(bracket, makeDeps(), 16)?.kind).toBe('semifinals');
    expect(assembleRoundView(bracket, makeDeps(), 17)?.kind).toBe('championship');
  });

  it('ignores a preferWeek the bracket does not contain', () => {
    // Week 12 isn't in the bracket → falls back to earliest unplayed (wild card).
    expect(assembleRoundView(bracket, makeDeps(), 12)?.kind).toBe('wild-card');
  });
});

describe('assembleRoundView — team resolution', () => {
  const bracket = [game('wc1', 15, { fid: '3', seed: 3 }, { fid: '6', seed: 6 })];

  it('orders the higher seed (lower number) on the left', () => {
    // Feed away as the higher seed to prove it gets swapped to teams[0].
    const swapped: PlayoffBracketSummaryGame[] = [
      { ...bracket[0], home: { franchiseId: '6', seed: 6, displayName: '6' }, away: { franchiseId: '3', seed: 3, displayName: '3' } },
    ];
    const view = assembleRoundView(swapped, makeDeps());
    expect(view?.games[0].teams[0].seed).toBe(3);
    expect(view?.games[0].teams[1].seed).toBe(6);
  });

  it('flags the signed-in owner’s game and team', () => {
    const view = assembleRoundView(bracket, makeDeps({ userFranchiseId: '6' }));
    expect(view?.games[0].isUserGame).toBe(true);
    const mine = view?.games[0].teams.find((t) => t.franchiseId === '6');
    expect(mine?.isUser).toBe(true);
  });
});

describe('assembleRoundView — wild-card featured', () => {
  const bracket: PlayoffBracketSummaryGame[] = [
    game('wc1', 15, { fid: '3', seed: 3 }, { fid: '6', seed: 6 }),
    game('wc2', 15, { fid: '4', seed: 4 }, { fid: '5', seed: 5 }),
    game('wc3', 15, { fid: '7', seed: 7 }, { fid: '8', seed: 8 }),
  ];

  it('features the highest-projected team with a compositable headliner', () => {
    const proj: Record<string, number> = { '3': 110, '6': 118, '4': 132, '5': 116, '7': 100, '8': 120 };
    const view = assembleRoundView(bracket, makeDeps({ projOf: (fid) => proj[fid] ?? 0 }));
    expect(view?.featured?.franchiseId).toBe('4');
    expect(view?.featured?.proj).toBe(132);
    expect(view?.featured?.player).not.toBeNull();
  });

  it('skips teams whose headliner does not composite', () => {
    const proj: Record<string, number> = { '3': 110, '6': 200, '4': 132, '5': 116, '7': 100, '8': 120 };
    // Team 6 projects highest but has no compositable face → featured falls to 4.
    const view = assembleRoundView(
      bracket,
      makeDeps({ projOf: (fid) => proj[fid] ?? 0, headlinerOf: (fid) => (fid === '6' ? null : { name: `Star ${fid}`, position: 'QB', nflTeam: 'BAL', headshot: 'https://a.espncdn.com/x.png' }) }),
    );
    expect(view?.featured?.franchiseId).toBe('4');
  });

  it('leaves featured null on later rounds', () => {
    const semis = [game('sf1', 16, { fid: '1', seed: 1 }, { fid: '8', seed: 8 }), game('sf2', 16, { fid: '2', seed: 2 }, { fid: '4', seed: 4 })];
    const view = assembleRoundView(semis, makeDeps({ projOf: () => 120 }));
    expect(view?.kind).toBe('semifinals');
    expect(view?.featured).toBeNull();
  });
});

describe('formatRecord / formatPointsFor', () => {
  it('formats records, dropping ties when zero', () => {
    expect(formatRecord('11-3-0')).toBe('11-3');
    expect(formatRecord('10-3-1')).toBe('10-3-1');
    expect(formatRecord('0-0-0')).toBe('');
    expect(formatRecord(undefined)).toBe('');
  });

  it('comma-groups points-for and drops empties', () => {
    expect(formatPointsFor('1842.4')).toBe('1,842');
    expect(formatPointsFor(1798)).toBe('1,798');
    expect(formatPointsFor('0')).toBe('');
    expect(formatPointsFor(undefined)).toBe('');
  });
});
