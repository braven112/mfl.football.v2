import { describe, it, expect } from 'vitest';
import { selectWaiverPickupArticle } from '../src/utils/hero-data/article-hero-data';

const REF = new Date('2025-10-08T15:00:00-07:00');
const iso = (d: Date) => d.toISOString();
const daysBefore = (n: number) => new Date(REF.getTime() - n * 24 * 60 * 60 * 1000);

function article(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sf_1',
    type: 'article',
    timestamp: iso(daysBefore(1)),
    headline: 'Waiver Wire: Three pickups to target this week',
    body: 'The body of the waiver article.',
    link: '/theleague/news/sf_1',
    playerIds: ['13116'],
    ...overrides,
  };
}

describe('selectWaiverPickupArticle', () => {
  it('returns null for non-array input', () => {
    expect(selectWaiverPickupArticle(null, REF)).toBeNull();
    expect(selectWaiverPickupArticle(undefined, REF)).toBeNull();
    expect(selectWaiverPickupArticle({}, REF)).toBeNull();
  });

  it('returns null when there are no article-type posts', () => {
    const posts = [
      { id: 't1', type: 'transaction', timestamp: iso(daysBefore(1)), headline: 'Trade' },
    ];
    expect(selectWaiverPickupArticle(posts, REF)).toBeNull();
  });

  it('prefers a recent article whose headline matches waiver/pickup/claim', () => {
    const posts = [
      article({ id: 'preview', headline: 'Weekend preview: storylines to watch', playerIds: [] }),
      article({ id: 'waiver', headline: 'Waiver pickup report', playerIds: ['555'] }),
    ];
    const result = selectWaiverPickupArticle(posts, REF);
    expect(result?.id).toBe('waiver');
    expect(result?.playerIds).toEqual(['555']);
  });

  it('matches "claim" and "pickup" as well as "waiver"', () => {
    expect(
      selectWaiverPickupArticle([article({ id: 'c', headline: 'Best claim targets' })], REF)?.id,
    ).toBe('c');
    expect(
      selectWaiverPickupArticle([article({ id: 'p', headline: 'Top pickup this week' })], REF)?.id,
    ).toBe('p');
  });

  it('falls back to the first article in the pool when no headline matches', () => {
    const posts = [
      article({ id: 'first', headline: 'Power rankings shake-up' }),
      article({ id: 'second', headline: 'Injury roundup' }),
    ];
    expect(selectWaiverPickupArticle(posts, REF)?.id).toBe('first');
  });

  it('uses the newest 5 articles when none are within the last 7 days', () => {
    const posts = [
      article({ id: 'old1', headline: 'Waiver adds', timestamp: iso(daysBefore(30)) }),
      article({ id: 'old2', headline: 'Power rankings', timestamp: iso(daysBefore(40)) }),
    ];
    // old1 headline matches waiver → selected even though it's outside 7 days
    expect(selectWaiverPickupArticle(posts, REF)?.id).toBe('old1');
  });

  it('normalizes playerIds to strings and defaults missing fields', () => {
    const posts = [
      article({ id: 'x', headline: 'Waiver targets', playerIds: [123, 456], body: undefined, link: undefined }),
    ];
    const result = selectWaiverPickupArticle(posts, REF);
    expect(result?.playerIds).toEqual(['123', '456']);
    expect(result?.body).toBe('');
    expect(result?.link).toBeUndefined();
  });

  it('returns empty playerIds when the article has none (composite will fall back)', () => {
    const posts = [article({ id: 'nopids', headline: 'Waiver report', playerIds: undefined })];
    const result = selectWaiverPickupArticle(posts, REF);
    expect(result?.id).toBe('nopids');
    expect(result?.playerIds).toEqual([]);
  });

  it('ignores future-dated recency but still includes them via the newest-5 fallback path', () => {
    const future = article({ id: 'future', headline: 'Waiver adds', timestamp: iso(new Date(REF.getTime() + 86400000)) });
    // A future article IS within 7 days of REF (ts > cutoff), so it's eligible.
    expect(selectWaiverPickupArticle([future], REF)?.id).toBe('future');
  });
});
