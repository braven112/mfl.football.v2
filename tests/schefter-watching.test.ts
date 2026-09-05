/**
 * Schefter "Watching" — which posts are about a viewer's players.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/player-map', () => ({
  getPlayerMap: () => new Map([
    ['1', { mflId: '1', name: 'Josh Allen' }],
    ['2', { mflId: '2', name: 'Chase Brown' }],
  ]),
}));

import { matchPosts, type WatchingSets } from '../src/utils/schefter-watching';

const sets: WatchingSets = {
  watched: new Set(['1']),
  roster: new Set(['1', '2']),
  all: new Set(['1', '2']),
};

describe('matchPosts', () => {
  it('names each hit in post order, and a watched-AND-rostered player reads as watched', () => {
    const posts = [
      { id: 'a', playerIds: ['9', '2', '1'] },
      { id: 'b', playerIds: ['9'] },
      { id: 'c' },
    ] as any;
    const out = matchPosts(posts, sets, 2026);
    expect(Object.keys(out)).toEqual(['a']);
    expect(out.a).toEqual([
      { id: '2', name: 'Chase Brown', kind: 'roster' },
      { id: '1', name: 'Josh Allen', kind: 'watch' },
    ]);
  });

  it('is empty when the viewer watches nothing', () => {
    const empty: WatchingSets = { watched: new Set(), roster: new Set(), all: new Set() };
    expect(matchPosts([{ id: 'a', playerIds: ['1'] }] as any, empty, 2026)).toEqual({});
  });

  it('falls back to a placeholder name for an id the player map lacks', () => {
    const out = matchPosts([{ id: 'a', playerIds: ['7'] }] as any, { ...sets, all: new Set(['7']), watched: new Set(['7']) }, 2026);
    expect(out.a[0].name).toBe('Player 7');
  });
});
