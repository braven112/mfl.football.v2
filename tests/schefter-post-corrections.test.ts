import { describe, expect, it } from 'vitest';
import { mergeFeed } from '../scripts/lib/merge-schefter-feed.mjs';
import { applyPostCorrections, POST_CORRECTIONS } from '../scripts/lib/schefter-post-corrections.mjs';

const FIX = {
  sf_1: { reason: 'test', storyVersion: 1, headline: 'Fixed headline', body: 'Fixed body' },
};

const post = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  timestamp: '2026-11-14T04:07:23.000Z',
  headline: `old ${id}`,
  body: `old body ${id}`,
  analysis: `old take ${id}`,
  ...extra,
});

describe('applyPostCorrections', () => {
  it('replaces only the listed fields and stamps the storyVersion', () => {
    const feed = { posts: [post('sf_1'), post('sf_2')] };
    const out = applyPostCorrections(feed, FIX);
    expect(out.posts[0]).toMatchObject({ headline: 'Fixed headline', body: 'Fixed body', analysis: 'old take sf_1', storyVersion: 1 });
    expect(out.posts[0]).not.toHaveProperty('reason');
    expect(out.posts[1]).toBe(feed.posts[1]);
  });

  it('never mutates the feed it was given (the bundled snapshot is shared)', () => {
    const feed = { posts: [post('sf_1')] };
    const before = JSON.stringify(feed);
    applyPostCorrections(feed, FIX);
    expect(JSON.stringify(feed)).toBe(before);
  });

  it('returns the same object when nothing applies', () => {
    const feed = { posts: [post('sf_9')] };
    expect(applyPostCorrections(feed, FIX)).toBe(feed);
    const done = { posts: [post('sf_1', { storyVersion: 1, body: 'Fixed body' })] };
    expect(applyPostCorrections(done, FIX)).toBe(done);
  });

  it('survives a merge with a writer that still holds the old text', () => {
    const corrected = applyPostCorrections({ posts: [post('sf_1')] }, FIX);
    const stale = { posts: [post('sf_1')] };
    // Either side of the merge: the corrected copy's higher storyVersion wins.
    expect(mergeFeed(corrected, stale).posts[0].body).toBe('Fixed body');
    expect(mergeFeed(stale, corrected).posts[0].body).toBe('Fixed body');
  });
});

describe('POST_CORRECTIONS', () => {
  it('never prints a raw "Last, First" name or a split player', () => {
    for (const [id, fix] of Object.entries(POST_CORRECTIONS)) {
      const text = [fix.headline, fix.body, fix.analysis].filter(Boolean).join(' ');
      expect(text, id).not.toMatch(/\b(QB|RB|WR|TE|PK) [A-Z][\w'.-]+, [A-Z]/);
      expect(text, id).not.toMatch(/\b(QB|RB|WR|TE|PK) [A-Z]\w+ and (QB|RB|WR|TE|PK) /);
      expect(fix.storyVersion, id).toBeGreaterThan(0);
    }
  });
});
