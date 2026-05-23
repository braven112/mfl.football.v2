import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module, no types
import { mergeFeed, mergeHistory, maxWatermark, mergeByPath } from '../scripts/lib/merge-schefter-feed.mjs';

const post = (id: string, ts: string, extra: Record<string, unknown> = {}) => ({
  id,
  timestamp: ts,
  type: 'external',
  body: id,
  ...extra,
});

describe('maxWatermark', () => {
  it('takes the later ISO timestamp', () => {
    expect(maxWatermark('2026-05-23T10:00:00Z', '2026-05-23T11:00:00Z')).toBe('2026-05-23T11:00:00Z');
    expect(maxWatermark('2026-05-23T11:00:00Z', '2026-05-23T10:00:00Z')).toBe('2026-05-23T11:00:00Z');
  });
  it('compares epoch-second strings numerically, not lexically', () => {
    // Lexical compare would wrongly pick the shorter string; numeric must win.
    expect(maxWatermark('1779515000', '1779600000')).toBe('1779600000');
    expect(maxWatermark('999999999', '1000000000')).toBe('1000000000');
  });
  it('prefers a present value over a missing one', () => {
    expect(maxWatermark(undefined, '2026-05-23T10:00:00Z')).toBe('2026-05-23T10:00:00Z');
    expect(maxWatermark('2026-05-23T10:00:00Z', undefined)).toBe('2026-05-23T10:00:00Z');
    expect(maxWatermark('', '5')).toBe('5');
  });
});

describe('mergeFeed', () => {
  it('unions posts by id, newest-first, with no duplicates', () => {
    const theirs = { posts: [post('a', '2026-05-23T09:00:00Z'), post('b', '2026-05-23T08:00:00Z')] };
    const ours = { posts: [post('c', '2026-05-23T10:00:00Z'), post('b', '2026-05-23T08:00:00Z')] };
    const merged = mergeFeed(theirs, ours);
    expect(merged.posts.map((p: any) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps posts only present on origin (theirs) — the core fix', () => {
    // origin gained a transaction post while we were generating a rumor post.
    const theirs = { posts: [post('txn1', '2026-05-23T07:30:00Z')] };
    const ours = { posts: [post('rumor1', '2026-05-23T07:02:00Z'), post('txn1', '2026-05-23T07:30:00Z')] };
    const merged = mergeFeed(theirs, ours);
    const ids = merged.posts.map((p: any) => p.id).sort();
    expect(ids).toEqual(['rumor1', 'txn1']);
  });

  it('advances each watermark to the more-recent side', () => {
    const theirs = {
      lastScanTimestamp: '2026-05-23T09:00:00Z',
      lastProcessedMflTimestamp: '1779600000',
      lastEspnTimestamp: '2026-05-23T08:00:00Z',
      posts: [],
    };
    const ours = {
      lastScanTimestamp: '2026-05-23T10:00:00Z',
      lastProcessedMflTimestamp: '1779515000',
      lastEspnTimestamp: '2026-05-23T07:00:00Z',
      posts: [],
    };
    const merged = mergeFeed(theirs, ours);
    expect(merged.lastScanTimestamp).toBe('2026-05-23T10:00:00Z'); // ours newer
    expect(merged.lastProcessedMflTimestamp).toBe('1779600000'); // theirs newer (numeric)
    expect(merged.lastEspnTimestamp).toBe('2026-05-23T08:00:00Z'); // theirs newer
  });

  it('keeps tradeBaitState from whichever side scanned most recently', () => {
    const theirs = { lastScanTimestamp: '2026-05-23T09:00:00Z', tradeBaitState: { side: 'theirs' }, posts: [] };
    const ours = { lastScanTimestamp: '2026-05-23T10:00:00Z', tradeBaitState: { side: 'ours' }, posts: [] };
    expect(mergeFeed(theirs, ours).tradeBaitState).toEqual({ side: 'ours' });
    const theirs2 = { lastScanTimestamp: '2026-05-23T11:00:00Z', tradeBaitState: { side: 'theirs' }, posts: [] };
    expect(mergeFeed(theirs2, ours).tradeBaitState).toEqual({ side: 'theirs' });
  });

  it('is idempotent when both sides are identical', () => {
    const feed = {
      lastScanTimestamp: '2026-05-23T10:00:00Z',
      posts: [post('a', '2026-05-23T09:00:00Z'), post('b', '2026-05-23T08:00:00Z')],
    };
    const merged = mergeFeed(feed, JSON.parse(JSON.stringify(feed)));
    expect(merged.posts.map((p: any) => p.id)).toEqual(['a', 'b']);
  });
});

describe('mergeHistory', () => {
  it('unions by id and caps to _schema.maxEntries, newest-first', () => {
    const mk = (n: number) => post(`h${n}`, `2026-05-${String(10 + n).padStart(2, '0')}T00:00:00Z`);
    const theirs = { _schema: { maxEntries: 3 }, posts: [mk(5), mk(4), mk(3)] };
    const ours = { _schema: { maxEntries: 3 }, posts: [mk(6), mk(3)] };
    const merged = mergeHistory(theirs, ours);
    expect(merged.posts.map((p: any) => p.id)).toEqual(['h6', 'h5', 'h4']); // top 3 newest
  });

  it('preserves schema/description metadata', () => {
    const theirs = { _description: 'desc', _schema: { maxEntries: 30 }, posts: [] };
    const ours = { _description: 'desc', _schema: { maxEntries: 30 }, posts: [post('x', '2026-05-23T00:00:00Z')] };
    const merged = mergeHistory(theirs, ours);
    expect(merged._description).toBe('desc');
    expect(merged._schema.maxEntries).toBe(30);
    expect(merged.posts).toHaveLength(1);
  });
});

describe('mergeByPath', () => {
  it('merges feed files by content', () => {
    const theirs = JSON.stringify({ posts: [post('a', '2026-05-23T09:00:00Z')] });
    const ours = JSON.stringify({ posts: [post('b', '2026-05-23T10:00:00Z')] });
    const out = mergeByPath('src/data/theleague/schefter-feed.json', theirs, ours);
    expect(JSON.parse(out).posts.map((p: any) => p.id)).toEqual(['b', 'a']);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('merges post-history files by content', () => {
    const theirs = JSON.stringify({ _schema: { maxEntries: 30 }, posts: [post('a', '2026-05-23T09:00:00Z')] });
    const ours = JSON.stringify({ _schema: { maxEntries: 30 }, posts: [post('b', '2026-05-23T10:00:00Z')] });
    const out = mergeByPath('data/schefter/post-history.json', theirs, ours);
    expect(JSON.parse(out).posts.map((p: any) => p.id)).toEqual(['b', 'a']);
  });

  it('takes ours verbatim for non-feed files (e.g. resolved-events.json)', () => {
    const out = mergeByPath('src/data/theleague/resolved-events.json', '{"old":true}', '{"new":true}');
    expect(out).toBe('{"new":true}');
  });

  it('falls back to ours when origin JSON is corrupt', () => {
    const ours = JSON.stringify({ posts: [post('b', '2026-05-23T10:00:00Z')] });
    const out = mergeByPath('src/data/theleague/schefter-feed.json', '{not json', ours);
    expect(JSON.parse(out).posts.map((p: any) => p.id)).toEqual(['b']);
  });
});
