import { describe, it, expect, vi } from 'vitest';
import { matchPages } from '../src/utils/page-search-match';
import { buildPageSearchIndex } from '../src/utils/page-search-index';

// Ranking reads Redis counters; an empty map is the documented fallback.
vi.mock('../src/utils/page-usage', () => ({ getPageUsage: async () => new Map() }));

const e = (search: string, rank: number) => ({ search, rank });

describe('matchPages', () => {
  it('needs every word, in any order', () => {
    const hits = matchPages([e('trade block bait', 1), e('trade builder', 0)], 'block trade');
    expect(hits.map((h) => h.search)).toEqual(['trade block bait']);
  });

  it('orders by usage rank, most used first', () => {
    const hits = matchPages([e('salary cap', 3), e('cap space', 1)], 'cap');
    expect(hits.map((h) => h.rank)).toEqual([1, 3]);
  });

  it('puts title matches ahead of busier pages that only mention the word', () => {
    const hits = matchPages(
      [
        { search: 'free agents draft prospects', rank: 0, title: 'Free Agents' },
        { search: 'draft order', rank: 5, title: 'Draft Order' },
      ],
      'draft',
    );
    expect(hits.map((h) => h.title)).toEqual(['Draft Order', 'Free Agents']);
  });

  it('answers nothing for an empty query', () => {
    expect(matchPages([e('x', 0)], '   ')).toEqual([]);
  });
});

describe('buildPageSearchIndex', () => {
  it('scopes to the league and hides admin-only pages from owners', async () => {
    const owner = await buildPageSearchIndex('afl-fantasy', { isAdmin: false, hideLeaguePrefix: false });
    const admin = await buildPageSearchIndex('afl-fantasy', { isAdmin: true, hideLeaguePrefix: false });
    expect(owner.length).toBeGreaterThan(0);
    expect(admin.length).toBeGreaterThanOrEqual(owner.length);
    for (const p of owner) {
      expect(p.href.startsWith('/afl-fantasy'), p.href).toBe(true);
      expect(p.href).not.toContain('/theleague/');
    }
    const ranks = owner.map((p) => p.rank).sort((a, b) => a - b);
    expect(ranks).toEqual(owner.map((_, i) => i));
  });
});

describe('buildPlayerSearchIndex', () => {
  it('lists only rostered positions, with every owner and a readable name', async () => {
    const { buildPlayerSearchIndex, displayName } = await import('../src/utils/player-search-index');
    expect(displayName('Allen, Josh')).toBe('Josh Allen');
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      const index = buildPlayerSearchIndex(league);
      expect(index.players.length, league).toBeGreaterThan(100);
      const rostered = index.players.filter((p) => p.owners.length);
      expect(rostered.length, league).toBeGreaterThan(50);
      for (const p of rostered) for (const fid of p.owners) expect(index.teams[fid], `${league} ${fid}`).toBeTruthy();
      expect(index.players.some((p) => p.pos === 'DT'), league).toBe(false);
      expect(index.players.every((p) => !p.name.includes(',')), league).toBe(true);
    }
  });
});
