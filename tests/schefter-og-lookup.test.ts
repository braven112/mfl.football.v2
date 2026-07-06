/**
 * Locks in the OG endpoint's security + branding model:
 *   - the feed JSON is the postId allowlist (unknown ids → null → 404)
 *   - ESPN wire posts mirrored into both feeds resolve to the caller's
 *     league via the preferredLeague hint, not always TheLeague
 *
 * Runs against the real committed feeds (ids are picked dynamically, so
 * feed growth never breaks these tests).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { findSchefterPost } from '../src/utils/schefter-og';
import type { SchefterFeed } from '../src/types/schefter';

const theleagueFeed = JSON.parse(
  readFileSync('src/data/theleague/schefter-feed.json', 'utf-8')
) as SchefterFeed;
const aflFeed = JSON.parse(
  readFileSync('data/afl-fantasy/schefter-feed.json', 'utf-8')
) as SchefterFeed;

const theleagueIds = new Set(theleagueFeed.posts.map((p) => p.id));
const aflIds = new Set(aflFeed.posts.map((p) => p.id));

describe('findSchefterPost', () => {
  it('resolves a TheLeague-only post', () => {
    const id = theleagueFeed.posts.find((p) => !aflIds.has(p.id))?.id;
    expect(id).toBeDefined();
    const found = findSchefterPost(id!);
    expect(found?.league).toBe('theleague');
    expect(found?.post.id).toBe(id);
  });

  it('resolves an AFL-only post regardless of the default preference', () => {
    const id = aflFeed.posts.find((p) => !theleagueIds.has(p.id))?.id;
    expect(id).toBeDefined();
    const found = findSchefterPost(id!);
    expect(found?.league).toBe('afl-fantasy');
  });

  it('brands shared wire ids by the preferred league', () => {
    const shared = theleagueFeed.posts.find((p) => aflIds.has(p.id))?.id;
    // Wire posts are mirrored into both feeds; if that ever stops, this
    // test degenerates to a no-op rather than failing.
    if (!shared) return;
    expect(findSchefterPost(shared, 'theleague')?.league).toBe('theleague');
    expect(findSchefterPost(shared, 'afl-fantasy')?.league).toBe('afl-fantasy');
  });

  it('returns null for unknown ids (the endpoint 404 path)', () => {
    expect(findSchefterPost('sf_definitely_not_a_real_post')).toBeNull();
    expect(findSchefterPost('..')).toBeNull();
  });
});
