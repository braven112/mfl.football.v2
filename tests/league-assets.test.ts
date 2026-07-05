import { describe, expect, it } from 'vitest';
import { getActiveTeams } from '../src/utils/league-assets';
import theleagueAssets from '../src/data/theleague.assets.json';
import aflAssets from '../data/afl-fantasy/afl.assets.json';

describe('getActiveTeams', () => {
  it('filters out former entries', () => {
    const teams = [
      { id: '0011', category: 'active', name: 'Midwestside Connection' },
      { id: '0011', category: 'former', name: 'Amish Rakefighters (2007–2015)' },
    ];
    expect(getActiveTeams({ teams }).map((t) => t.name)).toEqual(['Midwestside Connection']);
  });

  it('handles missing or empty teams arrays', () => {
    expect(getActiveTeams(undefined)).toEqual([]);
    expect(getActiveTeams(null)).toEqual([]);
    expect(getActiveTeams({})).toEqual([]);
    expect(getActiveTeams({ teams: [] })).toEqual([]);
  });

  it('returns exactly one entry per franchise id for TheLeague assets', () => {
    const active = getActiveTeams(theleagueAssets);
    const ids = active.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 16-team league — the raw array also carries historical identities
    expect(active).toHaveLength(16);
    expect(theleagueAssets.teams.length).toBeGreaterThan(active.length);
    // every active entry has a simple 4-digit id (no compound "0002, 0013" ids)
    for (const id of ids) expect(id).toMatch(/^\d{4}$/);
  });

  it('returns exactly one entry per franchise id for AFL assets', () => {
    const active = getActiveTeams(aflAssets);
    const ids = active.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(aflAssets.teams.length).toBeGreaterThan(active.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}$/);
  });

  it('id lookups resolve to the active identity, not whichever sorts first', () => {
    // In the raw TheLeague array, former entries sort alphabetically ahead of the
    // active entry for several ids (e.g. 0011 "Amish Rakefighters" < "Midwestside
    // Connection"), so raw .find() returns a retired name. The helper must not.
    const active = getActiveTeams(theleagueAssets);
    for (const team of active) {
      expect(team.category).toBe('active');
      expect(team.name).not.toMatch(/\(\d{4}/); // no "(2007–2015)"-style era suffixes
    }
  });
});
