/**
 * src/utils/rosters/live-rosters-feed.ts is how a page reads the current
 * league year's rosters now that the roster sync commits rosters.json once a
 * day (scripts/lib/held-sync-files.mjs). Live wins when it answers; on any
 * failure — or an EMPTY answer, which would report every rostered player as
 * a free agent — the committed feed comes back exactly as given.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({ getCachedRosterFranchises: vi.fn() }));
vi.mock('../src/utils/mfl-roster-cache', () => cache);

import { liveRostersFeed, overlayLiveFranchises, rosteredIdsOf } from '../src/utils/rosters/live-rosters-feed';

const committed = {
  version: '1.0',
  rosters: {
    franchise: [
      { id: '0001', week: '7', player: [{ id: '100', status: 'ROSTER', salary: '500000', contractInfo: 'R1' }] },
      { id: '0002', player: { id: '200', status: 'ROSTER' } },
    ],
  },
};

/** A franchise's players as a list — MFL collapses a one-player roster to a bare object. */
const playersOf = (feed: typeof committed, i: number) => [feed.rosters.franchise[i].player].flat();

describe('overlayLiveFranchises', () => {
  it('replaces who holds whom with the live list', () => {
    const out = overlayLiveFranchises(committed, [
      { id: '0001', player: [{ id: '300', status: 'ROSTER' }] },
      { id: '0002', player: [{ id: '200', status: 'INJURED_RESERVE' }, { id: '100', status: 'ROSTER' }] },
    ]);
    expect(rosteredIdsOf(out)).toEqual(new Set(['300', '200', '100']));
    expect(playersOf(out, 0).map((p) => p.id)).toEqual(['300']);
    expect(playersOf(out, 1)[0]).toEqual({ id: '200', status: 'INJURED_RESERVE' });
    // Top-level and per-franchise fields the cache does not carry survive.
    expect(out.version).toBe('1.0');
    expect((out.rosters.franchise[0] as { week?: string }).week).toBe('7');
  });

  it("keeps a committed field the live row lacks, and never blanks one with undefined", () => {
    const out = overlayLiveFranchises(committed, [
      { id: '0001', player: [{ id: '100', status: 'ROSTER', salary: '600000', contractYear: undefined }] },
    ]);
    expect(playersOf(out, 0)[0]).toEqual({ id: '100', status: 'ROSTER', salary: '600000', contractInfo: 'R1' });
  });

  it('treats null or an empty live list as no answer', () => {
    expect(overlayLiveFranchises(committed, null)).toBe(committed);
    expect(overlayLiveFranchises(committed, [])).toBe(committed);
  });

  it('builds a feed from live alone when nothing is committed yet', () => {
    const out = overlayLiveFranchises(null, [{ id: '0001', player: [{ id: '1', status: 'ROSTER' }] }]) as any;
    expect(rosteredIdsOf(out)).toEqual(new Set(['1']));
  });
});

describe('liveRostersFeed', () => {
  beforeEach(() => {
    cache.getCachedRosterFranchises.mockReset();
  });

  it('asks the cache for the season and league it is given', async () => {
    cache.getCachedRosterFranchises.mockResolvedValue([{ id: '0001', player: [{ id: '9', status: 'ROSTER' }] }]);
    const out = await liveRostersFeed(committed, 2026, '12345');
    expect(cache.getCachedRosterFranchises).toHaveBeenCalledWith('2026', '12345');
    expect(rosteredIdsOf(out)).toEqual(new Set(['9']));
  });

  it('falls back to the committed feed when Redis is unavailable', async () => {
    cache.getCachedRosterFranchises.mockResolvedValue(null);
    expect(await liveRostersFeed(committed, 2026, '12345')).toBe(committed);
  });

  it('falls back to the committed feed when the cache throws', async () => {
    cache.getCachedRosterFranchises.mockImplementation(async () => {
      throw new Error('down');
    });
    expect(await liveRostersFeed(committed, 2026, '12345')).toBe(committed);
  });
});
