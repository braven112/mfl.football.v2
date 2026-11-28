import { describe, it, expect } from 'vitest';
import { weekSoFar, unplayedGames, liveCardSnapshot } from '../src/utils/matchup-preview-live.mjs';
import { pct, weekSoFarFacts, matchupSoFarFacts } from '../scripts/article-types/matchup-preview.mjs';

// Saturday 2026-11-28, 11 AM PT. Thanksgiving's CHI at DET is final, a
// Sunday game has not kicked off.
const NOW = Date.parse('2026-11-28T19:00:00Z');
const THU = Date.parse('2026-11-26T21:30:00Z') / 1000;
const SUN = Date.parse('2026-11-29T18:00:00Z') / 1000;
const nflGames = [
  { away: 'CHI', home: 'DET', kickoff: THU },
  { away: 'NOS', home: 'CIN', kickoff: SUN },
];
const players = new Map([
  ['1', { name: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }],
  ['2', { name: 'Joe Burrow', position: 'QB', team: 'CIN' }],
  ['3', { name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET' }],
  ['4', { name: 'Bye Guy', position: 'WR', team: 'SEA' }],
  ['5', { name: 'Bench Guy', position: 'WR', team: 'DET' }],
]);
const projections = new Map([['1', 30], ['2', 25.4], ['3', 19.2], ['4', 10], ['5', 12]]);
const liveScoring = {
  liveScoring: {
    matchup: [{
      franchise: [
        { id: '0001', score: '48.20', players: { player: [
          { id: '1', status: 'starter', score: '48.20', gameSecondsRemaining: '0' },
          { id: '2', status: 'starter', score: '0.00', gameSecondsRemaining: '3600' },
          { id: '4', status: 'starter', score: '0.00', gameSecondsRemaining: '0' },
          { id: '5', status: 'nonstarter', score: '9.00', gameSecondsRemaining: '0' },
        ] } },
        { id: '0010', score: '21.60', players: { player: { id: '3', status: 'starter', score: '21.60', gameSecondsRemaining: '0' } } },
      ],
    }],
  },
};
const ctx = { nflGames, players, projections, now: NOW };

describe('weekSoFar', () => {
  it('splits starters into done and still to play, and projects the final from the score', () => {
    const soFar = weekSoFar(liveScoring, ctx)!;
    expect(soFar.through).toBe('Thursday');
    expect(soFar.finals.map((g) => g.home)).toEqual(['DET']);
    const smokane = soFar.teams.get('0001')!;
    expect(smokane.done.map((p) => p.name)).toEqual(['Jahmyr Gibbs']);
    expect(smokane.left.map((p) => p.name)).toEqual(['Joe Burrow']);
    // A bye-week starter and a bench player are in neither group.
    expect(smokane.projFinal).toBe(73.6);
    expect(soFar.teams.get('0010')!.left).toEqual([]);
  });

  it('is null before the week\'s first kickoff, so the preview stays a plain preview', () => {
    expect(weekSoFar(liveScoring, { ...ctx, now: THU * 1000 - 1000 })).toBeNull();
    expect(weekSoFar(null, ctx)).toBeNull();
  });
});

describe('the key NFL game', () => {
  it('is chosen only from games that have not kicked off', () => {
    expect(unplayedGames(nflGames, NOW).map((g) => g.home)).toEqual(['CIN']);
  });
});

describe('fact sheet lines', () => {
  const soFar = weekSoFar(liveScoring, ctx);
  const nameOf = (id: string) => ({ '0001': 'Smokane FC', '0010': 'Fullybaked' }[id] ?? id);

  it('tells the writer the games already played are done', () => {
    expect(weekSoFarFacts(soFar).join('\n')).toMatch(/already played \(through Thursday\): CHI at DET/);
    expect(weekSoFarFacts(null)).toEqual([]);
  });

  it('states each matchup\'s score so far and who already played', () => {
    const lines = matchupSoFarFacts(soFar, '0001', '0010', nameOf);
    expect(lines[0]).toBe('SCORE SO FAR: Smokane FC 48.2 (1 starter still to play, projected final 73.6) vs Fullybaked 21.6 (0 starters still to play, projected final 21.6).');
    expect(lines[1]).toContain('RB Jahmyr Gibbs (Smokane FC) scored 48.2');
  });

  it('feeds the card a snapshot', () => {
    const card = liveCardSnapshot(soFar, '0001', '0010')!;
    expect(card.a).toEqual({ score: 48.2, left: 1, projFinal: 73.6 });
    expect(card.done[0]).toMatchObject({ name: 'Jahmyr Gibbs', franchiseId: '0001' });
  });
});

describe('odds percentages', () => {
  it('never round a near-lock to a flat 100% (or a long shot to 0%)', () => {
    expect(pct(0.9961)).toBe('over 99%');
    expect(pct(1)).toBe('100%');
    expect(pct(0.1624)).toBe('16%');
    expect(pct(0.002)).toBe('under 1%');
    expect(pct(0)).toBe('0%');
  });
});

describe('a Saturday game under way at write time', () => {
  // Week 16-style Saturday: SEA at LAR kicked off 10:30 AM PT, 25 minutes left at 11 AM.
  const SAT = Date.parse('2026-11-28T18:30:00Z') / 1000;
  const games = [...nflGames, { away: 'SEA', home: 'LAR', kickoff: SAT }];
  const live = structuredClone(liveScoring);
  live.liveScoring.matchup[0].franchise[0].players.player[2] = { id: '4', status: 'starter', score: '6.00', gameSecondsRemaining: '1800' };
  const soFar = weekSoFar(live, { ...ctx, nflGames: games })!;

  it('counts its points so far and half the projection still to come', () => {
    const t = soFar.teams.get('0001')!;
    expect(t.live.map((p) => p.name)).toEqual(['Bye Guy']);
    expect(t.projFinal).toBe(48.2 + 25.4 + 5);
  });

  it('tells the writer it is in progress, not done and not upcoming', () => {
    expect(soFar.finals.map((g) => g.home)).toEqual(['DET']);
    expect(weekSoFarFacts(soFar).join('\n')).toMatch(/IN PROGRESS as this is written: SEA at LAR/);
    const nameOf = (id: string) => id;
    expect(matchupSoFarFacts(soFar, '0001', '0010', nameOf).join('\n')).toMatch(/PLAYING RIGHT NOW .*Bye Guy \(0001, SEA\) 6\.0/);
  });

  it('is not a key NFL game candidate', () => {
    expect(unplayedGames(games, NOW).map((g) => g.home)).toEqual(['CIN']);
  });
});
