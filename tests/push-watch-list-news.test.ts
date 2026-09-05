/**
 * "News on your watch list" push — one notification per (post, watching
 * owner), watched players only, tag collapses re-sends.
 */
import { describe, it, expect } from 'vitest';
import { buildWatchListNotifications } from '../scripts/push-watch-list-news.mjs';

const playerName = (id: string) => ({ '1': 'Josh Allen', '2': 'Chase Brown' } as Record<string, string>)[id] ?? '';

describe('buildWatchListNotifications', () => {
  it('sends a post to every owner watching a player it names, and nobody else', () => {
    const posts = [
      { id: 'p1', timestamp: '2026-09-05T10:00:00Z', headline: 'Chase Brown signs', playerIds: ['2'] },
      { id: 'p2', timestamp: '2026-09-05T11:00:00Z', headline: 'No players here' },
    ];
    const watchers = new Map([
      ['0001', new Set(['2'])],
      ['0002', new Set(['1'])],
      ['0003', new Set(['1', '2'])],
    ]);
    const out = buildWatchListNotifications({ posts, watchersByFranchise: watchers, playerName });
    expect(out.map((n) => n.franchiseId).sort()).toEqual(['0001', '0003']);
    expect(out[0]).toMatchObject({
      title: 'Watch list: Chase Brown',
      body: 'Chase Brown signs',
      url: '/news?post=p1',
      tag: 'watch-p1',
    });
  });

  it('names every watched player the post hits and strips HTML from the body', () => {
    const posts = [{ id: 'p3', timestamp: 't', body: '<strong>Josh Allen</strong> and Chase Brown &amp; co', playerIds: ['1', '2', '9'] }];
    const watchers = new Map([['0003', new Set(['1', '2'])]]);
    const [n] = buildWatchListNotifications({ posts, watchersByFranchise: watchers, playerName });
    expect(n.title).toBe('Watch list: Josh Allen, Chase Brown');
    expect(n.body).not.toContain('<');
  });

  it('never league-prefixes the url', () => {
    const posts = [{ id: 'p4', timestamp: 't', headline: 'x', playerIds: ['1'] }];
    const [n] = buildWatchListNotifications({ posts, watchersByFranchise: new Map([['0001', new Set(['1'])]]), playerName });
    expect(n.url.startsWith('/news')).toBe(true);
    expect(n.url).not.toMatch(/^\/(theleague|afl-fantasy)\//);
  });
});
