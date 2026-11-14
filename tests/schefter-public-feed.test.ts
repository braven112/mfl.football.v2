import { describe, it, expect } from 'vitest';
import { selectPublicFeed, isPublicNewsPost, toPlainExcerpt } from '../src/utils/schefter-public-feed';
import feed from '../src/data/theleague/schefter-feed.json';

const base = { headline: 'H', body: 'B', timestamp: '2026-11-10T00:00:00Z' };

describe('schefter public feed', () => {
  it('keeps reported transactions and articles', () => {
    expect(isPublicNewsPost({ ...base, id: 'a', type: 'article', tier: 'standard' })).toBe(true);
    expect(isPublicNewsPost({ ...base, id: 't', type: 'transaction', tier: 'breaking' })).toBe(true);
  });

  it('drops rumor-mill posts, tip-bearing posts and other writers', () => {
    expect(isPublicNewsPost({ ...base, id: 'r', type: 'transaction', tier: 'rumor' })).toBe(false);
    expect(isPublicNewsPost({ ...base, id: 'x', type: 'article', tier: 'standard', tipId: 'abc' })).toBe(false);
    expect(isPublicNewsPost({ ...base, id: 'x', type: 'article', tier: 'standard', tipsterHash: 'h' })).toBe(false);
    for (const type of ['external', 'odds', 'ask-roger', 'assistant']) {
      expect(isPublicNewsPost({ ...base, id: 'e', type, tier: 'standard' })).toBe(false);
    }
  });

  it('exposes display fields only, newest first, with a league-local path', () => {
    const out = selectPublicFeed(
      [
        { ...base, id: 'old', type: 'article', tier: 'standard', franchiseIds: ['0001'], timestamp: '2026-11-01T00:00:00Z' },
        { ...base, id: 'new', type: 'transaction', tier: 'standard', playerIds: ['1'], timestamp: '2026-11-12T00:00:00Z' },
      ],
      'theleague',
    );
    expect(out.map((p) => p.id)).toEqual(['new', 'old']);
    expect(Object.keys(out[0]).sort()).toEqual(['excerpt', 'headline', 'id', 'kind', 'path', 'timestamp']);
    expect(out[1].path).toBe('/theleague/news/old');
    expect(out[0].path).toBe('/theleague/news?post=new#post-new');
  });

  it('strips HTML from excerpts and trims long text on a word', () => {
    expect(toPlainExcerpt('<p>One <a href="/x">two</a></p><p>three</p>')).toBe('One two three');
    expect(toPlainExcerpt('a &amp;lt; b')).toBe('a &lt; b');
    const long = toPlainExcerpt('word '.repeat(100), 50);
    expect(long.length).toBeLessThanOrEqual(51);
    expect(long.endsWith('…')).toBe(true);
  });

  it('caps the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...base, id: `p${i}`, type: 'article', tier: 'standard' }));
    expect(selectPublicFeed(many, 'theleague', 999)).toHaveLength(12);
  });

  it('never lets a rumor through on the real committed feed', () => {
    const posts = (feed as { posts: Array<Record<string, unknown>> }).posts;
    const out = selectPublicFeed(posts, 'theleague', 12);
    const byId = new Map(posts.map((p) => [p.id, p]));
    for (const p of out) {
      const src = byId.get(p.id)!;
      expect(src.tier).not.toBe('rumor');
      expect(['article', 'transaction']).toContain(src.type);
    }
  });
});
