import { describe, it, expect, vi } from 'vitest';
import { askHistoryRow, matchPages } from '../src/utils/page-search-match';
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

describe('askHistoryRow', () => {
  const index = [{ href: '/theleague/rosters' }, { href: '/theleague/history/ask' }];

  it('sends the typed query to the league ask page', () => {
    expect(askHistoryRow(index, 'most titles ever', 3)?.href).toBe('/theleague/history/ask?q=most%20titles%20ever');
  });

  it('leads with the ask row for a question, or when nothing else matched', () => {
    expect(askHistoryRow(index, 'who has the most titles?', 4)?.first).toBe(true);
    expect(askHistoryRow(index, 'zzz yyy xxx', 0)?.first).toBe(true);
    expect(askHistoryRow(index, 'pigskins 2017 season', 2)?.first).toBe(false);
  });

  it('leaves a one- or two-word page search alone', () => {
    expect(askHistoryRow(index, 'history', 1)).toBeNull();
    expect(askHistoryRow(index, 'ask history', 0)).toBeNull();
  });

  it('offers nothing in a league without Ask the History, or for an empty box', () => {
    expect(askHistoryRow([{ href: '/bb1/draft' }], 'most titles ever', 0)).toBeNull();
    expect(askHistoryRow(index, '  ', 0)).toBeNull();
    expect(askHistoryRow(null, 'most titles ever', 0)).toBeNull();
  });

  it('finds the ask page in each history league index', async () => {
    for (const slug of ['theleague', 'afl-fantasy'] as const) {
      const pages = await buildPageSearchIndex(slug, { isAdmin: false, hideLeaguePrefix: true });
      expect(askHistoryRow(pages, 'most titles ever', 1)?.href).toBe('/history/ask?q=most%20titles%20ever');
      // And a plain "history" search opens on the ask page itself.
      expect(matchPages(pages, 'history')[0].href).toBe('/history/ask');
    }
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
    const { buildPlayerSearchIndex } = await import('../src/utils/player-search-index');
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

describe('playerLinks', () => {
  it('links each owning team to its roster, and a free agent to Free Agents', async () => {
    const { playerLinks } = await import('../src/utils/player-search-client');
    const index = { teams: { '0001': 'Pigskins', '0013': 'Rebels' }, players: [] };
    const hrefs = { rostersHref: '/afl-fantasy/rosters', freeAgentsHref: '/afl-fantasy/players' };
    const held = playerLinks(index, { id: '15', name: 'Josh Allen', pos: 'QB', team: 'BUF', owners: ['0001', '0013'] }, hrefs);
    expect(held.map((l) => l.href)).toEqual([
      '/afl-fantasy/rosters?franchise=0001&player=15',
      '/afl-fantasy/rosters?franchise=0013&player=15',
    ]);
    expect(held[1].detail).toBe('QB · BUF · Rebels');
    expect(held.every((l) => l.reload)).toBe(true);
    const [fa] = playerLinks(index, { id: '9', name: 'Al Free', pos: 'WR', team: 'FA', owners: [] }, hrefs);
    expect(fa.href).toBe('/afl-fantasy/players?player=9&q=Al+Free');
    expect(fa.detail).toBe('WR · Free agent');
  });
});
