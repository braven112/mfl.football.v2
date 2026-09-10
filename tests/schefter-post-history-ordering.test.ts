import { describe, it, expect } from 'vitest';
import { buildRecentPostsPromptBlock, postsNewestFirst } from '../scripts/lib/schefter-lore.mjs';
import { mergeHistory } from '../scripts/lib/merge-schefter-feed.mjs';

/**
 * `post-history.json` has two writers and they disagreed about direction.
 *
 * `appendPostHistory` pushed onto the END and pruned with `slice(-30)`
 * (oldest-first); `mergeHistory` sorts NEWEST-first and caps with
 * `slice(0, cap)`. The merge runs on every commit — both scan lanes share the
 * file on overlapping crons — so the merge's direction is what the file
 * actually keeps, and every reader written against the other direction was
 * reading it backwards.
 *
 * Live consequence on 2026-09-10: the file held 30 posts spanning May to
 * September, and `buildRecentPostsPromptBlock`'s `posts.slice(-5)` handed the
 * model five posts from May 5-7. The "do not repeat these openers" memory had
 * been pointed at four-month-old output for as long as both writers existed —
 * silently, because a thinner prompt has no symptom. The same inversion made
 * every append prune the NEWEST entry off the top before writing.
 *
 * These cases pin the contract in BOTH directions, which is the point: neither
 * writer's order may be assumed by a reader.
 */

const post = (id: string, timestamp: string, body: string) => ({
  id, timestamp, body, subject: 'test',
});

const MAY = post('may', '2026-05-05T16:13:47.145Z', 'a post from May');
const JUNE = post('jun', '2026-06-05T16:13:47.145Z', 'a post from June');
const SEPT = post('sep', '2026-09-10T17:41:01.980Z', 'a post from September');

describe('post-history ordering', () => {
  it('sorts newest first whichever way the file is stored', () => {
    for (const stored of [[MAY, JUNE, SEPT], [SEPT, JUNE, MAY], [JUNE, SEPT, MAY]]) {
      expect(postsNewestFirst(stored).map((p) => p.id)).toEqual(['sep', 'jun', 'may']);
    }
  });

  it('keeps an entry with no usable timestamp rather than dropping it', () => {
    const malformed = { id: 'bad', body: 'no timestamp' };
    expect(postsNewestFirst([malformed, SEPT]).map((p) => p.id)).toEqual(['sep', 'bad']);
  });

  it('does not mutate the array it is given', () => {
    const stored = [MAY, SEPT];
    postsNewestFirst(stored);
    expect(stored.map((p) => p.id)).toEqual(['may', 'sep']);
  });
});

describe('the memory block recalls the NEWEST posts', () => {
  const maskNames = (text: string) => text;

  it.each([
    ['newest-first, as mergeHistory leaves it', [SEPT, JUNE, MAY]],
    ['oldest-first, as appendPostHistory used to leave it', [MAY, JUNE, SEPT]],
  ])('holds when the file is stored %s', (_label, stored) => {
    const block = buildRecentPostsPromptBlock(stored, { limit: 2, maskNames, warn: () => {} });
    expect(block).toContain('a post from September');
    expect(block).toContain('a post from June');
    expect(block).not.toContain('a post from May');
  });

  it('reads the file mergeHistory actually writes', () => {
    // The real pipeline: a lane writes its version, the commit merges it with
    // origin's, and the merged file is what the next run reads.
    const merged = mergeHistory({ posts: [MAY, JUNE] }, { posts: [SEPT] });
    const block = buildRecentPostsPromptBlock(merged.posts, { limit: 1, maskNames, warn: () => {} });
    expect(block).toContain('a post from September');
    expect(block).not.toContain('a post from May');
  });

  it('renders oldest-first within the block, so the model reads them in order', () => {
    const block = buildRecentPostsPromptBlock([SEPT, JUNE, MAY], { limit: 3, maskNames, warn: () => {} });
    expect(block.indexOf('from May')).toBeLessThan(block.indexOf('from June'));
    expect(block.indexOf('from June')).toBeLessThan(block.indexOf('from September'));
  });

  it('still drops bodies entirely when no masker is supplied', () => {
    // Unrelated to ordering, and the one behaviour that must survive it: an
    // unmasked body is a franchise name in front of the model that its payload
    // never authorized.
    const block = buildRecentPostsPromptBlock([SEPT], { limit: 5, warn: () => {} });
    expect(block).not.toContain('a post from September');
  });
});
