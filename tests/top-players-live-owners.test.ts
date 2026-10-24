import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TopPlayersFile, TopPlayerRow } from '../src/types/top-players';

const cacheMock = vi.fn();
vi.mock('../src/utils/mfl-roster-cache', () => ({
  getCachedRosterFranchises: (...args: unknown[]) => cacheMock(...args),
}));

const { overlayLiveOwners, withLiveOwners } = await import('../src/utils/top-players-live-owners');

const A = { id: '0001', name: 'Alpha', icon: '/a.png' };
const B = { id: '0002', name: 'Bravo', icon: '/b.png' };

const row = (id: string, owners: TopPlayerRow['owners']): TopPlayerRow => ({
  id, name: `P${id}`, position: 'RB', team: 'GB', espnId: null, owners,
  weeks: { '1': 10 }, total: 10, avg: 10, games: 1, best: 10, rank: 1, posRank: 1,
});

const file = (players: TopPlayerRow[], seasonYear = 2026): TopPlayersFile => ({
  seasonYear, startWeek: 1, endWeek: 17, lastRegularSeasonWeek: 14,
  completedWeeks: [1], positions: ['RB'], players,
});

const live = (...rosters: Array<[string, string[]]>) =>
  rosters.map(([id, players]) => ({ id, player: players.map((p) => ({ id: p, status: 'ROSTER' })) }));

describe('overlayLiveOwners', () => {
  it('names the live owner, marks a drop as unowned, and keeps names and crests', () => {
    const data = file([row('10', [A]), row('11', []), row('12', [B])]);
    const out = overlayLiveOwners(data, live(['0001', []], ['0002', ['10', '11']]));
    expect(out.players.map((p) => p.owners)).toEqual([[B], [B], []]);
  });

  it('keeps every owner of a player rostered twice (the AFL conferences)', () => {
    const data = file([row('10', [A]), row('11', [B])]);
    const out = overlayLiveOwners(data, live(['0001', ['10']], ['0002', ['10']]));
    expect(out.players[0].owners).toEqual([A, B]);
  });

  it('leaves a player alone when the file has never named his live owner', () => {
    const data = file([row('10', [A])]);
    const out = overlayLiveOwners(data, live(['0099', ['10']]));
    expect(out.players[0].owners).toEqual([A]);
  });

  it('treats an empty or missing live answer as no answer', () => {
    const data = file([row('10', [A])]);
    expect(overlayLiveOwners(data, [])).toBe(data);
    expect(overlayLiveOwners(data, null)).toBe(data);
  });
});

describe('withLiveOwners', () => {
  beforeEach(() => cacheMock.mockReset());
  const league = { slug: 'theleague', id: 'L' };
  const oct = new Date('2026-10-24T12:00:00Z');

  it('reads the cache for the current league year', async () => {
    cacheMock.mockResolvedValue(live(['0002', ['10']]));
    const out = await withLiveOwners(file([row('10', [A]), row('11', [B])]), league, oct);
    expect(cacheMock).toHaveBeenCalledWith('2026', 'L');
    expect(out.players[0].owners).toEqual([B]);
  });

  it('never asks about a past season', async () => {
    const data = file([row('10', [A])], 2025);
    expect(await withLiveOwners(data, league, oct)).toBe(data);
    expect(cacheMock).not.toHaveBeenCalled();
  });

  it('falls back to the committed owners when Redis has no answer', async () => {
    cacheMock.mockResolvedValue(null);
    const data = file([row('10', [A])]);
    expect(await withLiveOwners(data, league, oct)).toBe(data);
  });
});
