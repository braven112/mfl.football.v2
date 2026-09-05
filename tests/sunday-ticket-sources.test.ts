import { describe, it, expect } from 'vitest';
import {
  buildContribution,
  projectionsForWeek,
  rostersHaveFranchises,
  type ContributionSource,
} from '../src/utils/sunday-ticket-sources';
import type { PlayerIdentity } from '../src/utils/player-map';

const identity = new Map<string, PlayerIdentity>([
  ['100', { mflId: '100', name: 'Josh Allen', position: 'QB', nflTeam: 'BUF', headshot: 'h100', espnId: null, nflEspnId: null } as PlayerIdentity],
  ['200', { mflId: '200', name: 'Amon-Ra St. Brown', position: 'WR', nflTeam: 'DET', headshot: '', espnId: null, nflEspnId: null } as PlayerIdentity],
  ['300', { mflId: '300', name: 'Bench Guy', position: 'RB', nflTeam: 'WSH', headshot: '', espnId: null, nflEspnId: null } as PlayerIdentity],
]);

const source: ContributionSource = { leagueId: 'L1', leagueName: 'League One', franchiseId: '0001', franchiseName: 'Pigskins' };

const rosters = {
  rosters: {
    franchise: [
      { id: '0001', player: [{ id: '100', status: 'ROSTER' }, { id: '200', status: 'ROSTER' }, { id: '300', status: 'ROSTER' }, { id: '400', status: 'INJURED_RESERVE' }] },
      { id: '0002', player: { id: '500', status: 'ROSTER' } },
    ],
  },
};

const weekEntry = {
  week: '2',
  matchup: [{ franchise: [{ id: '0001', starters: '100,200,', player: [{ id: '100', status: 'starter' }, { id: '200', status: 'starter' }, { id: '300', status: 'nonstarter' }] }, { id: '0002' }] }],
};

const projections = { projectedScores: { week: '2', playerScore: [{ id: '100', score: '22.5' }, { id: '200', score: '15.1' }, { id: '300', score: '9.0' }] } };

describe('projectionsForWeek', () => {
  it('reads the week it was asked for and nothing else', () => {
    expect([...projectionsForWeek(projections, 2)]).toEqual([['100', 22.5], ['200', 15.1], ['300', 9]]);
    expect(projectionsForWeek(projections, 3).size).toBe(0);
  });

  it('treats the emptied-feed sentinel and a non-projection payload as no projections', () => {
    expect(projectionsForWeek({ projectedScores: { week: '23', playerScore: { id: '', score: '' } } }, 23).size).toBe(0);
    expect(projectionsForWeek({ error: 'throttled' }, 2).size).toBe(0);
    expect(projectionsForWeek(null, 2).size).toBe(0);
  });
});

describe('rostersHaveFranchises', () => {
  it('is false for the private-league empty 200 and true for a bare single franchise', () => {
    expect(rostersHaveFranchises({ rosters: {} })).toBe(false);
    expect(rostersHaveFranchises({ rosters: { franchise: [] } })).toBe(false);
    expect(rostersHaveFranchises({ rosters: { franchise: { id: '0001' } } })).toBe(true);
  });
});

describe('buildContribution', () => {
  it('uses the submitted lineup when one resolved, with that league\'s projections and identity', () => {
    const c = buildContribution({ source, rostersPayload: rosters, weekEntry, projectionsPayload: projections, week: 2, identity });
    expect(c).not.toBeNull();
    expect(c!.lineupResolved).toBe(true);
    expect(c!.players).toEqual([
      { playerId: '100', name: 'Josh Allen', position: 'QB', nflTeam: 'BUF', proj: 22.5, headshot: 'h100' },
      { playerId: '200', name: 'Amon-Ra St. Brown', position: 'WR', nflTeam: 'DET', proj: 15.1 },
    ]);
  });

  it('falls back to the active roster — not IR — when no lineup is on file, and says so', () => {
    const c = buildContribution({ source, rostersPayload: rosters, weekEntry: null, projectionsPayload: projections, week: 2, identity });
    expect(c!.lineupResolved).toBe(false);
    expect(c!.players.map((p) => p.playerId)).toEqual(['100', '200', '300']);
  });

  it('counts the whole roster for a best-ball league even when a lineup exists', () => {
    const c = buildContribution({ source: { ...source, bestBall: true }, rostersPayload: rosters, weekEntry, projectionsPayload: projections, week: 2, identity });
    expect(c!.lineupResolved).toBe(false);
    expect(c!.players).toHaveLength(3);
  });

  it('projects 0 for a stale projections week and names an unknown player by id', () => {
    const c = buildContribution({ source, rostersPayload: rosters, weekEntry, projectionsPayload: projections, week: 3, identity: new Map() });
    expect(c!.players.map((p) => [p.name, p.proj, p.nflTeam])).toEqual([['Player 100', 0, ''], ['Player 200', 0, '']]);
  });

  it('returns null when the franchise is not in the rosters payload', () => {
    expect(buildContribution({ source: { ...source, franchiseId: '0009' }, rostersPayload: rosters, weekEntry, projectionsPayload: projections, week: 2, identity })).toBeNull();
    expect(buildContribution({ source, rostersPayload: { rosters: {} }, weekEntry, projectionsPayload: projections, week: 2, identity })).toBeNull();
  });

  it('reads a FRANCHISE-scoped payload whose one franchise is a bare object', () => {
    const scoped = { rosters: { franchise: { id: '0002', player: { id: '500', status: 'ROSTER' } } } };
    const c = buildContribution({ source: { ...source, franchiseId: '0002' }, rostersPayload: scoped, weekEntry: null, projectionsPayload: null, week: 2, identity });
    expect(c!.players.map((p) => p.playerId)).toEqual(['500']);
  });
});
