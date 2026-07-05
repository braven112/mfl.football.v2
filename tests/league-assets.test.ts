import { describe, expect, it } from 'vitest';
import {
  getActiveTeams,
  getCurrentAssetPath,
  getCurrentIconPath,
  getCurrentBannerPath,
} from '../src/utils/league-assets';
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

describe('getCurrentAssetPath', () => {
  const p = (relativePath: string) => ({ relativePath });

  it('skips folded-in /history/ art and returns the current asset', () => {
    // Oldest-first ordering with the retired icon at index 0 — the exact shape
    // that made the roster nav render 2007-era logos.
    const icons = [p('/assets/theleague/history/pigskins_2007_icon_circle.png'), p('/assets/theleague/icons/pigskins.png')];
    expect(getCurrentAssetPath(icons)).toBe('/assets/theleague/icons/pigskins.png');
  });

  it('takes the newest live entry when multiple non-history entries exist', () => {
    const icons = [p('/assets/theleague/icons/old.png'), p('/assets/theleague/icons/new.png')];
    expect(getCurrentAssetPath(icons)).toBe('/assets/theleague/icons/new.png');
  });

  it('falls back to the last entry when every entry is under /history/', () => {
    const icons = [p('/assets/theleague/history/a.png'), p('/assets/theleague/history/b.png')];
    expect(getCurrentAssetPath(icons)).toBe('/assets/theleague/history/b.png');
  });

  it('returns undefined for empty or missing input', () => {
    expect(getCurrentAssetPath(undefined)).toBeUndefined();
    expect(getCurrentAssetPath([])).toBeUndefined();
  });

  it('resolves the four TheLeague teams with a former identity to their /icons/ logo', () => {
    // Pigskins, Bring The Pain, Midwestside, Dark Magicians each carry a
    // /history/ icon at index 0 — regression guard for the reported bug.
    const active = getActiveTeams(theleagueAssets);
    for (const id of ['0001', '0008', '0011', '0015']) {
      const team = active.find((t) => t.id === id)!;
      const icon = getCurrentIconPath(team);
      expect(icon, `team ${id}`).toBeDefined();
      expect(icon, `team ${id}`).not.toContain('/history/');
      expect(icon, `team ${id}`).toContain('/icons/');
    }
  });

  it('every active TheLeague team resolves to a non-history icon and banner', () => {
    for (const team of getActiveTeams(theleagueAssets)) {
      const icon = getCurrentIconPath(team);
      if (icon) expect(icon, `${team.name} icon`).not.toContain('/history/');
      const banner = getCurrentBannerPath(team);
      if (banner) expect(banner, `${team.name} banner`).not.toContain('/history/');
    }
  });
});
