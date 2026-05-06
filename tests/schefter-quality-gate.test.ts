import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { diffNewPosts, isLlmAuthored } from '../scripts/schefter-quality-gate.mjs';

describe('isLlmAuthored', () => {
  it('flags posts with authorId="claude"', () => {
    expect(isLlmAuthored({ id: 'a', authorId: 'claude' })).toBe(true);
  });

  it('ignores template-bodied posts without the claude marker', () => {
    expect(isLlmAuthored({ id: 'a' })).toBe(false);
    expect(isLlmAuthored({ id: 'a', authorId: 'nfl-wire' })).toBe(false);
  });

  it('handles null/undefined safely', () => {
    expect(isLlmAuthored(null)).toBe(false);
    expect(isLlmAuthored(undefined)).toBe(false);
  });
});

describe('diffNewPosts', () => {
  it('returns posts present in current but not in HEAD', () => {
    const head = { posts: [{ id: '1' }, { id: '2' }] };
    const current = { posts: [{ id: '3', authorId: 'claude' }, { id: '1' }, { id: '2' }] };
    const diff = diffNewPosts(current, head);
    expect(diff.map((p: { id: string }) => p.id)).toEqual(['3']);
  });

  it('treats a missing HEAD feed as an empty starting point', () => {
    const current = { posts: [{ id: '1' }, { id: '2' }] };
    const diff = diffNewPosts(current, null);
    expect(diff).toHaveLength(2);
  });

  it('returns nothing when current and HEAD have the same ids', () => {
    const head = { posts: [{ id: '1' }, { id: '2' }] };
    const current = { posts: [{ id: '1' }, { id: '2' }] };
    expect(diffNewPosts(current, head)).toEqual([]);
  });

  it('skips posts without an id field', () => {
    const head = { posts: [{ id: '1' }] };
    const current = { posts: [{ id: '2' }, { headline: 'no id' }] };
    expect(diffNewPosts(current, head)).toEqual([{ id: '2' }]);
  });
});
