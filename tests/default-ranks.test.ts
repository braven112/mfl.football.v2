import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_RANK_SOURCE, defaultRankList } from '../src/utils/default-ranks';

/**
 * Every owner's "My Rank" is FantasySharks, in every league, on every page
 * (Brandon, 2026-11-22). Only the site owner gets anything else.
 */
describe('default ranks', () => {
  it('is FantasySharks', () => {
    expect(DEFAULT_RANK_SOURCE).toBe('sharks');
    expect(defaultRankList(null).label).toBe('FantasySharks');
  });

  it('reads the sharks source and nothing else', () => {
    const list = defaultRankList({
      sources: [
        { id: 'fantasycalc', players: [{ id: '1', rank: 1 }] },
        { id: 'sharks', players: [{ id: '2', rank: 1 }, { id: '3', rank: 2 }, { id: '2', rank: 9 }, { rank: 4 }] },
      ],
    });
    expect(list.ranks).toEqual({ '2': 1, '3': 2 });
  });

  it('is empty, not an error, when the source is missing', () => {
    expect(defaultRankList({ sources: [] }).ranks).toEqual({});
  });

  it('the committed snapshot carries a real sharks board', () => {
    const snap = JSON.parse(readFileSync('data/ranking-sources/2026.json', 'utf8'));
    expect(Object.keys(defaultRankList(snap).ranks).length).toBeGreaterThan(200);
  });

  it('the API is public data and never reads the private board', () => {
    const src = readFileSync('src/pages/api/default-ranks.ts', 'utf8');
    expect(src).not.toMatch(/private-rankings|my-ranks'/);
    expect(src).toContain("'Cache-Control': 'public");
  });
});
